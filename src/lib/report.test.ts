import { describe, expect, it } from "vitest";
import { buildStandings, type ScoredResult } from "./rating/standings";
import { formatShift, ratingShift, reportText, type TournamentReport } from "./report";

const r = (playerId: number, name: string, tournamentId: number, place: number, points: number): ScoredResult => ({
  playerId,
  name,
  tournamentId,
  at: tournamentId,
  place,
  points,
  ko: 0,
});

describe("сдвиг мест в рейтинге", () => {
  // до турнира: Саша 100, Ира 80, Олег 50; турнир 3: Олег +120, Женя (новый) +60, Саша +10
  const before = [r(1, "Саша", 1, 1, 100), r(2, "Ира", 1, 2, 80), r(3, "Олег", 2, 3, 50)];
  const now = [r(3, "Олег", 3, 1, 120), r(4, "Женя", 3, 2, 60), r(1, "Саша", 3, 3, 10)];
  const s = ratingShift(buildStandings(before), buildStandings([...before, ...now]), [3, 4, 1], 3);

  it("топ после турнира со сдвигом; новый в таблице — new", () => {
    expect(s.top).toEqual([
      { rank: 1, name: "Олег", points: 170, shift: 2 },
      { rank: 2, name: "Саша", points: 110, shift: -1 },
      { rank: 3, name: "Ира", points: 80, shift: -1 },
    ]);
  });

  it("участники турнира: место было → стало и сколько очков добавил", () => {
    expect(s.participants).toEqual([
      { name: "Олег", before: 3, after: 1, points: 170, gained: 120 },
      { name: "Саша", before: 1, after: 2, points: 110, gained: 10 },
      { name: "Женя", before: null, after: 4, points: 60, gained: 60 },
    ]);
  });

  it("стрелки", () => {
    expect([formatShift(2), formatShift(-1), formatShift(0), formatShift(null)]).toEqual(["↑2", "↓1", "=", "new"]);
  });
});

describe("текст отчёта", () => {
  const base: TournamentReport = {
    tournament: {
      id: 1,
      name: "Пятница",
      kindLabel: null,
      startedAt: new Date(2026, 9, 30, 19, 0).getTime(),
      finishedAt: new Date(2026, 9, 30, 23, 40).getTime(),
      players: 3,
      entries: 4,
      reentries: 1,
      addons: 2,
      doubleAddons: 1,
    },
    places: [
      { place: 1, placeTo: null, name: "Саша", ko: 1.5 },
      { place: 2, placeTo: 3, name: "Ира", ko: 0 },
      { place: 2, placeTo: 3, name: "Олег", ko: 0.5 },
    ],
    cash: {
      summary: { charged: 6000, free: 1500, paid: 4500, byMethod: { cash: 3000, card: 1500, transfer: 0 }, debt: 1500, debtors: 1, overpaid: 0 },
      debtors: [{ name: "Олег", debt: 1500 }],
    },
    rating: {
      periodName: "Октябрь",
      periodLabel: "Месяц",
      top: [{ rank: 1, name: "Саша", points: 200, shift: 1 }],
      participants: [{ name: "Саша", before: 2, after: 1, points: 200, gained: 92 }],
    },
  };

  it("места с нокаутами, касса, рейтинг", () => {
    const text = reportText(base);
    expect(text).toContain("🏆 Пятница · 30.10.2026, 19:00–23:40");
    expect(text).toContain("игроков 3 · входов 4 · re-entry 1 · аддонов 3 (двойных 1)");
    expect(text).toContain("1. Саша — KO 1,5\n2–3. Ира\n2–3. Олег — KO 0,5");
    expect(text).toContain("Собрано 4 500 ₽ из 6 000 ₽ (наличные 3 000 ₽ · карта 1 500 ₽)");
    expect(text).toContain("Долги 1 500 ₽: Олег 1 500 ₽");
    expect(text).toContain("Бесплатно 1 500 ₽");
    expect(text).toContain("РЕЙТИНГ · Октябрь (после турнира)\n1. Саша — 200 (↑1)");
    expect(text).toContain("Саша: 2 → 1 место · +92 очк.");
  });

  it("без кассы и без рейтинга — так и написано", () => {
    const text = reportText({ ...base, cash: null, rating: null });
    expect(text).toContain("Денег в турнире не было");
    expect(text).toContain("Турнир не попал в рейтинг");
  });
});
