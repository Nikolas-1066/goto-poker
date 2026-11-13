import { connection, type NextRequest } from "next/server";
import { normalizePhone } from "@/lib/players";
import { accountMe, changePassword, closeSession, login, register, removePhoto, renamePlayer, sessionAccount, setPhoto } from "@/lib/db/accounts";
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

type Body = { action?: string; name?: unknown; phone?: unknown; password?: unknown; old?: unknown; data?: unknown };

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const token = playerToken(req);
  try {
    if (body.action === "register" || body.action === "login") {
      // счётчик неверных паролей — по телефону: перебор не обойти, меняя адрес
      const key = normalizePhone(String(body.phone ?? "")) ?? "?";
      const wait = body.action === "login" ? lockedMinutes(key) : 0;
      if (wait) return json({ error: `Слишком много попыток. Попробуйте через ${wait} мин.` }, 429);
      const fresh = await withDatabase((db) => (body.action === "register" ? register(db, body) : login(db, body.phone, body.password)));
      if (body.action === "login") noteLogin(key, !!fresh);
      if (!fresh) {
        await slow();
        return json({ error: "Телефон или пароль не подошли" }, 401);
      }
      const res = json(await withDatabase((db) => accountMe(db, sessionAccount(db, fresh)!)));
      res.headers.append("Set-Cookie", playerCookie(req, fresh));
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
