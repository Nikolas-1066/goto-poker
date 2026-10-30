// Касса в базе (docs/CASH.md): начисления берутся из журнала events (цена и «бесплатно»),
// оплаты — из payments. Оплата относится к турниру, за который платят.

import type { DatabaseSync } from "node:sqlite";
import {
  cashByPlayer,
  cashSummary,
  checkPayment,
  type Charge,
  type ChargeType,
  type PayMethod,
  type Payment,
} from "../cash";
import { audit } from "./sqlite";

export function loadCharges(db: DatabaseSync, tournamentId: number): Charge[] {
  const rows = db
    .prepare(
      `SELECT e.id, p.player_id, e.type, e.price, e.free, e.cancelled_at, e.at
       FROM events e JOIN participants p ON p.id = e.participant_id
       WHERE e.tournament_id = ? AND e.type <> 'bust' ORDER BY e.at, e.id`,
    )
    .all(tournamentId) as {
    id: number;
    player_id: number;
    type: ChargeType;
    price: number;
    free: number;
    cancelled_at: number | null;
    at: number;
  }[];
  return rows.map((r) => ({
    eventId: r.id,
    playerId: r.player_id,
    type: r.type,
    price: r.price,
    free: r.free === 1,
    cancelled: r.cancelled_at != null,
    at: r.at,
  }));
}

export function loadPayments(db: DatabaseSync, tournamentId: number): Payment[] {
  const rows = db
    .prepare("SELECT id, player_id, amount, method, at, cancelled_at FROM payments WHERE tournament_id = ? ORDER BY at, id")
    .all(tournamentId) as { id: number; player_id: number; amount: number; method: PayMethod; at: number; cancelled_at: number | null }[];
  return rows.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    amount: r.amount,
    method: r.method,
    at: r.at,
    cancelled: r.cancelled_at != null,
  }));
}

/** Касса турнира: по игрокам (ключ — playerId) и общий итог */
export function tournamentCash(db: DatabaseSync, tournamentId: number) {
  const players = cashByPlayer(loadCharges(db, tournamentId), loadPayments(db, tournamentId));
  return { players, summary: cashSummary(players.values()) };
}

/** Принять оплату от игрока за турнир (не больше его долга по этому турниру) */
export function addPayment(
  db: DatabaseSync,
  p: { tournamentId: number; playerId: number; amount: number; method: PayMethod },
  now = Date.now(),
) {
  const debt = tournamentCash(db, p.tournamentId).players.get(p.playerId)?.debt ?? 0;
  const error = checkPayment(p.amount, p.method, debt);
  if (error) throw new Error(error);
  const id = Number(
    db
      .prepare("INSERT INTO payments (tournament_id, player_id, amount, method, at) VALUES (?, ?, ?, ?, ?)")
      .run(p.tournamentId, p.playerId, p.amount, p.method, now).lastInsertRowid,
  );
  audit(db, "cash.pay", { ...p, paymentId: id }, now);
  return id;
}

/** Отменить ошибочную оплату */
export function cancelPayment(db: DatabaseSync, tournamentId: number, paymentId: number, now = Date.now()) {
  const row = db
    .prepare("SELECT id, player_id, amount FROM payments WHERE id = ? AND tournament_id = ? AND cancelled_at IS NULL")
    .get(paymentId, tournamentId) as { id: number; player_id: number; amount: number } | undefined;
  if (!row) throw new Error("Эта оплата уже отменена");
  db.prepare("UPDATE payments SET cancelled_at = ? WHERE id = ?").run(now, row.id);
  audit(db, "cash.cancelPayment", { tournamentId, paymentId, playerId: row.player_id, amount: row.amount }, now);
  return row;
}

/** Отметить вход / re-entry / аддон бесплатным (или снять отметку) */
export function setEventFree(db: DatabaseSync, tournamentId: number, eventId: number, free: boolean, now = Date.now()) {
  const row = db
    .prepare("SELECT id, type FROM events WHERE id = ? AND tournament_id = ? AND cancelled_at IS NULL AND type <> 'bust'")
    .get(eventId, tournamentId) as { id: number; type: ChargeType } | undefined;
  if (!row) throw new Error("Действие не найдено или отменено");
  db.prepare("UPDATE events SET free = ? WHERE id = ?").run(free ? 1 : 0, row.id);
  audit(db, "cash.free", { tournamentId, eventId, free }, now);
  return row;
}

/** Есть ли у игрока в турнире не отменённые оплаты (тогда убрать из записи нельзя) */
export function hasPayments(db: DatabaseSync, tournamentId: number, playerId: number) {
  return !!db
    .prepare("SELECT 1 FROM payments WHERE tournament_id = ? AND player_id = ? AND cancelled_at IS NULL LIMIT 1")
    .get(tournamentId, playerId);
}

export type PlayerDebt = { tournamentId: number; name: string; date: number; debt: number };

/** Долги игрока по всем турнирам (кроме `exceptTournamentId`), старые сначала */
export function playerDebts(db: DatabaseSync, playerId: number, exceptTournamentId?: number) {
  const list = db
    .prepare(
      `SELECT DISTINCT t.id, t.name, COALESCE(t.started_at, t.created_at) AS date
       FROM tournaments t
       WHERE t.id <> ? AND (
         EXISTS (SELECT 1 FROM events e JOIN participants p ON p.id = e.participant_id
                 WHERE e.tournament_id = t.id AND p.player_id = ? AND e.price > 0 AND e.free = 0 AND e.cancelled_at IS NULL)
         OR EXISTS (SELECT 1 FROM payments x WHERE x.tournament_id = t.id AND x.player_id = ? AND x.cancelled_at IS NULL))
       ORDER BY date, t.id`,
    )
    .all(exceptTournamentId ?? -1, playerId, playerId) as { id: number; name: string; date: number }[];
  const debts: PlayerDebt[] = [];
  for (const t of list) {
    const debt = tournamentCash(db, t.id).players.get(playerId)?.debt ?? 0;
    if (debt > 0) debts.push({ tournamentId: t.id, name: t.name, date: t.date, debt });
  }
  return { debts, total: debts.reduce((s, d) => s + d.debt, 0) };
}
