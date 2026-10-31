// Статистика клуба — чистые функции (docs/STATS.md). Данные готовит src/lib/db/stats.ts.
// Периоды — по местному времени: месяц «2026-10», год «2026».

import type { ByMethod, PayMethod } from "./cash";

export type StatsTournament = {
  id: number;
  /** Дата начала (или создания) */
  at: number;
  mode: "manual" | "players";
  /** Для «Вручную» — счётчики табло */
  counters: { entries: number; rebuys: number; addons: number; doubleAddons: number };
};

/** Участие игрока в завершённом турнире «по игрокам» */
export type StatsParticipation = {
  tournamentId: number;
  playerId: number;
  name: string;
  /** Входов всего (первый + re-entry) */
  entries: number;
  addons: number;
  doubleAddons: number;
};

export type StatsPayment = { tournamentId: number; playerId: number; name: string; amount: number; method: PayMethod; at: number };

/** Касса игрока в турнире: начислено, бесплатно, оплачено (все оплаты за этот турнир) */
export type StatsTournamentCash = { tournamentId: number; playerId: number; charged: number; free: number; paid: number };

export type StatsData = {
  tournaments: StatsTournament[];
  participations: StatsParticipation[];
  payments: StatsPayment[];
  cash: StatsTournamentCash[];
  /** Первый визит игроков */
  firstVisits: number[];
};

export type Range = { from: number; to: number };

export type TopRow = { playerId: number; name: string; value: number };

export type WeekdayRow = { weekday: number; tournaments: number; avgPlayers: number; avgPaid: number };

export type StatsSummary = {
  paid: number;
  byMethod: ByMethod;
  debt: number;
  free: number;
  tournaments: number;
  /** Разных игроков (только турниры «по игрокам») */
  players: number;
  entries: number;
  reentries: number;
  addons: number;
  doubleAddons: number;
  avgPlayers: number;
  newPlayers: number;
  topByTournaments: TopRow[];
  topByMoney: TopRow[];
  /** Пн … Вс */
  weekdays: WeekdayRow[];
};

export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const inRange = (at: number, r: Range) => at >= r.from && at < r.to;

/** Пн = 0 … Вс = 6 */
const weekdayOf = (at: number) => (new Date(at).getDay() + 6) % 7;

/** Сколько игроков было в турнире и сколько входов / re-entry / аддонов */
function tournamentFigures(t: StatsTournament, parts: StatsParticipation[]) {
  if (t.mode === "manual") {
    return {
      players: t.counters.entries,
      entries: t.counters.entries,
      reentries: t.counters.rebuys,
      addons: t.counters.addons,
      doubleAddons: t.counters.doubleAddons,
    };
  }
  return {
    players: parts.length,
    entries: parts.length,
    reentries: parts.reduce((s, p) => s + Math.max(0, p.entries - 1), 0),
    addons: parts.reduce((s, p) => s + p.addons, 0),
    doubleAddons: parts.reduce((s, p) => s + p.doubleAddons, 0),
  };
}

const top = (by: Map<number, TopRow>, n = 10) =>
  [...by.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ru")).slice(0, n);

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Статистика за период [from, to) */
export function computeStats(data: StatsData, range: Range): StatsSummary {
  const tournaments = data.tournaments.filter((t) => inRange(t.at, range));
  const ids = new Set(tournaments.map((t) => t.id));
  const partsOf = new Map<number, StatsParticipation[]>();
  for (const p of data.participations) {
    if (!ids.has(p.tournamentId)) continue;
    partsOf.set(p.tournamentId, [...(partsOf.get(p.tournamentId) ?? []), p]);
  }

  const s: StatsSummary = {
    paid: 0,
    byMethod: { cash: 0, card: 0, transfer: 0 },
    debt: 0,
    free: 0,
    tournaments: tournaments.length,
    players: 0,
    entries: 0,
    reentries: 0,
    addons: 0,
    doubleAddons: 0,
    avgPlayers: 0,
    newPlayers: data.firstVisits.filter((at) => inRange(at, range)).length,
    topByTournaments: [],
    topByMoney: [],
    weekdays: WEEKDAYS.map((_, weekday) => ({ weekday, tournaments: 0, avgPlayers: 0, avgPaid: 0 })),
  };

  // деньги — по дню оплаты
  const money = new Map<number, TopRow>();
  for (const p of data.payments) {
    if (!inRange(p.at, range)) continue;
    s.paid += p.amount;
    s.byMethod[p.method] += p.amount;
    const row = money.get(p.playerId) ?? { playerId: p.playerId, name: p.name, value: 0 };
    row.value += p.amount;
    money.set(p.playerId, row);
  }
  s.topByMoney = top(money);

  // долги и бесплатно — по турнирам периода
  const paidFor = new Map<number, number>(); // собрано за турнир (для дней недели)
  for (const c of data.cash) {
    paidFor.set(c.tournamentId, (paidFor.get(c.tournamentId) ?? 0) + c.paid);
    if (!ids.has(c.tournamentId)) continue;
    s.debt += Math.max(0, c.charged - c.paid);
    s.free += c.free;
  }

  // турниры, игроки, дни недели
  const players = new Set<number>();
  const visits = new Map<number, TopRow>();
  let field = 0;
  const wd = WEEKDAYS.map(() => ({ tournaments: 0, players: 0, paid: 0 }));
  for (const t of tournaments) {
    const parts = partsOf.get(t.id) ?? [];
    const f = tournamentFigures(t, parts);
    s.entries += f.entries;
    s.reentries += f.reentries;
    s.addons += f.addons;
    s.doubleAddons += f.doubleAddons;
    field += f.players;
    for (const p of parts) {
      players.add(p.playerId);
      const row = visits.get(p.playerId) ?? { playerId: p.playerId, name: p.name, value: 0 };
      row.value += 1;
      visits.set(p.playerId, row);
    }
    const d = wd[weekdayOf(t.at)];
    d.tournaments += 1;
    d.players += f.players;
    d.paid += paidFor.get(t.id) ?? 0;
  }
  s.players = players.size;
  s.avgPlayers = tournaments.length ? round1(field / tournaments.length) : 0;
  s.topByTournaments = top(visits);
  s.weekdays = wd.map((d, weekday) => ({
    weekday,
    tournaments: d.tournaments,
    avgPlayers: d.tournaments ? round1(d.players / d.tournaments) : 0,
    avgPaid: d.tournaments ? Math.round(d.paid / d.tournaments) : 0,
  }));
  return s;
}

// ---------- Периоды ----------

export type PeriodUnit = "month" | "year";

/** Ключ периода по дате: «2026-10» или «2026» */
export function periodKey(at: number, unit: PeriodUnit) {
  const d = new Date(at);
  return unit === "year" ? String(d.getFullYear()) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Границы периода по ключу; null — ключ непонятный */
export function periodRange(key: string): Range | null {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  if (m[2] == null) return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() };
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  return { from: new Date(y, mo, 1).getTime(), to: new Date(y, mo + 1, 1).getTime() };
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** «Октябрь 2026», «2026 год» */
export function periodLabel(key: string) {
  const [y, m] = key.split("-");
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : `${y} год`;
}

/** Все периоды, в которых что-то было (турниры, оплаты, новые игроки), новые сначала */
export function periodsOf(data: StatsData, unit: PeriodUnit) {
  const keys = new Set<string>();
  for (const t of data.tournaments) keys.add(periodKey(t.at, unit));
  for (const p of data.payments) keys.add(periodKey(p.at, unit));
  for (const at of data.firstVisits) keys.add(periodKey(at, unit));
  return [...keys].sort().reverse();
}

export type BreakdownRow = { key: string; label: string; paid: number; tournaments: number; players: number; newPlayers: number; entries: number };

/** По месяцам года (или по годам за всё время) — для таблицы со столбиками, по порядку */
export function breakdown(data: StatsData, unit: PeriodUnit, within?: Range): BreakdownRow[] {
  return periodsOf(data, unit)
    .reverse()
    .map((key) => ({ key, range: periodRange(key)! }))
    .filter(({ range }) => !within || (range.from >= within.from && range.to <= within.to))
    .map(({ key, range }) => {
      const s = computeStats(data, range);
      return { key, label: periodLabel(key), paid: s.paid, tournaments: s.tournaments, players: s.players, newPlayers: s.newPlayers, entries: s.entries };
    });
}
