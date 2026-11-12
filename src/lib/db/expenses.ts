// Расходы турнира в базе (docs/CASH.md, «Расходы»).

import type { DatabaseSync } from "node:sqlite";
import { sanitizeExpense, type Expense, type ExpenseKind } from "../expenses";
import { audit } from "./sqlite";

type Row = { id: number; tournament_id: number; kind: ExpenseKind; name: string; hours: number | null; amount: number; note: string; at: number };

const fromRow = (r: Row): Expense => ({
  id: r.id,
  tournamentId: r.tournament_id,
  kind: r.kind,
  name: r.name,
  hours: r.hours,
  amount: r.amount,
  note: r.note,
  at: r.at,
});

export function listExpenses(db: DatabaseSync, tournamentId: number): Expense[] {
  return (db.prepare("SELECT * FROM expenses WHERE tournament_id = ? ORDER BY kind, id").all(tournamentId) as Row[]).map(fromRow);
}

/** Все расходы с датой турнира — для статистики */
export function allExpenses(db: DatabaseSync): (Expense & { tournamentAt: number })[] {
  return (
    db
      .prepare(
        `SELECT e.*, COALESCE(t.started_at, t.created_at) AS tournament_at
         FROM expenses e JOIN tournaments t ON t.id = e.tournament_id`,
      )
      .all() as (Row & { tournament_at: number })[]
  ).map((r) => ({ ...fromRow(r), tournamentAt: r.tournament_at }));
}

/** Имена, которые уже вписывали (для подсказки), частые сверху */
export function expenseNames(db: DatabaseSync): Record<ExpenseKind, string[]> {
  const out: Record<ExpenseKind, string[]> = { dealer: [], admin: [], other: [] };
  const rows = db
    .prepare("SELECT kind, name, COUNT(*) AS n FROM expenses GROUP BY kind, name ORDER BY n DESC, MAX(at) DESC")
    .all() as { kind: ExpenseKind; name: string }[];
  for (const r of rows) if (out[r.kind] && out[r.kind].length < 30) out[r.kind].push(r.name);
  return out;
}

export function addExpense(db: DatabaseSync, tournamentId: number, input: unknown, now = Date.now()) {
  const e = sanitizeExpense(input);
  const id = Number(
    db
      .prepare("INSERT INTO expenses (tournament_id, kind, name, hours, amount, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(tournamentId, e.kind, e.name, e.hours, e.amount, e.note, now).lastInsertRowid,
  );
  audit(db, "expense.add", { tournamentId, id, ...e }, now);
  return id;
}

export function deleteExpense(db: DatabaseSync, tournamentId: number, expenseId: number, now = Date.now()) {
  const row = db.prepare("SELECT * FROM expenses WHERE id = ? AND tournament_id = ?").get(expenseId, tournamentId) as Row | undefined;
  if (!row) throw new Error("Расход не найден — возможно, уже удалён");
  db.prepare("DELETE FROM expenses WHERE id = ?").run(row.id);
  audit(db, "expense.delete", { tournamentId, expense: fromRow(row) }, now);
}
