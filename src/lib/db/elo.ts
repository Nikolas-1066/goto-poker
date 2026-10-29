// ELO в базе: каждый раз пересчитывается по всей истории завершённых турниров, по порядку.
// Так исправление старого турнира автоматически меняет ELO во всех турнирах после него.

import type { DatabaseSync } from "node:sqlite";
import { replayElo, type EloTournament } from "../rating/elo";
import { currentRules, rulesById } from "./rules";

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Пересчитать ELO всех игроков; возвращает, сколько турниров учтено */
export function recomputeElo(db: DatabaseSync, now = Date.now()) {
  const cur = currentRules(db, now);
  const list = db
    .prepare(
      `SELECT t.id, t.rules_id FROM tournaments t
       WHERE t.status = 'finished' AND EXISTS (SELECT 1 FROM participants p WHERE p.tournament_id = t.id AND p.place IS NOT NULL)
       ORDER BY COALESCE(t.finished_at, t.updated_at), t.id`,
    )
    .all() as { id: number; rules_id: number | null }[];
  const rowsOf = db.prepare("SELECT player_id, place FROM participants WHERE tournament_id = ? AND place IS NOT NULL");
  const tournaments: EloTournament[] = list.map((t) => ({
    id: t.id,
    results: (rowsOf.all(t.id) as { player_id: number; place: number }[]).map((r) => ({ playerId: r.player_id, place: r.place })),
    // параметры ELO — из той версии правил, по которой посчитан турнир
    params: ((t.rules_id != null && rulesById(db, t.rules_id)) || cur).rules.elo,
  }));
  const { ratings, games, byTournament } = replayElo(tournaments);

  db.prepare("UPDATE participants SET elo_before = NULL, elo_after = NULL").run();
  const setP = db.prepare("UPDATE participants SET elo_before = ?, elo_after = ? WHERE tournament_id = ? AND player_id = ?");
  for (const [tid, changes] of byTournament) for (const c of changes) setP.run(r2(c.before), r2(c.after), tid, c.playerId);

  const setPlayer = db.prepare("UPDATE players SET elo = ?, elo_games = ? WHERE id = ?");
  for (const { id } of db.prepare("SELECT id FROM players").all() as { id: number }[]) {
    setPlayer.run(r2(ratings.get(id) ?? cur.rules.elo.start), games.get(id) ?? 0, id);
  }
  return list.length;
}
