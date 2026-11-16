// Вход игроков на сайт (docs/SITE.md, шаг 3): заявки, подтверждение админом, входы, пароль, ник, фото.
// Правила и проверки ввода — чистые функции в src/lib/account.ts.

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  FINALIST_MESSAGE_MAX,
  finalZone,
  isJpeg,
  PHOTO_MAX_BYTES,
  validateNick,
  validatePassword,
  validatePhone,
  validateRegistration,
  type AccountMe,
  type AccountRequest,
} from "../account";
import { formatPhone } from "../players";
import { finalistsOf, listPeriods, openPeriod, PERIOD_LABEL, standingsOf, type Period } from "./periods";
import { createPlayer, getPlayer } from "./players";
import type { PeriodKind } from "./settings";
import { audit } from "./sqlite";
import { chatOfAccount, enqueue, markRequestDone } from "./telegram";

/** Вход держится 30 дней */
export const SESSION_MS = 30 * 86_400_000;
/** Больше стольких неподтверждённых заявок не копим (защита от мусора) */
const MAX_PENDING = 100;

export type Account = { id: number; phone: string; name: string; playerId: number | null };

type AccountRow = { id: number; phone: string; name: string; pass_salt: string; pass_hash: string; player_id: number | null };

const hashOf = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const toAccount = (r: AccountRow): Account => ({ id: r.id, phone: r.phone, name: r.name, playerId: r.player_id });

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const rowByPhone = (db: DatabaseSync, phone: string) => db.prepare("SELECT * FROM accounts WHERE phone = ?").get(phone) as AccountRow | undefined;

function setPassword(db: DatabaseSync, accountId: number, password: string) {
  const salt = randomBytes(16).toString("hex");
  db.prepare("UPDATE accounts SET pass_salt = ?, pass_hash = ? WHERE id = ?").run(salt, hashOf(password, salt), accountId);
}

// ---------- Входы (cookie) ----------

/** Открыть вход: в cookie уходит случайная строка, в базе остаётся только её хэш */
export function openSession(db: DatabaseSync, accountId: number, now = Date.now()): string {
  db.prepare("DELETE FROM account_sessions WHERE expires_at <= ?").run(now);
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO account_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenHash(token), accountId, now, now + SESSION_MS);
  return token;
}

export function sessionAccount(db: DatabaseSync, token: string | undefined, now = Date.now()): Account | null {
  if (!token || token.length > 200) return null;
  const row = db
    .prepare("SELECT a.* FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .get(tokenHash(token), now) as AccountRow | undefined;
  return row ? toAccount(row) : null;
}

export function closeSession(db: DatabaseSync, token: string | undefined) {
  if (token) db.prepare("DELETE FROM account_sessions WHERE token_hash = ?").run(tokenHash(token));
}

// ---------- Заявка и вход ----------

/** Оставить заявку на вход. Возвращает строку для cookie: человек сразу видит «заявка ждёт подтверждения». */
export function register(db: DatabaseSync, input: unknown, now = Date.now()): string {
  const r = validateRegistration(input);
  const old = rowByPhone(db, r.phone);
  if (old) {
    throw new Error(old.player_id != null ? "Этот телефон уже зарегистрирован — войдите с паролем" : "Заявка с этим телефоном уже отправлена — дождитесь подтверждения в клубе");
  }
  const pending = (db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE player_id IS NULL").get() as { n: number }).n;
  if (pending >= MAX_PENDING) throw new Error("Сейчас слишком много заявок — попробуйте позже или подойдите к администратору");
  const salt = randomBytes(16).toString("hex");
  const id = Number(
    db
      .prepare("INSERT INTO accounts (phone, name, pass_salt, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(r.phone, r.name, salt, hashOf(r.password, salt), now).lastInsertRowid,
  );
  audit(db, "account.register", { id, name: r.name }, now);
  return openSession(db, id, now);
}

/** Войти по телефону и паролю. null — телефон или пароль не подошли. */
export function login(db: DatabaseSync, phone: unknown, password: unknown, now = Date.now()): string | null {
  let normalized: string;
  try {
    normalized = validatePhone(phone);
  } catch {
    return null;
  }
  const row = rowByPhone(db, normalized);
  // хэш считаем и когда аккаунта нет — чтобы по времени ответа нельзя было узнать, чей телефон зарегистрирован
  const ok = safeEqual(hashOf(typeof password === "string" ? password : "", row?.pass_salt ?? "00"), row?.pass_hash ?? "");
  return row && ok ? openSession(db, row.id, now) : null;
}

/** Сменить пароль; остальные входы этого игрока (на других устройствах) закрываются */
export function changePassword(db: DatabaseSync, account: Account, oldPassword: unknown, newPassword: unknown, keepToken: string | undefined, now = Date.now()) {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(account.id) as AccountRow;
  if (!safeEqual(hashOf(typeof oldPassword === "string" ? oldPassword : "", row.pass_salt), row.pass_hash)) throw new Error("Текущий пароль не подошёл");
  setPassword(db, account.id, validatePassword(newPassword));
  db.prepare("DELETE FROM account_sessions WHERE account_id = ? AND token_hash <> ?").run(account.id, keepToken ? tokenHash(keepToken) : "");
  audit(db, "account.password", { id: account.id }, now);
}

// ---------- Админ: заявки ----------

export function listRequests(db: DatabaseSync): AccountRequest[] {
  return (
    db
      .prepare(
        `SELECT a.id, a.name, a.phone, a.created_at, p.id AS player_id, p.name AS player_name
         FROM accounts a LEFT JOIN players p ON p.phone = a.phone AND p.archived_at IS NULL
         WHERE a.player_id IS NULL ORDER BY a.created_at, a.id`,
      )
      .all() as { id: number; name: string; phone: string; created_at: number; player_id: number | null; player_name: string | null }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    createdAt: r.created_at,
    match: r.player_id != null ? { playerId: r.player_id, name: r.player_name! } : null,
  }));
}

function pendingRow(db: DatabaseSync, id: number) {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!row) throw new Error("Заявка не найдена");
  if (row.player_id != null) throw new Error("Эта заявка уже подтверждена");
  return row;
}

/**
 * Подтвердить заявку. playerId — к какому игроку привязать (админ выбрал сам); не указан — игрок с таким же
 * телефоном, а если такого нет — в базе появляется новый игрок с именем и телефоном из заявки.
 */
export function confirmRequest(db: DatabaseSync, id: number, playerId: number | null, now = Date.now()): { playerId: number; created: boolean } {
  const row = pendingRow(db, id);
  let target = playerId;
  let created = false;
  if (target == null) {
    target = (db.prepare("SELECT id FROM players WHERE phone = ? AND archived_at IS NULL").get(row.phone) as { id: number } | undefined)?.id ?? null;
  }
  if (target == null) {
    target = createPlayer(db, { name: row.name, phone: row.phone }, now).id;
    created = true;
  }
  const player = getPlayer(db, target);
  if (!player) throw new Error("Игрок не найден");
  if (db.prepare("SELECT 1 FROM accounts WHERE player_id = ?").get(target)) throw new Error(`У игрока «${player.name}» уже есть вход на сайт`);
  db.prepare("UPDATE accounts SET player_id = ?, confirmed_at = ? WHERE id = ?").run(target, now, id);
  audit(db, "account.confirm", { id, playerId: target, created }, now);
  // в сообщении о заявке у админов — пометка; самому игроку (если подключён Telegram) — «заявка подтверждена»
  markRequestDone(db, id, `✅ Подтверждена: ${created ? `новый игрок «${player.name}»` : `игрок «${player.name}»`}`, now);
  enqueue(db, chatOfAccount(db, id), `✅ ${player.name}, ваша заявка подтверждена! Теперь в личном кабинете и в боте видны ваш рейтинг, статистика и достижения.`, { dedupe: `confirmed:${id}` }, now);
  return { playerId: target, created };
}

export function rejectRequest(db: DatabaseSync, id: number, now = Date.now()) {
  const row = pendingRow(db, id);
  markRequestDone(db, id, "❌ Отклонена", now);
  db.prepare("UPDATE accounts SET telegram_id = NULL WHERE id = ?").run(id);
  db.prepare("DELETE FROM telegram_codes WHERE account_id = ?").run(id);
  db.prepare("DELETE FROM account_sessions WHERE account_id = ?").run(id);
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  audit(db, "account.reject", { id, name: row.name }, now);
}

// ---------- Админ: вход игрока в его карточке ----------

/** Есть ли у игрока вход на сайт (для карточки игрока в админке) */
export function accountOfPlayer(db: DatabaseSync, playerId: number): { phone: string; confirmedAt: number | null } | null {
  const r = db.prepare("SELECT phone, confirmed_at FROM accounts WHERE player_id = ?").get(playerId) as { phone: string; confirmed_at: number | null } | undefined;
  return r ? { phone: r.phone, confirmedAt: r.confirmed_at } : null;
}

/** Игрок забыл пароль: админ сбрасывает — получает временный пароль (показывается один раз), все входы игрока закрываются */
export function resetPassword(db: DatabaseSync, playerId: number, now = Date.now()): string {
  const row = db.prepare("SELECT * FROM accounts WHERE player_id = ?").get(playerId) as AccountRow | undefined;
  if (!row) throw new Error("У этого игрока нет входа на сайт");
  const password = String(randomInt(0, 100_000_000)).padStart(8, "0");
  setPassword(db, row.id, password);
  db.prepare("DELETE FROM account_sessions WHERE account_id = ?").run(row.id);
  audit(db, "account.reset", { playerId }, now);
  return password;
}

/** Отключить вход игрока (например, вход привязали не к тому человеку). Сам игрок и его история остаются. */
export function removeAccount(db: DatabaseSync, playerId: number, now = Date.now()) {
  const row = db.prepare("SELECT id FROM accounts WHERE player_id = ?").get(playerId) as { id: number } | undefined;
  if (!row) throw new Error("У этого игрока нет входа на сайт");
  db.prepare("DELETE FROM account_sessions WHERE account_id = ?").run(row.id);
  db.prepare("DELETE FROM accounts WHERE id = ?").run(row.id);
  audit(db, "account.remove", { playerId }, now);
}

// ---------- Ник ----------

const fold = (s: string) => s.toLowerCase().replaceAll("ё", "е");

/** Игрок меняет свой ник. Чужой ник (без учёта регистра) взять нельзя. */
export function renamePlayer(db: DatabaseSync, playerId: number, name: unknown, now = Date.now()): string {
  const next = validateNick(name);
  const player = getPlayer(db, playerId);
  if (!player) throw new Error("Игрок не найден");
  if (next === player.name) return next;
  const taken = (db.prepare("SELECT name FROM players WHERE id <> ? AND archived_at IS NULL").all(playerId) as { name: string }[]).some((p) => fold(p.name) === fold(next));
  if (taken) throw new Error("Такой ник уже есть у другого игрока — выберите другой");
  db.prepare("UPDATE players SET name = ?, updated_at = ? WHERE id = ?").run(next, now, playerId);
  audit(db, "account.rename", { playerId, before: player.name, after: next }, now);
  return next;
}

// ---------- Фото ----------

/** Поставить фото игрока: JPEG, уже уменьшенный в браузере. by — кто поставил: сам игрок или админ. */
export function setPhoto(db: DatabaseSync, playerId: number, jpeg: Uint8Array, by: "player" | "admin", now = Date.now()): number {
  if (!getPlayer(db, playerId)) throw new Error("Игрок не найден");
  if (jpeg.length > PHOTO_MAX_BYTES) throw new Error("Фото слишком большое — выберите другое");
  if (!isJpeg(jpeg)) throw new Error("Не получилось прочитать фото — выберите обычную картинку (JPG или PNG)");
  db.prepare("INSERT INTO player_photos (player_id, jpeg, updated_at) VALUES (?, ?, ?) ON CONFLICT (player_id) DO UPDATE SET jpeg = excluded.jpeg, updated_at = excluded.updated_at").run(
    playerId,
    jpeg,
    now,
  );
  audit(db, "photo.set", { playerId, by }, now);
  return now;
}

export function removePhoto(db: DatabaseSync, playerId: number, by: "player" | "admin", now = Date.now()) {
  const done = db.prepare("DELETE FROM player_photos WHERE player_id = ?").run(playerId).changes;
  if (done) audit(db, "photo.remove", { playerId, by }, now);
}

export function getPhoto(db: DatabaseSync, playerId: number): Uint8Array | null {
  const r = db.prepare("SELECT jpeg FROM player_photos WHERE player_id = ?").get(playerId) as { jpeg: Uint8Array } | undefined;
  return r ? r.jpeg : null;
}

/** У кого есть фото: { [playerId]: версия } — сайт по этому списку решает, показывать картинку или первую букву ника */
export function photoVersions(db: DatabaseSync): Record<number, number> {
  return Object.fromEntries((db.prepare("SELECT player_id, updated_at FROM player_photos").all() as { player_id: number; updated_at: number }[]).map((r) => [r.player_id, r.updated_at]));
}

// ---------- Сообщение финалистам (settings, ключ «finalist_message») ----------

export function getFinalistMessage(db: DatabaseSync): string {
  const r = db.prepare("SELECT value_json FROM settings WHERE key = 'finalist_message'").get() as { value_json: string } | undefined;
  try {
    return r ? String(JSON.parse(r.value_json) ?? "") : "";
  } catch {
    return "";
  }
}

export function saveFinalistMessage(db: DatabaseSync, text: unknown, now = Date.now()): string {
  const s = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (s.length > FINALIST_MESSAGE_MAX) throw new Error(`Сообщение — не длиннее ${FINALIST_MESSAGE_MAX} символов`);
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('finalist_message', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(s));
  audit(db, "finalist.message", {}, now);
  return s;
}

// ---------- Личный кабинет ----------

const periodLabel = (p: Period) => `${PERIOD_LABEL[p.kind]} · ${p.name}`;

/** Что видит вошедший игрок: статус заявки, а после подтверждения — профиль и всё про финал */
export function accountMe(db: DatabaseSync, account: Account): AccountMe {
  const telegram = (db.prepare("SELECT telegram_id FROM accounts WHERE id = ?").get(account.id) as { telegram_id: number | null } | undefined)?.telegram_id != null;
  if (account.playerId == null) return { status: "pending", name: account.name, phone: formatPhone(account.phone), telegram };
  const player = getPlayer(db, account.playerId);
  // игрока убрали в архив — вход остаётся, но показать нечего: как заявка
  if (!player) return { status: "pending", name: account.name, phone: formatPhone(account.phone), telegram };
  // «Путь в финал» — только по идущему месяцу (решение владельца)
  const month = openPeriod(db, "month");
  const zones = month ? [{ label: periodLabel(month), zone: finalZone(standingsOf(db, month), player.id, month.finalistsN) }] : [];
  const played = db.prepare("SELECT 1 FROM tournaments WHERE final_of_period_id = ? AND status = 'finished'");
  // только последний закрытый период каждого вида: старые без сыгранного финала в кабинете не висят
  const lastClosed = new Map<PeriodKind, Period>();
  for (const p of listPeriods(db)) {
    const cur = lastClosed.get(p.kind);
    if (p.closedAt != null && (!cur || p.closedAt > cur.closedAt!)) lastClosed.set(p.kind, p);
  }
  const finalistOf = [...lastClosed.values()]
    .filter((p) => !played.get(p.id) && finalistsOf(db, p).finalists.some((f) => f.playerId === player.id))
    .map(periodLabel);
  const photo = (db.prepare("SELECT updated_at FROM player_photos WHERE player_id = ?").get(player.id) as { updated_at: number } | undefined)?.updated_at ?? null;
  return {
    status: "active",
    playerId: player.id,
    name: player.name,
    phone: formatPhone(account.phone),
    telegram,
    photo,
    zones,
    finalistOf,
    finalistMessage: finalistOf.length ? getFinalistMessage(db) : "",
  };
}
