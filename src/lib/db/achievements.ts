// Достижения по базе (правила — src/lib/achievements.ts): история каждого игрока и доля игроков, у кого что есть.
// Ничего не хранится — всё считается из сыгранных турниров и закрытых месяцев, поэтому прошлое засчитано,
// а исправление итогов турнира сразу меняет и достижения.

import type { DatabaseSync } from "node:sqlite";
import { achievementViews, computeAchievements, type AchievementView, type PlayerHistory } from "../achievements";
import { finalistsOf, listPeriods, standingsOf } from "./periods";

/** История всех игроков: сыгранные турниры и закрытые месяцы */
export function loadHistories(db: DatabaseSync): Map<number, PlayerHistory> {
  const map = new Map<number, PlayerHistory>();
  const get = (id: number) => {
    let h = map.get(id);
    if (!h) map.set(id, (h = { tournaments: [], periods: [] }));
    return h;
  };
  const rows = db
    .prepare(
      `SELECT p.player_id, t.id AS tournament_id, COALESCE(t.started_at, t.created_at) AS at, p.place, p.ko, p.entries, t.kind, p.elo_after,
              (SELECT COUNT(*) FROM participants n WHERE n.tournament_id = t.id AND n.brought_by = p.id AND n.place IS NOT NULL) AS brought
       FROM participants p JOIN tournaments t ON t.id = p.tournament_id
       WHERE t.status = 'finished' AND p.place IS NOT NULL`,
    )
    .all() as { player_id: number; tournament_id: number; at: number; place: number; ko: number; entries: number; kind: string; elo_after: number | null; brought: number }[];
  for (const r of rows) {
    get(r.player_id).tournaments.push({
      tournamentId: r.tournament_id,
      at: r.at,
      place: r.place,
      ko: r.ko,
      entries: r.entries,
      kind: r.kind,
      eloAfter: r.elo_after,
      brought: r.brought,
    });
  }
  // закрытые месяцы: кто прошёл в финал и кто был первым в рейтинге
  for (const p of listPeriods(db).filter((x) => x.kind === "month" && x.closedAt != null)) {
    const finalists = new Set(finalistsOf(db, p).finalists.map((f) => f.playerId));
    const leaders = new Set(standingsOf(db, p).filter((s) => s.rank === 1).map((s) => s.playerId));
    for (const id of new Set([...finalists, ...leaders])) {
      get(id).periods.push({ periodId: p.id, at: p.closedAt!, finalist: finalists.has(id), leader: leaders.has(id) });
    }
  }
  return map;
}

/** Сколько у кого есть: id достижения → число игроков, и сколько всего игроков играло */
function shares(histories: Map<number, PlayerHistory>) {
  const count: Record<string, number> = {};
  let players = 0;
  for (const h of histories.values()) {
    if (!h.tournaments.length) continue;
    players += 1;
    for (const e of computeAchievements(h).earned) count[e.id] = (count[e.id] ?? 0) + 1;
  }
  return { count, players };
}

/** Все достижения игрока: полученные и нет, с прогрессом и «есть у N% игроков» */
export function playerAchievements(db: DatabaseSync, playerId: number): AchievementView[] {
  const histories = loadHistories(db);
  const s = shares(histories);
  return achievementViews(histories.get(playerId) ?? { tournaments: [], periods: [] }, s.count, s.players);
}

/** Что игрок получил за этот турнир (для сообщения с итогами) */
export function earnedInTournament(histories: Map<number, PlayerHistory>, playerId: number, tournamentId: number): string[] {
  const h = histories.get(playerId);
  return h ? computeAchievements(h).earned.filter((e) => e.tournamentId === tournamentId).map((e) => e.id) : [];
}

/** Что игрок получил за закрытый месяц (для сообщения финалистам) */
export function earnedInPeriod(histories: Map<number, PlayerHistory>, playerId: number, periodId: number): string[] {
  const h = histories.get(playerId);
  return h ? computeAchievements(h).earned.filter((e) => e.periodId === periodId).map((e) => e.id) : [];
}
