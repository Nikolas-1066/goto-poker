// Таблица рейтинга и список финалистов — чистые функции (docs/RATING.md, раздел 3 и 7а).

export type ScoredResult = {
  playerId: number;
  name: string;
  tournamentId: number;
  /** Когда был турнир (для правила «выше тот, кто раньше набрал») */
  at: number;
  place: number;
  points: number;
  ko: number;
};

export type Standing = {
  rank: number;
  playerId: number;
  name: string;
  points: number;
  wins: number;
  bestPlace: number;
  ko: number;
  tournaments: number;
  /** Время последнего турнира, принёсшего очки */
  lastAt: number;
};

/**
 * Сложить очки по игрокам и расставить места. При равенстве очков выше тот, у кого:
 * 1) больше побед; 2) лучшее место в одном турнире; 3) больше нокаутов; 4) меньше турниров;
 * 5) раньше набрал эти очки (раньше последний турнир с очками — RATING.md 7а, п. 5).
 * Места не делятся.
 */
export function buildStandings(results: ScoredResult[]): Standing[] {
  const by = new Map<number, Omit<Standing, "rank">>();
  for (const r of results) {
    const s = by.get(r.playerId) ?? {
      playerId: r.playerId,
      name: r.name,
      points: 0,
      wins: 0,
      bestPlace: Number.POSITIVE_INFINITY,
      ko: 0,
      tournaments: 0,
      lastAt: 0,
    };
    s.points += r.points;
    s.wins += r.place === 1 ? 1 : 0;
    s.bestPlace = Math.min(s.bestPlace, r.place);
    s.ko += r.ko;
    s.tournaments += 1;
    s.lastAt = Math.max(s.lastAt, r.at);
    by.set(r.playerId, s);
  }
  return [...by.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        a.bestPlace - b.bestPlace ||
        b.ko - a.ko ||
        a.tournaments - b.tournaments ||
        a.lastAt - b.lastAt ||
        a.name.localeCompare(b.name, "ru") ||
        a.playerId - b.playerId,
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

export type FinalistChange = { id: number; playerId: number; action: "add" | "remove"; at: number; note: string };

export type Finalist = { playerId: number; rank: number | null; source: "rating" | "wildcard" };

/**
 * Финалисты: топ-N таблицы, отказавшиеся пропускаются (приглашается следующий по рейтингу),
 * wildcard добавляются сверх N. Последняя правка по игроку главнее (добавили, потом убрали — убран).
 */
export function computeFinalists(standings: Pick<Standing, "playerId" | "rank">[], n: number, changes: FinalistChange[]) {
  const last = new Map<number, "add" | "remove">();
  for (const c of [...changes].sort((a, b) => a.at - b.at || a.id - b.id)) last.set(c.playerId, c.action);
  const removed = new Set([...last].filter(([, a]) => a === "remove").map(([id]) => id));

  const finalists: Finalist[] = [];
  for (const s of standings) {
    if (finalists.length >= n) break;
    if (!removed.has(s.playerId)) finalists.push({ playerId: s.playerId, rank: s.rank, source: "rating" });
  }
  const inList = new Set(finalists.map((f) => f.playerId));
  const rankOf = new Map(standings.map((s) => [s.playerId, s.rank]));
  for (const [playerId, action] of last) {
    if (action === "add" && !inList.has(playerId)) {
      finalists.push({ playerId, rank: rankOf.get(playerId) ?? null, source: "wildcard" });
      inList.add(playerId);
    }
  }
  return { finalists, declined: [...removed] };
}

/** Название месяца по дате: «Ноябрь» */
export function monthName(ts: number) {
  const s = new Date(ts).toLocaleString("ru-RU", { month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Сезон по дате: «Зима» (дек–фев), «Весна», «Лето», «Осень» */
export function seasonName(ts: number) {
  const m = new Date(ts).getMonth();
  return m === 11 || m <= 1 ? "Зима" : m <= 4 ? "Весна" : m <= 7 ? "Лето" : "Осень";
}
