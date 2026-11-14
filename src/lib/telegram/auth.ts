// Вход по Telegram (docs/SITE.md, шаг 6): проверка подписи данных, которые присылает Telegram.
// Мини-приложение — строка initData (подпись: ключ = HMAC("WebAppData", токен)).
// Кнопка «Войти через Telegram» на сайте (Login Widget) — набор полей (подпись: ключ = SHA256(токен)).
// Подделать подпись без токена бота нельзя, поэтому по ней можно узнать, кто пришёл.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Данные старше суток не принимаем — их могли перехватить и прислать заново */
export const TG_AUTH_MAX_AGE_S = 24 * 60 * 60;

const checkString = (fields: Record<string, string>) =>
  Object.keys(fields)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

function sameHex(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function fresh(authDate: string | undefined, now: number) {
  const at = Number(authDate);
  return Number.isFinite(at) && at > 0 && now / 1000 - at < TG_AUTH_MAX_AGE_S && at - now / 1000 < 300;
}

/** Мини-приложение: initData из Telegram → номер пользователя Telegram. null — подпись не сошлась или данные устарели. */
export function verifyWebAppData(initData: unknown, token: string, now = Date.now()): { telegramId: number; firstName: string } | null {
  if (typeof initData !== "string" || !initData || initData.length > 4096 || !token) return null;
  const fields = Object.fromEntries(new URLSearchParams(initData));
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString(fields)).digest("hex");
  if (!sameHex(hash, fields.hash ?? "") || !fresh(fields.auth_date, now)) return null;
  try {
    const user = JSON.parse(fields.user ?? "") as { id?: unknown; first_name?: unknown };
    const id = Number(user.id);
    return Number.isSafeInteger(id) && id > 0 ? { telegramId: id, firstName: String(user.first_name ?? "") } : null;
  } catch {
    return null;
  }
}

/** Кнопка «Войти через Telegram» на сайте: поля от Telegram → номер пользователя. null — не сошлось. */
export function verifyLoginWidget(input: unknown, token: string, now = Date.now()): { telegramId: number } | null {
  if (!input || typeof input !== "object" || !token) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[a-z_]{1,20}$/.test(k) || v == null) continue;
    fields[k] = String(v);
  }
  const secret = createHash("sha256").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString(fields)).digest("hex");
  if (!sameHex(hash, fields.hash ?? "") || !fresh(fields.auth_date, now)) return null;
  const id = Number(fields.id);
  return Number.isSafeInteger(id) && id > 0 ? { telegramId: id } : null;
}
