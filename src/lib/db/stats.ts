// Данные для статистики клуба (docs/STATS.md). Подсчёт — чистые функции в src/lib/stats.ts.

import type { DatabaseSync } from "node:sqlite";
import type { PayMethod } from "../cash";
import type { StatsData } from "../stats";
import { allExpenses } from "./expenses";

export function loadStatsData(db: DatabaseSync): StatsData {
  const tournaments = (
    db
      .prepare(
        `SELECT id, COALESCE(started_at, created_at) AS at, mode, entries, rebuys, addons, double_addons
         FROM tournaments WHERE status = 'finished'`,
      )
      .all() as { id: number; at: number; mode: "manual" | "players"; entries: number; rebuys: number; addons: number; double_addons: number }[]
  ).map((t) => ({
    id: t.id,
    at: t.at,
    mode: t.mode,
    counters: { entries: t.entries, rebuys: t.rebuys, addons: t.addons, doubleAddons: t.double_addons },
  }));

  const participations = (
    db
      .prepare(
        `SELECT p.tournament_id, p.player_id, pl.name, p.entries,
                (SELECT COUNT(*) FROM events e WHERE e.participant_id = p.id AND e.type = 'addon' AND e.cancelled_at IS NULL) AS addons,
                (SELECT COUNT(*) FROM events e WHERE e.participant_id = p.id AND e.type = 'double_addon' AND e.cancelled_at IS NULL) AS double_addons
         FROM participants p
         JOIN players pl ON pl.id = p.player_id
         JOIN tournaments t ON t.id = p.tournament_id
         WHERE t.status = 'finished' AND t.mode = 'players' AND p.status IN ('playing', 'busted')`,
      )
      .all() as { tournament_id: number; player_id: number; name: string; entries: number; addons: number; double_addons: number }[]
  ).map((p) => ({
    tournamentId: p.tournament_id,
    playerId: p.player_id,
    name: p.name,
    entries: Math.max(1, p.entries),
    addons: p.addons,
    doubleAddons: p.double_addons,
  }));

  const payments = (
    db
      .prepare(
        `SELECT x.tournament_id, x.player_id, pl.name, x.amount, x.method, x.at
         FROM payments x JOIN players pl ON pl.id = x.player_id WHERE x.cancelled_at IS NULL`,
      )
      .all() as { tournament_id: number; player_id: number; name: string; amount: number; method: PayMethod; at: number }[]
  ).map((p) => ({ tournamentId: p.tournament_id, playerId: p.player_id, name: p.name, amount: p.amount, method: p.method, at: p.at }));

  // касса по игроку и турниру: начислено и бесплатно — из журнала, оплачено — все оплаты за турнир
  const cash = (
    db
      .prepare(
        `WITH ch AS (
           SELECT e.tournament_id AS tid, p.player_id AS pid,
                  SUM(CASE WHEN e.free = 0 THEN e.price ELSE 0 END) AS charged,
                  SUM(CASE WHEN e.free = 1 THEN e.price ELSE 0 END) AS free
           FROM events e JOIN participants p ON p.id = e.participant_id
           WHERE e.type <> 'bust' AND e.cancelled_at IS NULL AND e.price > 0
           GROUP BY e.tournament_id, p.player_id),
         pay AS (
           SELECT tournament_id AS tid, player_id AS pid, SUM(amount) AS paid
           FROM payments WHERE cancelled_at IS NULL GROUP BY tournament_id, player_id)
         SELECT ch.tid, ch.pid, ch.charged, ch.free, COALESCE(pay.paid, 0) AS paid
         FROM ch LEFT JOIN pay ON pay.tid = ch.tid AND pay.pid = ch.pid
         UNION ALL
         SELECT pay.tid, pay.pid, 0, 0, pay.paid
         FROM pay WHERE NOT EXISTS (SELECT 1 FROM ch WHERE ch.tid = pay.tid AND ch.pid = pay.pid)`,
      )
      .all() as { tid: number; pid: number; charged: number; free: number; paid: number }[]
  ).map((c) => ({ tournamentId: c.tid, playerId: c.pid, charged: c.charged, free: c.free, paid: c.paid }));

  const firstVisits = (db.prepare("SELECT first_visit_at AS at FROM players WHERE first_visit_at IS NOT NULL").all() as { at: number }[]).map(
    (r) => r.at,
  );

  const expenses = allExpenses(db).map((e) => ({
    tournamentId: e.tournamentId,
    tournamentAt: e.tournamentAt,
    kind: e.kind,
    name: e.name,
    hours: e.hours,
    amount: e.amount,
  }));

  return { tournaments, participations, payments, cash, firstVisits, expenses };
}
