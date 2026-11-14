import type { NextRequest } from "next/server";
import { AUTH_COOKIE, checkPassword, currentToken, isAdmin, isHttps, weakForPublic } from "@/lib/auth";
import { OWNER_COOKIE } from "@/lib/owner";

export async function GET(req: NextRequest) {
  return Response.json({ admin: isAdmin(req) }, { headers: { "Cache-Control": "no-store" } });
}

// Вход: { password }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (weakForPublic(req)) {
    return Response.json(
      { error: "Админка из интернета открывается только со своим паролем: впишите строку ADMIN_PASSWORD=… в файл .env.local и перезапустите программу" },
      { status: 403 },
    );
  }
  if (!body.password || !checkPassword(body.password)) {
    await new Promise((r) => setTimeout(r, 600)); // притормозить перебор
    return Response.json({ error: "Неверный пароль" }, { status: 401 });
  }
  const res = Response.json({ admin: true });
  const cookie = [
    `${AUTH_COOKIE}=${currentToken()}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 30}`,
    isHttps(req) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  res.headers.append("Set-Cookie", cookie);
  return res;
}

// Выход
export async function DELETE() {
  const res = Response.json({ admin: false });
  res.headers.append("Set-Cookie", `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  // выход из админки закрывает и режим владельца
  res.headers.append("Set-Cookie", `${OWNER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
