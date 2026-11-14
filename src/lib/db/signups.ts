// Запись игроков на будущие турниры в базе (docs/SITE.md, шаг 4). Правила — чистые функции в src/lib/signup.ts.

import type { DatabaseSync } from "node:sqlite";
import { clubToday, sortSchedule, type ScheduleItem } from "../schedule";
import { sanitizeGuests, signupOpen, splitQueue, type MySignup, type SignupState, type SiteSignups } from "../signup";
import type { Db } from "../types";
import type { Account } from "./accounts";
import { getItem, listSchedule } from "./schedule";
import { audit } from "./sqlite";
import { chatOfAccount, chatOfPlayer, enqueue } from "./telegram";
import { promotedText } from "../telegram/texts";
import { applyPlayerAction, currentTournament } from "./tournament";

/** Запись, как её видит админ: с никами гостей и пометками */
export type AdminSignup = {
  id: number;
  /** null — человек зарегистрировался на сайте, но админ ещё не подтвердил заявку */
  playerId: number | null;
  name: string;
  guests: number;
  guestNames: string[];
  byAdmin: boolean;
  createdAt: number;
  state: SignupState;
};

type Row = {
  id: number;
  schedule_id: number;
  account_id: number | null;
  player_id: number | null;
  name: string | null;
  guests: number;
  guest_names: string;
  by_admin: number;
  created_at: number;
};

// игрок записи — тот, кого записал админ, либо игрок подтверждённого входа; имя — игрока, а пока его нет — из заявки
const SELECT = `SELECT s.id, s.schedule_id, s.account_id, COALESCE(s.player_id, a.player_id) AS player_id,
                       COALESCE(p.name, a.name) AS name, s.guests, s.guest_names, s.by_admin, s.created_at
                FROM signups s
                LEFT JOIN accounts a ON a.id = s.account_id
                LEFT JOIN players p ON p.id = COALESCE(s.player_id, a.player_id)
                WHERE s.cancelled_at IS NULL`;

const names = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const activeRows = (db: DatabaseSync, scheduleId: number) => db.prepare(`${SELECT} AND s.schedule_id = ? ORDER BY s.created_at, s.id`).all(scheduleId) as Row[];

/** Записи на турнир по порядку: сначала записанные, потом лист ожидания */
export function listSignups(db: DatabaseSync, item: Pick<ScheduleItem, "id" | "seatLimit">): AdminSignup[] {
  const q = splitQueue(activeRows(db, item.id), item.seatLimit);
  const view = (state: SignupState) => (r: Row): AdminSignup => ({
    id: r.id,
    playerId: r.player_id,
    name: r.name ?? "?",
    guests: r.guests,
    guestNames: names(r.guest_names),
    byAdmin: !!r.by_admin,
    createdAt: r.created_at,
    state,
  });
  return [...q.going.map(view("going")), ...q.waiting.map(view("waiting"))];
}

/** Что видно всем на сайте: имена и число гостей (ники гостей — только в админке) */
export function siteSignups(db: DatabaseSync, item: ScheduleItem, now = Date.now()): SiteSignups {
  const q = splitQueue(activeRows(db, item.id), item.seatLimit);
  const pub = (r: Row) => ({ playerId: r.player_id, name: r.name ?? "?", guests: r.guests });
  return { going: q.going.map(pub), waiting: q.waiting.map(pub), seats: q.seats, free: q.free, open: signupOpen(item, now) };
}

/** Кто сейчас в листе ожидания (номера записей) — чтобы после изменения узнать, кто из него прошёл */
const waitingIds = (db: DatabaseSync, item: Pick<ScheduleItem, "id" | "seatLimit">) => new Set(splitQueue(activeRows(db, item.id), item.seatLimit).waiting.map((r) => r.id));

/** Место освободилось: кто был в листе ожидания, а теперь записан, — тому бот пишет «вы записаны» */
function notifyPromoted(db: DatabaseSync, item: ScheduleItem, before: Set<number>, now: number) {
  for (const r of splitQueue(activeRows(db, item.id), item.seatLimit).going) {
    if (!before.has(r.id)) continue;
    const chat = r.account_id != null ? chatOfAccount(db, r.account_id) : r.player_id != null ? chatOfPlayer(db, r.player_id) : null;
    enqueue(db, chat, promotedText(item), { dedupe: `promoted:${r.id}` }, now);
  }
}

/** Чаты записанных (прошедших по лимиту), у кого подключён Telegram, — для напоминания в день турнира */
export function goingChats(db: DatabaseSync, item: Pick<ScheduleItem, "id" | "seatLimit">): { chat: number; guests: number }[] {
  return splitQueue(activeRows(db, item.id), item.seatLimit)
    .going.map((r) => ({ chat: r.account_id != null ? chatOfAccount(db, r.account_id) : r.player_id != null ? chatOfPlayer(db, r.player_id) : null, guests: r.guests }))
    .filter((r): r is { chat: number; guests: number } => r.chat != null);
}

/** Снять запись игрока на турнир, из которого он убран как не пришедший (регистрация закрылась) */
export function dropSignupOfTournament(db: DatabaseSync, tournamentId: number, playerId: number, now = Date.now()) {
  const rows = db.prepare(`${SELECT} AND s.schedule_id IN (SELECT id FROM schedule WHERE tournament_id = ?)`).all(tournamentId) as Row[];
  for (const r of rows.filter((x) => x.player_id === playerId)) {
    db.prepare("UPDATE signups SET cancelled_at = ? WHERE id = ?").run(now, r.id);
    audit(db, "signup.cancel", { id: r.id, scheduleId: r.schedule_id, auto: "late" }, now);
  }
}

type Who = { account: Account } | { playerId: number };

function findMine(db: DatabaseSync, scheduleId: number, who: Who): Row | undefined {
  const rows = activeRows(db, scheduleId);
  if ("playerId" in who) return rows.find((r) => r.player_id === who.playerId);
  return rows.find((r) => r.account_id === who.account.id || (who.account.playerId != null && r.player_id === who.account.playerId));
}

/**
 * Записаться (или поменять число гостей — место в очереди сохраняется). Игрок — до времени начала по расписанию;
 * админ записывает игрока из базы в любой момент, пока турнир не отменён.
 */
export function signUp(db: DatabaseSync, scheduleId: number, who: Who, input: unknown, now = Date.now()): number {
  const item = getItem(db, scheduleId);
  const byAdmin = "playerId" in who;
  if (item.status === "cancelled") throw new Error("Этот турнир отменён");
  if (!byAdmin && !signupOpen(item, now)) throw new Error("Запись на этот турнир уже закрыта — он начался");
  if (byAdmin && !db.prepare("SELECT 1 FROM players WHERE id = ? AND archived_at IS NULL").get(who.playerId)) throw new Error("Игрок не найден");
  const g = sanitizeGuests(input);
  const mine = findMine(db, scheduleId, who);
  if (mine) {
    const before = waitingIds(db, item);
    db.prepare("UPDATE signups SET guests = ?, guest_names = ? WHERE id = ?").run(g.guests, JSON.stringify(g.guestNames), mine.id);
    audit(db, "signup.update", { id: mine.id, scheduleId, guests: g.guests }, now);
    before.delete(mine.id); // сам себе «вы прошли» не пишем
    notifyPromoted(db, item, before, now); // гостей стало меньше — место могло освободиться
    return mine.id;
  }
  const id = Number(
    db
      .prepare("INSERT INTO signups (schedule_id, account_id, player_id, guests, guest_names, by_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(scheduleId, byAdmin ? null : who.account.id, byAdmin ? who.playerId : null, g.guests, JSON.stringify(g.guestNames), byAdmin ? 1 : 0, now).lastInsertRowid,
  );
  audit(db, "signup.add", { id, scheduleId, guests: g.guests, byAdmin }, now);
  return id;
}

/** Отменить запись: игрок — свою (в любой момент), админ — любую по номеру. Возвращает игрока записи (если он известен). */
export function cancelSignup(db: DatabaseSync, target: { scheduleId: number; account: Account } | { signupId: number }, now = Date.now()): { scheduleId: number; playerId: number | null } {
  const row =
    "signupId" in target
      ? (db.prepare(`${SELECT} AND s.id = ?`).get(target.signupId) as Row | undefined)
      : findMine(db, target.scheduleId, { account: target.account });
  if (!row) throw new Error("Запись не найдена");
  const item = getItem(db, row.schedule_id);
  const before = waitingIds(db, item);
  db.prepare("UPDATE signups SET cancelled_at = ? WHERE id = ?").run(now, row.id);
  notifyPromoted(db, item, before, now);
  audit(db, "signup.cancel", { id: row.id, scheduleId: row.schedule_id, byAdmin: "signupId" in target }, now);
  return { scheduleId: row.schedule_id, playerId: row.player_id };
}

/** Мои записи на ближайшие турниры — для кнопок на карточках и блока в личном кабинете */
export function mySignups(db: DatabaseSync, account: Account, now = Date.now()): MySignup[] {
  const today = clubToday(now);
  const out: MySignup[] = [];
  for (const item of sortSchedule(listSchedule(db, today))) {
    if (item.status === "cancelled") continue;
    const rows = activeRows(db, item.id);
    const mine = rows.find((r) => r.account_id === account.id || (account.playerId != null && r.player_id === account.playerId));
    if (!mine) continue;
    const q = splitQueue(rows, item.seatLimit);
    const queue = q.waiting.indexOf(mine) + 1;
    out.push({
      scheduleId: item.id,
      date: item.date,
      time: item.time,
      name: item.name,
      guests: mine.guests,
      guestNames: names(mine.guest_names),
      state: queue ? "waiting" : "going",
      queue,
      started: item.status === "started",
    });
  }
  return out;
}

// ---------- Связь с открытым турниром ----------

/** Строка расписания открыта и её турнир — текущий и не завершён? Тогда записи нужно держать вровень с турниром. */
function liveTournament(db: DatabaseSync, item: ScheduleItem): number | null {
  if (item.status !== "started" || item.tournamentId == null) return null;
  const cur = db.prepare("SELECT id, status FROM tournaments WHERE is_current = 1").get() as { id: number; status: string } | undefined;
  return cur && cur.id === item.tournamentId && cur.status !== "finished" ? cur.id : null;
}

/**
 * Перенести записанных в открытый турнир («записан», ещё не пришёл). Только тех, кто прошёл по лимиту и чей игрок
 * известен; кого записать нельзя (например, в финал — не финалиста) — пропускает. Вызывается внутри updateDb.
 */
export function syncSignups(db: DatabaseSync, next: Db, scheduleId: number, now = Date.now()): number {
  const item = getItem(db, scheduleId);
  const tid = liveTournament(db, item);
  if (tid == null) return 0;
  const has = db.prepare("SELECT 1 FROM participants WHERE tournament_id = ? AND player_id = ?");
  let added = 0;
  for (const r of splitQueue(activeRows(db, scheduleId), item.seatLimit).going) {
    if (r.player_id == null || has.get(tid, r.player_id)) continue;
    try {
      applyPlayerAction(db, next, { type: "register", playerId: r.player_id }, now);
      added += 1;
    } catch {
      // этого игрока записать в турнир нельзя — остаётся только в списке записи
    }
  }
  return added;
}

/** То же по всем открытым строкам расписания (после подтверждения заявки на вход у записи появляется игрок) */
export function syncAllSignups(db: DatabaseSync, next: Db, now = Date.now()) {
  for (const r of db.prepare("SELECT id FROM schedule WHERE status = 'started'").all() as { id: number }[]) syncSignups(db, next, r.id, now);
}

/**
 * Запись отменили, а турнир уже открыт: убрать игрока из записавшихся в турнире, если он ещё не пришёл.
 * strict — отменяет сам игрок: если он уже отмечен в турнире, отменять нечего — ошибка.
 */
export function unsyncSignup(db: DatabaseSync, next: Db, scheduleId: number, playerId: number | null, strict: boolean, now = Date.now()) {
  if (playerId == null) return;
  const tid = liveTournament(db, getItem(db, scheduleId));
  if (tid == null) return;
  const p = db.prepare("SELECT id, status FROM participants WHERE tournament_id = ? AND player_id = ?").get(tid, playerId) as { id: number; status: string } | undefined;
  if (!p) return;
  if (p.status !== "registered") {
    if (strict) throw new Error("Вы уже отмечены в турнире — отменить запись нельзя");
    return;
  }
  try {
    applyPlayerAction(db, next, { type: "unregister", participantId: p.id }, now);
  } catch (err) {
    if (strict) throw err;
  }
}

/** Гости записанных — для турнира в админке: { [playerId]: { guests, guestNames } } */
export function guestsOfTournament(db: DatabaseSync, tournamentId = currentTournament(db).id): Record<number, { guests: number; guestNames: string[] }> {
  const rows = db
    .prepare(`${SELECT} AND s.guests > 0 AND s.schedule_id IN (SELECT id FROM schedule WHERE tournament_id = ?)`)
    .all(tournamentId) as Row[];
  return Object.fromEntries(rows.filter((r) => r.player_id != null).map((r) => [r.player_id!, { guests: r.guests, guestNames: names(r.guest_names) }]));
}
