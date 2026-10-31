import { describe, expect, it } from "vitest";
import { breakdown, computeStats, periodKey, periodLabel, periodRange, periodsOf, type StatsData } from "./stats";

const at = (y: number, m: number, d: number, h = 19) => new Date(y, m - 1, d, h).getTime();
const OCT = periodRange("2026-10")!;
const NOV = periodRange("2026-11")!;

// Пт 2 окт и Пт 9 окт — по игрокам, Сб 10 окт — вручную; 6 ноя (Пт) — по игрокам
function data(): StatsData {
  const players = { sasha: [1, "Саша"], ira: [2, "Ира"], oleg: [3, "Олег"] } as const;
  const part = (tournamentId: number, [playerId, name]: readonly [number, string], entries = 1, addons = 0, doubleAddons = 0) => ({
    tournamentId,
    playerId,
    name,
    entries,
    addons,
    doubleAddons,
  });
  const none = { entries: 0, rebuys: 0, addons: 0, doubleAddons: 0 };
  return {
    tournaments: [
      { id: 1, at: at(2026, 10, 2), mode: "players", counters: none },
      { id: 2, at: at(2026, 10, 9), mode: "players", counters: none },
      { id: 3, at: at(2026, 10, 10), mode: "manual", counters: { entries: 12, rebuys: 3, addons: 5, doubleAddons: 1 } },
      { id: 4, at: at(2026, 11, 6), mode: "players", counters: none },
    ],
    participations: [
      part(1, players.sasha, 2, 1),
      part(1, players.ira),
      part(1, players.oleg),
      part(2, players.sasha, 1, 0, 1),
      part(2, players.ira),
      part(4, players.sasha),
    ],
    payments: [
      { tournamentId: 1, playerId: 1, name: "Саша", amount: 3500, method: "cash", at: at(2026, 10, 2, 20) },
      { tournamentId: 1, playerId: 2, name: "Ира", amount: 1500, method: "card", at: at(2026, 10, 2, 20) },
      { tournamentId: 2, playerId: 1, name: "Саша", amount: 3500, method: "transfer", at: at(2026, 10, 9, 20) },
      // Олег отдал долг за 2 октября уже в ноябре — деньги ноября
      { tournamentId: 1, playerId: 3, name: "Олег", amount: 1000, method: "cash", at: at(2026, 11, 3, 12) },
      { tournamentId: 4, playerId: 1, name: "Саша", amount: 1500, method: "cash", at: at(2026, 11, 6, 20) },
    ],
    cash: [
      { tournamentId: 1, playerId: 1, charged: 3500, free: 0, paid: 3500 },
      { tournamentId: 1, playerId: 2, charged: 1500, free: 0, paid: 1500 },
      { tournamentId: 1, playerId: 3, charged: 1500, free: 0, paid: 1000 }, // ещё должен 500
      { tournamentId: 2, playerId: 1, charged: 3500, free: 0, paid: 3500 },
      { tournamentId: 2, playerId: 2, charged: 0, free: 1500, paid: 0 }, // бесплатный вход
      { tournamentId: 4, playerId: 1, charged: 1500, free: 0, paid: 1500 },
    ],
    firstVisits: [at(2026, 10, 2), at(2026, 10, 2), at(2026, 10, 2), at(2026, 11, 6)],
  };
}

describe("статистика за месяц (docs/STATS.md)", () => {
  const s = computeStats(data(), OCT);

  it("деньги: собрано по дню оплаты, долги и бесплатно — по турнирам месяца", () => {
    expect(s.paid).toBe(8500);
    expect(s.byMethod).toEqual({ cash: 3500, card: 1500, transfer: 3500 });
    expect(s.debt).toBe(500);
    expect(s.free).toBe(1500);
    // в ноябре — 1 000 от Олега за октябрь + 1 500 за ноябрьский турнир
    expect(computeStats(data(), NOV).paid).toBe(2500);
  });

  it("турниры и игроки; «вручную» — по счётчикам", () => {
    expect(s).toMatchObject({ tournaments: 3, players: 3, entries: 3 + 2 + 12, reentries: 1 + 3, addons: 1 + 5, doubleAddons: 1 + 1 });
    expect(s.avgPlayers).toBe(5.7); // (3 + 2 + 12) / 3
    expect(s.newPlayers).toBe(3);
  });

  it("топ по турнирам и по деньгам", () => {
    expect(s.topByTournaments.map((r) => [r.name, r.value])).toEqual([
      ["Ира", 2],
      ["Саша", 2],
      ["Олег", 1],
    ]);
    expect(s.topByMoney.map((r) => [r.name, r.value])).toEqual([
      ["Саша", 7000],
      ["Ира", 1500],
    ]);
  });

  it("дни недели: в пятницу 2 турнира, в среднем 2,5 игрока и 4 750 ₽ (с долгом, отданным позже)", () => {
    // за 2 октября: 3 500 + 1 500 + 1 000 (Олег, в ноябре) = 6 000; за 9 октября — 3 500
    expect(s.weekdays[4]).toEqual({ weekday: 4, tournaments: 2, avgPlayers: 2.5, avgPaid: 4750 });
    expect(s.weekdays[5]).toMatchObject({ tournaments: 1, avgPlayers: 12, avgPaid: 0 });
    expect(s.weekdays[0].tournaments).toBe(0);
  });

  it("пустой период — нули", () => {
    expect(computeStats(data(), periodRange("2025-01")!)).toMatchObject({ paid: 0, tournaments: 0, players: 0, avgPlayers: 0, debt: 0 });
  });
});

describe("периоды", () => {
  it("ключ, границы и название", () => {
    expect(periodKey(at(2026, 10, 31, 23), "month")).toBe("2026-10");
    expect(periodKey(at(2026, 1, 1, 0), "year")).toBe("2026");
    expect(periodRange("2026-12")).toEqual({ from: new Date(2026, 11, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
    expect(periodRange("2026-13")).toBeNull();
    expect(periodRange("abc")).toBeNull();
    expect([periodLabel("2026-10"), periodLabel("2026")]).toEqual(["Октябрь 2026", "2026 год"]);
  });

  it("список периодов — новые сначала; по месяцам года — по порядку", () => {
    expect(periodsOf(data(), "month")).toEqual(["2026-11", "2026-10"]);
    expect(periodsOf(data(), "year")).toEqual(["2026"]);
    expect(breakdown(data(), "month", periodRange("2026")!).map((r) => [r.label, r.paid, r.tournaments, r.players])).toEqual([
      ["Октябрь 2026", 8500, 3, 3],
      ["Ноябрь 2026", 2500, 1, 1],
    ]);
  });
});
