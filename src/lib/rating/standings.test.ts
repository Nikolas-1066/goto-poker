import { describe, expect, it } from "vitest";
import { buildStandings, computeFinalists, monthName, seasonName, type ScoredResult } from "./standings";

let tid = 0;
const r = (playerId: number, place: number, points: number, at: number, ko = 0): ScoredResult => ({
  playerId,
  name: `Игрок ${playerId}`,
  tournamentId: ++tid,
  at,
  place,
  points,
  ko,
});

describe("таблица рейтинга", () => {
  it("складывает очки, победы, лучшее место, нокауты, турниры", () => {
    const s = buildStandings([r(1, 1, 100, 10, 2), r(1, 3, 60, 20, 1), r(2, 2, 75, 10)]);
    expect(s[0]).toMatchObject({ rank: 1, playerId: 1, points: 160, wins: 1, bestPlace: 1, ko: 3, tournaments: 2, lastAt: 20 });
    expect(s[1]).toMatchObject({ rank: 2, playerId: 2, points: 75, tournaments: 1 });
  });

  describe("при равенстве очков (RATING.md, раздел 3)", () => {
    it("1) больше побед", () => {
      const s = buildStandings([r(1, 2, 50, 1), r(1, 2, 50, 2), r(2, 1, 100, 1)]);
      expect(s.map((x) => x.playerId)).toEqual([2, 1]);
    });
    it("2) лучшее место в одном турнире", () => {
      const s = buildStandings([r(1, 3, 60, 1), r(2, 2, 30, 1), r(2, 9, 30, 2)]);
      expect(s.map((x) => x.playerId)).toEqual([2, 1]);
    });
    it("3) больше нокаутов", () => {
      const s = buildStandings([r(1, 2, 60, 1, 1), r(2, 2, 60, 1, 2.5)]);
      expect(s.map((x) => x.playerId)).toEqual([2, 1]);
    });
    it("4) меньше сыгранных турниров", () => {
      const s = buildStandings([r(1, 2, 30, 1), r(1, 2, 30, 2), r(2, 2, 60, 1)]);
      expect(s.map((x) => x.playerId)).toEqual([2, 1]);
    });
    it("5) раньше набрал эти очки (раньше последний турнир)", () => {
      const s = buildStandings([r(1, 2, 60, 50), r(2, 2, 60, 10)]);
      expect(s.map((x) => x.playerId)).toEqual([2, 1]);
      expect(s.map((x) => x.rank)).toEqual([1, 2]); // места не делятся
    });
  });
});

describe("финалисты", () => {
  const table = [1, 2, 3, 4, 5].map((playerId, i) => ({ playerId, rank: i + 1 }));
  const ch = (id: number, playerId: number, action: "add" | "remove", at = id) => ({ id, playerId, action, at, note: "" });

  it("топ-N по таблице", () => {
    expect(computeFinalists(table, 3, []).finalists.map((f) => f.playerId)).toEqual([1, 2, 3]);
  });

  it("N можно поменять в любой момент", () => {
    expect(computeFinalists(table, 2, []).finalists.map((f) => f.playerId)).toEqual([1, 2]);
    expect(computeFinalists(table, 9, []).finalists).toHaveLength(5); // больше, чем игроков — все
  });

  it("отказался — приглашается следующий по рейтингу", () => {
    const { finalists, declined } = computeFinalists(table, 3, [ch(1, 2, "remove")]);
    expect(finalists.map((f) => f.playerId)).toEqual([1, 3, 4]);
    expect(declined).toEqual([2]);
  });

  it("wildcard — сверх N, с пометкой", () => {
    const { finalists } = computeFinalists(table, 3, [ch(1, 5, "add"), ch(2, 9, "add")]);
    expect(finalists).toEqual([
      { playerId: 1, rank: 1, source: "rating" },
      { playerId: 2, rank: 2, source: "rating" },
      { playerId: 3, rank: 3, source: "rating" },
      { playerId: 5, rank: 5, source: "wildcard" },
      { playerId: 9, rank: null, source: "wildcard" }, // не играл в периоде
    ]);
  });

  it("wildcard тому, кто и так в топе, — без дубля", () => {
    expect(computeFinalists(table, 3, [ch(1, 2, "add")]).finalists.map((f) => f.playerId)).toEqual([1, 2, 3]);
  });

  it("последняя правка главнее: убрали, потом вернули", () => {
    const { finalists, declined } = computeFinalists(table, 3, [ch(1, 2, "remove", 10), ch(2, 2, "add", 20)]);
    expect(finalists.map((f) => f.playerId)).toEqual([1, 2, 3]);
    expect(declined).toEqual([]);
  });
});

describe("названия периодов", () => {
  it("месяц и сезон по дате", () => {
    expect(monthName(new Date(2026, 10, 1).getTime())).toBe("Ноябрь");
    expect([0, 3, 6, 9, 11].map((m) => seasonName(new Date(2026, m, 15).getTime()))).toEqual(["Зима", "Весна", "Лето", "Осень", "Зима"]);
  });
});
