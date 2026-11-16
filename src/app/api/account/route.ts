import { connection, type NextRequest } from "next/server";
import { normalizePhone } from "@/lib/players";
import { accountMe, changePassword, closeSession, login, openSession, register, removePhoto, renamePlayer, sessionAccount, setPhoto } from "@/lib/db/accounts";
import { accountByTelegram } from "@/lib/db/telegram";
import { verifyLoginWidget, verifyWebAppData } from "@/lib/telegram/auth";
import { notifyRequest } from "@/lib/db/telegram";
import { lockedMinutes, noteLogin, photoBytes, playerCookie, playerToken } from "@/lib/playerAuth";
import { withDatabase } from "@/lib/store";

// Вход игрока на сайт (docs/SITE.md, шаг 3): заявка, вход, выход, профиль, ник, пароль, фото.

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const slow = () => new Promise((r) => setTimeout(r, 600)); // притормозить перебор

// Кто вошёл: { status: "none" | "pending" | "active", … }
export async function GET(req: NextRequest) {
  await connection();
  try {
    const token = playerToken(req);
    return json(
      await withDatabase((db) => {
        const account = sessionAccount(db, token);
        return account ? accountMe(db, account) : { status: "none" };
      }),
    );
  } catch {
    return json({ status: "none" });
  }
}

type Body = { action?: string; name?: unknown; phone?: unknown; password?: unknown; old?: unknown; data?: unknown; initData?: unknown; widget?: unknown };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const token = playerToken(req);
  try {
    if (body.action === "register" || body.action === "login") {
      // счётчик неверных паролей — по телефону: перебор не обойти, меняя адрес
      const key = normalizePhone(String(body.phone ?? "")) ?? "?";
      const wait = body.action === "login" ? lockedMinutes(key) : 0;
      if (wait) return json({ error: `Слишком много попыток. Попробуйте через ${wait} мин.` }, 429);
      const fresh = await withDatabase((db) => {
        if (body.action !== "register") return login(db, body.phone, body.password);
        const t = register(db, body);
        // админам и владельцу — сообщение в Telegram о новой заявке
        const acc = sessionAccount(db, t)!;
        const known = !!db.prepare("SELECT 1 FROM players WHERE phone = ? AND archived_at IS NULL").get(acc.phone);
        notifyRequest(db, { accountId: acc.id, name: acc.name, phone: acc.phone, known }, "site");
        return t;
      });
      if (body.action === "login") noteLogin(key, !!fresh);
      if (!fresh) {
        await slow();
        return json({ error: "Телефон или пароль не подошли" }, 401);
      }
      const res = json(await withDatabase((db) => accountMe(db, sessionAccount(db, fresh)!)));
      res.headers.append("Set-Cookie", playerCookie(req, fresh));
      return res;
    }

    // вход по Telegram: мини-приложение (initData) или кнопка «Войти через Telegram» на сайте (поля виджета)
    if (body.action === "telegram" || body.action === "telegramLogin") {
      const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
      const who = body.action === "telegram" ? verifyWebAppData(body.initData, botToken) : verifyLoginWidget(body.widget, botToken);
      if (!who) return json({ error: "Не удалось проверить вход через Telegram — откройте заново" }, 401);
      const fresh = await withDatabase((db) => {
        const account = accountByTelegram(db, who.telegramId);
        return account ? openSession(db, account.id) : null;
      });
      // Telegram ещё не привязан к профилю — нужно поделиться номером в боте
      if (!fresh) return json({ status: "none", needLink: true });
      const res = json(await withDatabase((db) => accountMe(db, sessionAccount(db, fresh)!)));
      // мини-приложение в веб-версии Telegram открывается во фрейме — там cookie нужен SameSite=None
      res.headers.append("Set-Cookie", playerCookie(req, fresh, body.action === "telegram"));
      return res;
    }

    if (body.action === "logout") {
      await withDatabase((db) => closeSession(db, token));
      const res = json({ status: "none" });
      res.headers.append("Set-Cookie", playerCookie(req, null));
      return res;
    }

    const me = await withDatabase((db) => {
      const account = sessionAccount(db, token);
      if (!account) return null;
      if (account.playerId == null) throw new Error("Заявка ещё не подтверждена в клубе");
      switch (body.action) {
        case "password":
          changePassword(db, account, body.old, body.password, token);
          break;
        case "rename":
          renamePlayer(db, account.playerId, body.name);
          break;
        case "photo": {
          const bytes = photoBytes(body.data);
          if (!bytes) throw new Error("Не получилось прочитать фото — выберите другую картинку");
          setPhoto(db, account.playerId, bytes, "player");
          break;
        }
        case "removePhoto":
          removePhoto(db, account.playerId, "player");
          break;
        default:
          throw new Error("Неизвестное действие");
      }
      return accountMe(db, account);
    });
    return me ? json(me) : json({ error: "Нужно войти" }, 401);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Ошибка" }, 400);
  }
}
