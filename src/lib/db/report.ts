// Отчёт владельцу после турнира: места и нокауты, касса, рейтинг периода до и после турнира.

import type { DatabaseSync } from "node:sqlite";
import { KIND_LABEL, type TournamentKind } from "../rating/points";
import { buildStandings } from "../rating/standings";
import { ratingShift, type TournamentReport } from "../report";
import { getTournamentDetails } from "./history";
import { KINDS, listPeriods, PERIOD_LABEL, scoredResults } from "./periods";

const ORDER = { month: 0, season: 1, year: 2 } as const;

export function tournamentReport(db: DatabaseSync, tournamentId: number): TournamentReport | null {
  const d = getTournamentDetails(db, tournamentId);
  if (!d) return null;
  if (d.status !== "finished") throw new Error("Отчёт — после завершения турнира");

  const byPlayers = d.results.length > 0;
  const tournament: TournamentReport["tournament"] = {
    id: d.id,
    name: d.name.trim() || "Турнир",
    kindLabel: d.kind !== "regular" ? KIND_LABEL[d.kind as TournamentKind] : null,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
    players: byPlayers ? d.results.length : d.counters.entries,
    entries: byPlayers ? d.results.reduce((s, r) => s + r.entries, 0) : d.counters.entries + d.counters.rebuys,
    reentries: byPlayers ? d.results.reduce((s, r) => s + Math.max(0, r.entries - 1), 0) : d.counters.rebuys,
    addons: byPlayers ? d.results.reduce((s, r) => s + r.addons, 0) : d.counters.addons,
    doubleAddons: byPlayers ? d.results.reduce((s, r) => s + r.doubleAddons, 0) : d.counters.doubleAddons,
  };

  const places = d.results.map((r) => ({ place: r.place, placeTo: r.placeTo, name: r.name, ko: r.ko }));

  const cash = d.cashReport
    ? {
        summary: d.cashReport.summary,
        debtors: d.cashReport.players.filter((p) => p.debt > 0).map((p) => ({ name: p.name, debt: p.debt })),
      }
    : null;

  // рейтинг: период, в который турнир пошёл (сначала месяц, потом сезон, год)
  const at = d.startedAt ?? d.createdAt;
  const period = listPeriods(db)
    .filter((p) => at >= p.startedAt && (p.closedAt == null || at < p.closedAt) && KINDS[p.kind].includes(d.kind))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])[0];
  let rating: TournamentReport["rating"] = null;
  if (period) {
    const results = scoredResults(db, period);
    if (results.some((r) => r.tournamentId === tournamentId)) {
      const before = buildStandings(results.filter((r) => r.tournamentId !== tournamentId));
      const after = buildStandings(results);
      rating = {
        periodName: period.name,
        periodLabel: PERIOD_LABEL[period.kind],
        ...ratingShift(before, after, d.results.map((r) => r.playerId)),
      };
    }
  }
  return { tournament, places, cash, expenses: d.expenses, rating };
}

// ---------- «Отчёт отправлен» (для напоминания админу) ----------

function sentIds(db: DatabaseSync): number[] {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'reports_sent'").get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as number[]) : [];
}

export const isReportSent = (db: DatabaseSync, tournamentId: number) => sentIds(db).includes(tournamentId);

/** Отметить, что отчёт скопирован (храним последние 500 турниров) */
export function markReportSent(db: DatabaseSync, tournamentId: number) {
  const ids = [...sentIds(db).filter((id) => id !== tournamentId), tournamentId].slice(-500);
  db.prepare(
    "INSERT INTO settings (key, value_json) VALUES ('reports_sent', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json",
  ).run(JSON.stringify(ids));
}
