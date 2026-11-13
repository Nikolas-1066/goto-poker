import { connection, type NextRequest } from "next/server";
import { sessionAccount } from "@/lib/db/accounts";
import { cancelSignup, mySignups, signUp, syncSignups, unsyncSignup } from "@/lib/db/signups";
import { playerToken } from "@/lib/playerAuth";
import { updateDb, withDatabase } from "@/lib/store";

// Запись игрока на турниры (docs/SITE.md, шаг 4): мои записи, записаться (с гостями), отменить.

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Мои записи на ближайшие турниры; не вошёл — пусто
export async function GET(req: NextRequest) {
  await connection();
  try {
    const token = playerToken(req);
    return json(
      await withDatabase((db) => {
        const account = sessionAccount(db, token);
        return { mine: account ? mySignups(db, account) : [] };
      }),
    );
  } catch {
    return json({ mine: [] });
  }
}

// { action: "signup", scheduleId, guests, guestNames } | { action: "cancel", scheduleId }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; scheduleId?: unknown; guests?: unknown; guestNames?: unknown };
  const token = playerToken(req);
  const scheduleId = Number(body.scheduleId);
  const now = Date.now();
  try {
    if (!Number.isInteger(scheduleId)) throw new Error("Турнир не найден");
    let authorized = true;
    // запись и открытый турнир (если он уже открыт в клубе) меняются одной транзакцией
    await updateDb(
      (db) => db.tournament,
      (sqlite, next) => {
        const account = sessionAccount(sqlite, token, now);
        if (!account) {
          authorized = false;
          return;
        }
        if (body.action === "signup") {
          signUp(sqlite, scheduleId, { account }, body, now);
        } else if (body.action === "cancel") {
          const c = cancelSignup(sqlite, { scheduleId, account }, now);
          unsyncSignup(sqlite, next, c.scheduleId, c.playerId, true, now);
        } else throw new Error("Неизвестное действие");
        syncSignups(sqlite, next, scheduleId, now);
      },
    );
    if (!authorized) return json({ error: "Сначала войдите на сайт" }, 401);
    return json(await withDatabase((db) => ({ mine: mySignups(db, sessionAccount(db, token)!) })));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Ошибка" }, 400);
  }
}
