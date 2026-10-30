// Карточка игрока: его турниры, места, очки, нокауты, ELO и место в рейтингах.

import type { DatabaseSync } from "node:sqlite";
import type { TournamentKind } from "../rating/points";
import { playerDebts } from "./cash";
import { getPlayer } from "./players";
import { finalistsOf, listPeriods, openPeriod, PERIOD_LABEL, standingsOf } from "./periods";
import { getSettings, type PeriodKind } from "./settings";

export type CardTournament = {
  tournamentId: number;
  name: string;
  kind: TournamentKind;
  at: number;
  status: string;
  /** Поле N — сколько игроков входило */
  field: number;
  place: number | null;
  placeTo: number | null;
  entries: number;
  ko: number;
  points: number | null;
  eloBefore: number | null;
  eloAfter: number | null;
};

export type CardRating = { label: string; rank: number | null; of: number; points: number };

export function playerCard(db: DatabaseSync, playerId: number) {
  const player = getPlayer(db, playerId);
  if (!player) return null;
  const games = (db.prepare("SELECT elo_games FROM players WHERE id = ?").get(playerId) as { elo_games: number }).elo_games;

  const tournaments = (
    db
      .prepare(
        `SELECT t.id, t.name, t.kind, t.status, COALESCE(t.started_at, t.created_at) AS at,
                p.place, p.place_to, p.entries, p.ko, p.points, p.elo_before, p.elo_after,
                (SELECT COUNT(*) FROM participants x WHERE x.tournament_id = t.id AND x.status NOT IN ('registered', 'no_show')) AS field
         FROM participants p JOIN tournaments t ON t.id = p.tournament_id
         WHERE p.player_id = ? AND p.status NOT IN ('registered', 'no_show')
         ORDER BY at DESC, t.id DESC`,
      )
      .all(playerId) as {
      id: number;
      name: string;
      kind: TournamentKind;
      status: string;
      at: number;
      place: number | null;
      place_to: number | null;
      entries: number;
      ko: number;
      points: number | null;
      elo_before: number | null;
      elo_after: number | null;
      field: number;
    }[]
  ).map(
    (r): CardTournament => ({
      tournamentId: r.id,
      name: r.name,
      kind: r.kind,
      at: r.at,
      status: r.status,
      field: r.field,
      // у незавершённого турнира места ещё нет
      place: r.status === "finished" ? r.place : null,
      placeTo: r.status === "finished" ? r.place_to : null,
      entries: r.entries,
      ko: r.ko,
      points: r.status === "finished" ? r.points : null,
      eloBefore: r.elo_before,
      eloAfter: r.elo_after,
    }),
  );

  const finished = tournaments.filter((t) => t.place != null);
  const stats = {
    tournaments: finished.length,
    wins: finished.filter((t) => t.place === 1).length,
    top3: finished.filter((t) => t.place! <= 3).length,
    bestPlace: finished.length ? Math.min(...finished.map((t) => t.place!)) : null,
    ko: finished.reduce((s, t) => s + t.ko, 0),
    reentries: finished.reduce((s, t) => s + Math.max(0, t.entries - 1), 0),
    points: finished.reduce((s, t) => s + (t.points ?? 0), 0),
  };

  // место в рейтингах: идущие периоды и «за всё время»
  const settings = getSettings(db);
  const kinds: PeriodKind[] = ["month", ...(settings.seasonEnabled ? ["season" as const] : []), ...(settings.yearEnabled ? ["year" as const] : [])];
  const ratings: CardRating[] = [];
  for (const k of kinds) {
    const p = openPeriod(db, k);
    if (!p) continue;
    const table = standingsOf(db, p);
    const me = table.find((s) => s.playerId === playerId);
    ratings.push({ label: `${PERIOD_LABEL[k]} · ${p.name}`, rank: me?.rank ?? null, of: table.length, points: me?.points ?? 0 });
  }
  const all = standingsOf(db, "all");
  const meAll = all.find((s) => s.playerId === playerId);
  ratings.push({ label: "За всё время", rank: meAll?.rank ?? null, of: all.length, points: meAll?.points ?? 0 });

  // в каких финалах был (по закрытым периодам)
  const finals = listPeriods(db)
    .filter((p) => p.closedAt != null && finalistsOf(db, p).finalists.some((f) => f.playerId === playerId))
    .map((p) => `${PERIOD_LABEL[p.kind]} · ${p.name}`);

  // ELO по турнирам — для графика (от старых к новым)
  const eloHistory = [...finished]
    .reverse()
    .filter((t) => t.eloAfter != null)
    .map((t) => ({ at: t.at, elo: Math.round(t.eloAfter!) }));

  return {
    player: { ...player, elo: Math.round(player.elo), eloGames: games },
    stats,
    ratings,
    finals,
    tournaments,
    eloHistory,
    debts: playerDebts(db, playerId),
  };
}
