// Вход игрока в route handlers: cookie «goto_player» → аккаунт (src/lib/db/accounts.ts).

import type { NextRequest } from "next/server";
import { isHttps } from "./auth";
import { SESSION_MS } from "./db/accounts";

export const PLAYER_COOKIE = "goto_player";

export const playerToken = (req: NextRequest) => req.cookies.get(PLAYER_COOKIE)?.value;

export function playerCookie(req: NextRequest, token: string | null) {
  return [
    `${PLAYER_COOKIE}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${token ? Math.floor(SESSION_MS / 1000) : 0}`,
    isHttps(req) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Картинка из браузера: «data:image/jpeg;base64,…» → байты. null — это не JPEG в таком виде. */
export function photoBytes(data: unknown): Uint8Array | null {
  if (typeof data !== "string" || data.length > 400_000) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data);
  return m ? new Uint8Array(Buffer.from(m[1], "base64")) : null;
}

// ---------- Защита от перебора пароля ----------

const MAX_FAILS = 8;
const LOCK_MS = 10 * 60_000;
const fails = new Map<string, { count: number; until: number }>();

/** Сколько минут ещё ждать после многих неверных паролей (0 — можно пробовать) */
export function lockedMinutes(key: string, now = Date.now()): number {
  const f = fails.get(key);
  return f && f.count >= MAX_FAILS && f.until > now ? Math.ceil((f.until - now) / 60_000) : 0;
}

export function noteLogin(key: string, ok: boolean, now = Date.now()) {
  if (ok) {
    fails.delete(key);
    return;
  }
  if (fails.size > 5000) fails.clear();
  const f = fails.get(key);
  const count = f && f.until > now ? f.count + 1 : 1;
  fails.set(key, { count, until: now + LOCK_MS });
}
