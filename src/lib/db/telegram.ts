// Telegram-бот в базе (docs/SITE.md, шаг 5): привязка чата к входу игрока, очередь сообщений, кому писать служебное.
// Разговор с игроком — src/lib/telegram/bot.ts, фоновые задачи (напоминания и т.п.) — src/lib/db/telegramJobs.ts.

import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validatePhone } from "../account";
import { cleanName, formatPhone, NAME_MAX } from "../players";
import { isTime } from "../schedule";
import { clip, requestText, type TgButton } from "../telegram/texts";
import type { Account } from "./accounts";
import { audit } from "./sqlite";

export type TgRole = "admin" | "owner";

type AccountRow = { id: number; phone: string; name: string; player_id: number | null };
const toAccount = (r: AccountRow): Account => ({ id: r.id, phone: r.phone, name: r.name, playerId: r.player_id });

// ---------- Привязка чата ----------

export function accountByTelegram(db: DatabaseSync, telegramId: number): Account | null {
  const r = db.prepare("SELECT id, phone, name, player_id FROM accounts WHERE telegram_id = ?").get(telegramId) as AccountRow | undefined;
  return r ? toAccount(r) : null;
}

/** Имя для обращения: ник игрока, а пока заявка не подтверждена — имя из заявки */
export function displayName(db: DatabaseSync, account: Account): string {
  if (account.playerId == null) return account.name;
  return (db.prepare("SELECT name FROM players WHERE id = ?").get(account.playerId) as { name: string } | undefined)?.name ?? account.name;
}

function attach(db: DatabaseSync, accountId: number, telegramId: number, how: string, now: number) {
  // один чат — один вход: если этот Telegram был привязан к другому входу, там привязка снимается
  db.prepare("UPDATE accounts SET telegram_id = NULL WHERE telegram_id = ? AND id <> ?").run(telegramId, accountId);
  db.prepare("UPDATE accounts SET telegram_id = ? WHERE id = ?").run(telegramId, accountId);
  audit(db, "telegram.link", { accountId, how }, now);
}

/** Ссылка «Подключить Telegram» из личного кабинета: одноразовый код на 15 минут */
export function createLinkCode(db: DatabaseSync, accountId: number, now = Date.now()): string {
  db.prepare("DELETE FROM telegram_codes WHERE expires_at <= ? OR account_id = ?").run(now, accountId);
  const code = randomBytes(12).toString("hex");
  db.prepare("INSERT INTO telegram_codes (code, account_id, expires_at) VALUES (?, ?, ?)").run(code, accountId, now + 15 * 60_000);
  return code;
}

/** Игрок пришёл в бота по ссылке из кабинета. null — код не подошёл или устарел. */
export function linkByCode(db: DatabaseSync, code: string, telegramId: number, now = Date.now()): Account | null {
  const row = db.prepare("SELECT account_id FROM telegram_codes WHERE code = ? AND expires_at > ?").get(code, now) as { account_id: number } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM telegram_codes WHERE code = ?").run(code);
  attach(db, row.account_id, telegramId, "code", now);
  return accountByTelegram(db, telegramId);
}

/**
 * Игрок поделился в боте своим номером (номер подтверждён самим Telegram).
 * Вход с таким телефоном уже есть — чат привязывается к нему. Телефон есть у игрока в базе — вход создаётся
 * сразу, без админа. Телефона в базе нет — заявка админу, как при регистрации на сайте (created = true).
 */
export function linkByPhone(db: DatabaseSync, telegramId: number, phoneInput: unknown, tgName: unknown, now = Date.now()): { account: Account; created: boolean } {
  const phone = validatePhone(String(phoneInput ?? "").startsWith("+") ? phoneInput : `+${String(phoneInput ?? "")}`);
  const existing = db.prepare("SELECT id FROM accounts WHERE phone = ?").get(phone) as { id: number } | undefined;
  let created = false;
  let id = existing?.id;
  if (id == null) {
    const player = db.prepare("SELECT id, name FROM players WHERE phone = ? AND archived_at IS NULL").get(phone) as { id: number; name: string } | undefined;
    const free = player && !db.prepare("SELECT 1 FROM accounts WHERE player_id = ?").get(player.id);
    const name = cleanName(String(tgName ?? "")).slice(0, NAME_MAX) || "Игрок";
    // пароля у такого входа нет (случайная строка вместо хэша): на сайт — через Telegram или сброс пароля админом
    id = Number(
      db
        .prepare("INSERT INTO accounts (phone, name, pass_salt, pass_hash, player_id, created_at, confirmed_at) VALUES (?, ?, 'telegram', ?, ?, ?, ?)")
        .run(phone, free ? player.name : name, randomBytes(32).toString("hex"), free ? player.id : null, now, free ? now : null).lastInsertRowid,
    );
    created = !free;
    audit(db, free ? "account.telegram" : "account.register", { id, via: "telegram" }, now);
    if (created) notifyRequest(db, { name, phone, known: !!player }, "bot", now);
  }
  attach(db, id, telegramId, "phone", now);
  return { account: accountByTelegram(db, telegramId)!, created };
}

export function unlinkTelegram(db: DatabaseSync, accountId: number, now = Date.now()) {
  db.prepare("UPDATE accounts SET telegram_id = NULL, tg_role = NULL WHERE id = ?").run(accountId);
  audit(db, "telegram.unlink", { accountId }, now);
}

// ---------- Кому писать ----------

export const chatOfAccount = (db: DatabaseSync, accountId: number): number | null =>
  (db.prepare("SELECT telegram_id FROM accounts WHERE id = ?").get(accountId) as { telegram_id: number | null } | undefined)?.telegram_id ?? null;

export const chatOfPlayer = (db: DatabaseSync, playerId: number): number | null =>
  (db.prepare("SELECT telegram_id FROM accounts WHERE player_id = ?").get(playerId) as { telegram_id: number | null } | undefined)?.telegram_id ?? null;

/** Все, у кого подключён Telegram (для анонсов) */
export const allChats = (db: DatabaseSync): number[] =>
  (db.prepare("SELECT telegram_id FROM accounts WHERE telegram_id IS NOT NULL").all() as { telegram_id: number }[]).map((r) => r.telegram_id);

/** Чаты админов и владельца (служебные сообщения); onlyOwner — только владельца */
export function staffChats(db: DatabaseSync, onlyOwner = false): number[] {
  const rows = db.prepare(`SELECT telegram_id FROM accounts WHERE telegram_id IS NOT NULL AND tg_role ${onlyOwner ? "= 'owner'" : "IN ('admin', 'owner')"}`).all() as { telegram_id: number }[];
  return rows.map((r) => r.telegram_id);
}

/** Роль в боте у игрока (карточка игрока в админке): кому слать заявки и отчёты */
export function roleOfPlayer(db: DatabaseSync, playerId: number): { linked: boolean; role: TgRole | null } {
  const r = db.prepare("SELECT telegram_id, tg_role FROM accounts WHERE player_id = ?").get(playerId) as { telegram_id: number | null; tg_role: TgRole | null } | undefined;
  return { linked: r?.telegram_id != null, role: r?.tg_role ?? null };
}

export function setRole(db: DatabaseSync, playerId: number, role: unknown, now = Date.now()) {
  if (role !== null && role !== "admin" && role !== "owner") throw new Error("Неизвестная роль");
  const r = db.prepare("SELECT id, telegram_id FROM accounts WHERE player_id = ?").get(playerId) as { id: number; telegram_id: number | null } | undefined;
  if (!r || r.telegram_id == null) throw new Error("У этого игрока не подключён Telegram — сначала он должен открыть бота");
  db.prepare("UPDATE accounts SET tg_role = ? WHERE id = ?").run(role, r.id);
  audit(db, "telegram.role", { playerId, role }, now);
}

// ---------- Очередь сообщений ----------

export type Outgoing = { id: number; chatId: number; text: string; buttons: TgButton[][] | null };

/**
 * Поставить сообщение в очередь. dedupe — ключ «это уже отправляли» (напоминание об этом турнире этому игроку…):
 * второй раз с тем же ключом сообщение не ставится. Возвращает true, если поставлено.
 */
export function enqueue(db: DatabaseSync, chatId: number | null, text: string, opts: { buttons?: TgButton[][]; dedupe?: string } = {}, now = Date.now()): boolean {
  if (chatId == null) return false;
  const res = db
    .prepare("INSERT OR IGNORE INTO telegram_outbox (chat_id, text, buttons, dedupe, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(chatId, clip(text), opts.buttons ? JSON.stringify(opts.buttons) : null, opts.dedupe ?? null, now);
  return Number(res.changes) > 0;
}

/** Неотправленные сообщения по порядку (не старше суток, не больше 5 попыток) */
export function pendingOutbox(db: DatabaseSync, now = Date.now(), limit = 25): Outgoing[] {
  return (
    db
      .prepare("SELECT id, chat_id, text, buttons FROM telegram_outbox WHERE sent_at IS NULL AND tries < 5 AND created_at > ? ORDER BY id LIMIT ?")
      .all(now - 86_400_000, limit) as { id: number; chat_id: number; text: string; buttons: string | null }[]
  ).map((r) => ({ id: r.id, chatId: r.chat_id, text: r.text, buttons: r.buttons ? (JSON.parse(r.buttons) as TgButton[][]) : null }));
}

export function markSent(db: DatabaseSync, id: number, now = Date.now()) {
  db.prepare("UPDATE telegram_outbox SET sent_at = ?, error = NULL WHERE id = ?").run(now, id);
}

/** Не отправилось. final — пробовать больше не нужно (игрок заблокировал бота и т.п.) */
export function markFailed(db: DatabaseSync, id: number, error: string, final = false) {
  db.prepare("UPDATE telegram_outbox SET tries = CASE WHEN ? THEN 5 ELSE tries + 1 END, error = ? WHERE id = ?").run(final ? 1 : 0, error.slice(0, 300), id);
}

// ---------- Служебные сообщения ----------

/** Новая заявка на вход — админам и владельцу */
export function notifyRequest(db: DatabaseSync, r: { name: string; phone: string; known: boolean }, from: "site" | "bot", now = Date.now()) {
  for (const chat of staffChats(db)) enqueue(db, chat, requestText(r.name, formatPhone(r.phone), r.known, from), {}, now);
}

/** Анонс клуба — всем, у кого подключён Telegram. Возвращает, скольким поставлено. */
export function announce(db: DatabaseSync, text: unknown, now = Date.now()): number {
  const s = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) throw new Error("Впишите текст анонса");
  if (s.length > 3500) throw new Error("Анонс — не длиннее 3500 символов");
  const chats = allChats(db);
  if (!chats.length) throw new Error("Пока никто не подключил Telegram — отправлять некому");
  for (const chat of chats) enqueue(db, chat, s, {}, now);
  audit(db, "telegram.announce", { to: chats.length, length: s.length }, now);
  return chats.length;
}

// ---------- Настройки бота (settings) ----------

const getSetting = (db: DatabaseSync, key: string): unknown => {
  const r = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as { value_json: string } | undefined;
  try {
    return r ? JSON.parse(r.value_json) : null;
  } catch {
    return null;
  }
};
const setSetting = (db: DatabaseSync, key: string, value: unknown) =>
  db.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(value));

export const REMINDER_DEFAULT = "11:00";
/** Во сколько (по часам клуба) напоминать записанным в день турнира */
export function getReminderTime(db: DatabaseSync): string {
  const v = getSetting(db, "tg_reminder");
  return isTime(v) ? v : REMINDER_DEFAULT;
}
export function setReminderTime(db: DatabaseSync, time: unknown, now = Date.now()): string {
  if (!isTime(time)) throw new Error("Время — в виде 11:00");
  setSetting(db, "tg_reminder", time);
  audit(db, "telegram.reminder", { time }, now);
  return time;
}

/** Номер последнего обработанного сообщения от Telegram (чтобы не читать их заново после перезапуска) */
export const getOffset = (db: DatabaseSync): number => Number(getSetting(db, "tg_offset")) || 0;
export const setOffset = (db: DatabaseSync, offset: number) => void setSetting(db, "tg_offset", offset);

/** Сколько игроков подключили Telegram и сколько сообщений ждут отправки — для админки */
export function telegramStats(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM accounts WHERE telegram_id IS NOT NULL) AS linked,
              (SELECT COUNT(*) FROM telegram_outbox WHERE sent_at IS NULL AND tries < 5) AS waiting,
              (SELECT COUNT(*) FROM telegram_outbox WHERE sent_at IS NULL AND tries >= 5) AS failed`,
    )
    .get() as { linked: number; waiting: number; failed: number };
}
