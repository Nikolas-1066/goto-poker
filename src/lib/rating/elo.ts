// ELO — рейтинг силы игрока (docs/RATING.md, раздел 4). На призы и отбор не влияет.
// Каждый турнир — набор «матчей» между всеми парами игроков: кто выше по месту, тот выиграл,
// одинаковое место (делёж при равных стеках) — ничья. Re-entry значения не имеют.
//   изменение = K × Σ(результат − ожидание) / (N − 1),  ожидание = 1 / (1 + 10^((R_соп − R_игрока) / 400))
// Новичкам первые несколько турниров — повышенный K.

export type EloParams = { start: number; k: number; newbieK: number; newbieGames: number };

export type EloTournament = {
  id: number;
  /** Участники с итоговым местом; одинаковое место — ничья между ними */
  results: { playerId: number; place: number }[];
  params: EloParams;
};

export type EloChange = { playerId: number; before: number; after: number };

export const expectedScore = (rating: number, opponent: number) => 1 / (1 + 10 ** ((opponent - rating) / 400));

/** Изменения ELO за один турнир при рейтингах до него (`ratings`) и числе сыгранных турниров (`games`) */
export function tournamentElo(
  results: { playerId: number; place: number }[],
  ratings: Map<number, number>,
  games: Map<number, number>,
  params: EloParams,
): EloChange[] {
  const n = results.length;
  const before = (id: number) => ratings.get(id) ?? params.start;
  if (n < 2) return results.map((r) => ({ playerId: r.playerId, before: before(r.playerId), after: before(r.playerId) }));
  return results.map((me) => {
    const r = before(me.playerId);
    let sum = 0;
    for (const op of results) {
      if (op.playerId === me.playerId) continue;
      const score = me.place < op.place ? 1 : me.place > op.place ? 0 : 0.5;
      sum += score - expectedScore(r, before(op.playerId));
    }
    const k = (games.get(me.playerId) ?? 0) < params.newbieGames ? params.newbieK : params.k;
    return { playerId: me.playerId, before: r, after: r + (k * sum) / (n - 1) };
  });
}

/**
 * Пройти все турниры по порядку и посчитать ELO заново. Используется после любого
 * изменения истории (новый турнир, исправление итогов) — «всё, что после, пересчитывается».
 */
export function replayElo(tournaments: EloTournament[]) {
  const ratings = new Map<number, number>();
  const games = new Map<number, number>();
  const byTournament = new Map<number, EloChange[]>();
  for (const t of tournaments) {
    const changes = tournamentElo(t.results, ratings, games, t.params);
    for (const c of changes) {
      ratings.set(c.playerId, c.after);
      games.set(c.playerId, (games.get(c.playerId) ?? 0) + 1);
    }
    byTournament.set(t.id, changes);
  }
  return { ratings, games, byTournament };
}

/** «+16», «−8», «±0» — для таблиц */
export function formatEloDelta(before: number | null, after: number | null) {
  if (before == null || after == null) return "";
  const d = Math.round(after) - Math.round(before);
  return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "±0";
}
