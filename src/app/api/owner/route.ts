import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, isHttps, unauthorized } from "@/lib/auth";
import { checkOwnerPassword, hasOwnerPassword, ownerToken, setOwnerPassword } from "@/lib/db/owner";
import { OWNER_COOKIE, ownerState } from "@/lib/owner";
import { withDatabase } from "@/lib/store";

// Пароль владельца: задан ли и вошёл ли владелец
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    return Response.json(await ownerState(req), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

const slow = () => new Promise((r) => setTimeout(r, 600)); // притормозить перебор

/**
 * { action: "setup", password } — задать пароль (только если ещё не задан);
 * { action: "login", password } — войти; { action: "change", old, password } — сменить
 */
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { action?: string; password?: string; old?: string };
  try {
    const token = await withDatabase((db) => {
      if (body.action === "setup") {
        if (hasOwnerPassword(db)) throw new Error("Пароль владельца уже задан — войдите с ним");
        setOwnerPassword(db, body.password ?? "");
      } else if (body.action === "login") {
        if (!checkOwnerPassword(db, body.password ?? "")) return null;
      } else if (body.action === "change") {
        if (!checkOwnerPassword(db, body.old ?? "")) return null;
        setOwnerPassword(db, body.password ?? "");
      } else throw new Error("Неизвестное действие");
      return ownerToken(db);
    });
    if (!token) {
      await slow();
      return Response.json({ error: "Неверный пароль владельца" }, { status: 401 });
    }
    const res = Response.json({ set: true, owner: true });
    const cookie = [`${OWNER_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${60 * 60 * 12}`, isHttps(req) ? "Secure" : ""]
      .filter(Boolean)
      .join("; ");
    res.headers.append("Set-Cookie", cookie);
    return res;
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

// Выйти из режима владельца (админка остаётся открытой)
export async function DELETE() {
  const res = Response.json({ owner: false });
  res.headers.append("Set-Cookie", `${OWNER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
