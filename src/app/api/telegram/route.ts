import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { sessionAccount } from "@/lib/db/accounts";
import { announce, createLinkCode, getReminderTime, roleOfPlayer, setReminderTime, setRole, telegramStats, unlinkTelegram } from "@/lib/db/telegram";
import { sendFinalists, sendResults } from "@/lib/db/telegramJobs";
import { isOwner, ownerRequired } from "@/lib/owner";
import { playerToken } from "@/lib/playerAuth";
import { withDatabase } from "@/lib/store";
import { botLastError, botUsername } from "@/lib/telegram/runner";

// Telegram-бот (docs/SITE.md, шаг 5): состояние и настройки в админке, рассылки, ссылка «Подключить Telegram» игроку.

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Админка: состояние бота; ?player=ID — подключён ли Telegram у игрока и его роль в боте
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  const player = Number(req.nextUrl.searchParams.get("player"));
  try {
    return json(
      await withDatabase((db) =>
        player
          ? roleOfPlayer(db, player)
          : { bot: botUsername(), token: !!process.env.TELEGRAM_BOT_TOKEN?.trim(), error: botLastError(), reminder: getReminderTime(db), ...telegramStats(db) },
      ),
    );
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

type Body = { action?: string; tournamentId?: unknown; time?: unknown; text?: unknown; playerId?: unknown; role?: unknown };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  try {
    // ---- игрок: ссылка в бота из личного кабинета, отключить Telegram ----
    if (body.action === "link" || body.action === "unlink") {
      const token = playerToken(req);
      const bot = botUsername();
      if (body.action === "link" && !bot) throw new Error("Бот сейчас не работает — попробуйте позже");
      const res = await withDatabase((db) => {
        const account = sessionAccount(db, token);
        if (!account) return null;
        if (body.action === "unlink") {
          unlinkTelegram(db, account.id);
          return { ok: true };
        }
        return { url: `https://t.me/${bot}?start=${createLinkCode(db, account.id)}` };
      });
      return res ? json(res) : json({ error: "Сначала войдите на сайт" }, 401);
    }

    if (!isAdmin(req)) return unauthorized();
    // анонсы и роли в боте — только владелец
    if ((body.action === "announce" || body.action === "role") && !(await isOwner(req))) return ownerRequired();
    return json(
      await withDatabase((db) => {
        switch (body.action) {
          case "results":
            return sendResults(db, Number(body.tournamentId));
          case "finalists":
            return sendFinalists(db);
          case "reminder":
            return { reminder: setReminderTime(db, body.time) };
          case "announce":
            return { to: announce(db, body.text) };
          case "role":
            setRole(db, Number(body.playerId), body.role === "admin" || body.role === "owner" ? body.role : null);
            return roleOfPlayer(db, Number(body.playerId));
          default:
            throw new Error("Неизвестное действие");
        }
      }),
    );
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
