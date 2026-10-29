import { describe, expect, it } from "vitest";
import { expectedScore, formatEloDelta, replayElo, tournamentElo, type EloParams } from "./elo";
import { DEFAULT_RULES } from "./points";

const P: EloParams = DEFAULT_RULES.elo; // старт 1000, K 32, новичкам K 48 первые 5 турниров
const veteran = (ids: number[]) => new Map(ids.map((id) => [id, 10])); // уже не новички
const round = (changes: { playerId: number; after: number }[]) =>
  Object.fromEntries(changes.map((c) => [c.playerId, Math.round(c.after * 100) / 100]));

describe("ожидание", () => {
  it("равные рейтинги — 0,5; на 400 сильнее — около 0,91", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 3);
    expect(expectedScore(1000, 1400)).toBeCloseTo(0.091, 3);
  });
});

describe("ELO за турнир", () => {
  it("двое с 1000: победитель +16, проигравший −16 (K = 32)", () => {
    const ch = tournamentElo([{ playerId: 1, place: 1 }, { playerId: 2, place: 2 }], new Map(), veteran([1, 2]), P);
    expect(round(ch)).toEqual({ 1: 1016, 2: 984 });
  });

  it("новички (первые 5 турниров) — K = 48", () => {
    const ch = tournamentElo([{ playerId: 1, place: 1 }, { playerId: 2, place: 2 }], new Map(), new Map(), P);
    expect(round(ch)).toEqual({ 1: 1024, 2: 976 });
    // на 6-м турнире — уже обычный K
    const ch6 = tournamentElo([{ playerId: 1, place: 1 }, { playerId: 2, place: 2 }], new Map(), new Map([[1, 5], [2, 5]]), P);
    expect(round(ch6)).toEqual({ 1: 1016, 2: 984 });
  });

  it("трое с 1000: K × Σ(результат − ожидание) / (N − 1)", () => {
    const ch = tournamentElo(
      [
        { playerId: 1, place: 1 },
        { playerId: 2, place: 2 },
        { playerId: 3, place: 3 },
      ],
      new Map(),
      veteran([1, 2, 3]),
      P,
    );
    // 1-й: (0,5 + 0,5) / 2 × 32 = +16; 2-й: (−0,5 + 0,5) / 2 = 0; 3-й: −16
    expect(round(ch)).toEqual({ 1: 1016, 2: 1000, 3: 984 });
  });

  it("одинаковое место (равные стеки) — ничья между ними", () => {
    const ch = tournamentElo(
      [
        { playerId: 1, place: 1 },
        { playerId: 2, place: 2 },
        { playerId: 3, place: 2 },
      ],
      new Map(),
      veteran([1, 2, 3]),
      P,
    );
    expect(round(ch)).toEqual({ 1: 1016, 2: 992, 3: 992 });
  });

  it("сильный, проиграв слабому, теряет больше, чем выигрывает при победе", () => {
    const ratings = new Map([
      [1, 1200],
      [2, 1000],
    ]);
    const win = tournamentElo([{ playerId: 1, place: 1 }, { playerId: 2, place: 2 }], ratings, veteran([1, 2]), P);
    const lose = tournamentElo([{ playerId: 1, place: 2 }, { playerId: 2, place: 1 }], ratings, veteran([1, 2]), P);
    const gain = win[0].after - 1200;
    const loss = 1200 - lose[0].after;
    expect(gain).toBeCloseTo(7.69, 2);
    expect(loss).toBeCloseTo(24.31, 2);
  });

  it("сумма изменений при одинаковом K — ноль", () => {
    const ch = tournamentElo(
      [5, 3, 1, 4, 2].map((place, i) => ({ playerId: i + 1, place })),
      new Map([[1, 1100], [2, 950], [3, 1010], [4, 990], [5, 1200]]),
      veteran([1, 2, 3, 4, 5]),
      P,
    );
    expect(ch.reduce((s, c) => s + (c.after - c.before), 0)).toBeCloseTo(0, 9);
  });

  it("один участник — без изменений", () => {
    expect(round(tournamentElo([{ playerId: 1, place: 1 }], new Map(), new Map(), P))).toEqual({ 1: 1000 });
  });
});

describe("пересчёт по всей истории", () => {
  const t = (id: number, order: number[]) => ({ id, results: order.map((playerId, i) => ({ playerId, place: i + 1 })), params: P });

  it("рейтинг переходит из турнира в турнир, считается число турниров", () => {
    const { ratings, games, byTournament } = replayElo([t(1, [1, 2]), t(2, [2, 1, 3])]);
    // 1-й турнир: +24 (новичок, K 48). 2-й: 2 место из 3 — проиграл 976-му, обыграл 1000-го → −2,5
    expect(Math.round(ratings.get(1)!)).toBe(1022);
    expect(games.get(1)).toBe(2);
    expect(games.get(3)).toBe(1);
    expect(byTournament.get(2)!.find((c) => c.playerId === 1)!.before).toBe(1024);
  });

  it("исправили старый турнир — меняется всё, что после него", () => {
    const a = replayElo([t(1, [1, 2]), t(2, [1, 2])]);
    const b = replayElo([t(1, [2, 1]), t(2, [1, 2])]);
    expect(a.byTournament.get(2)![0].before).not.toBe(b.byTournament.get(2)![0].before);
  });
});

describe("подпись изменения", () => {
  it("+16 / −8 / ±0", () => {
    expect(formatEloDelta(1000, 1016.4)).toBe("+16");
    expect(formatEloDelta(1000, 992)).toBe("−8");
    expect(formatEloDelta(1000, 1000.2)).toBe("±0");
    expect(formatEloDelta(null, 1000)).toBe("");
  });
});
