import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  fieldCoef,
  placeBasePoints,
  placesPreview,
  pointsBreakdown,
  roundHalfUp,
  sanitizeRules,
  sharedPlacePoints,
  tournamentPoints,
} from "./points";

describe("коэффициент поля (RATING.md, раздел 1)", () => {
  it("примеры из правил: 8 — 0,63; 12 — 0,77; 20 — 1,00; 24 — 1,10; 27 — 1,16", () => {
    expect([8, 12, 20, 24, 27].map((n) => fieldCoef(n))).toEqual([0.63, 0.77, 1, 1.1, 1.16]);
  });
});

describe("баллы за место", () => {
  it("таблица 1–9: 100, 75, 60, 50, 40, 32, 25, 20, 15", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => placeBasePoints(p, 30))).toEqual([100, 75, 60, 50, 40, 32, 25, 20, 15]);
  });

  it("верхняя половина: с 10-го по ⌈N/2⌉ — 5, дальше — 2", () => {
    // N = 24 → ⌈24/2⌉ = 12
    expect([10, 11, 12, 13, 24].map((p) => placeBasePoints(p, 24))).toEqual([5, 5, 5, 2, 2]);
    // N = 25 → ⌈25/2⌉ = 13
    expect([13, 14].map((p) => placeBasePoints(p, 25))).toEqual([5, 2]);
    // маленькое поле: места до 9 — по таблице, даже если это нижняя половина
    expect(placeBasePoints(8, 8)).toBe(20);
  });

  it("делёж мест при равных стеках — среднее баллов за эти места", () => {
    expect(sharedPlacePoints(7, 8, 20)).toBe(22.5); // (25 + 20) / 2
    expect(sharedPlacePoints(9, 10, 24)).toBe(10); // (15 + 5) / 2
    expect(sharedPlacePoints(3, null, 20)).toBe(60);
  });
});

describe("очки за турнир — все примеры из RATING.md, раздел 2", () => {
  const n24 = { fieldSize: 24 };
  it.each([
    ["1 место, 3 KO", { place: 1, ko: 3, entries: 1 }, 125],
    ["2 место, 1 KO, 1 re-entry (82,5 → 83)", { place: 2, ko: 1, entries: 2 }, 83],
    ["5 место, 4 KO", { place: 5, ko: 4, entries: 1 }, 64],
    ["12 место (верхняя половина), 5,5 → 6", { place: 12, ko: 0, entries: 1 }, 6],
    ["15 место, 1 KO, 2 re-entry → минимум 1", { place: 15, ko: 1, entries: 3 }, 1],
    ["20 место", { place: 20, ko: 0, entries: 1 }, 2],
  ])("поле 24: %s", (_, x, expected) => {
    expect(tournamentPoints({ ...n24, ...x })).toBe(expected);
  });

  it("победитель турнира на 12 игроков, 3 KO — 92", () => {
    expect(tournamentPoints({ place: 1, ko: 3, entries: 1, fieldSize: 12 })).toBe(92);
  });

  it("победитель турнира на 8 игроков, 1 KO — 68", () => {
    expect(tournamentPoints({ place: 1, ko: 1, entries: 1, fieldSize: 8 })).toBe(68);
  });

  it("победитель финала (×1,5) на 24 игрока, 3 KO — 180", () => {
    expect(tournamentPoints({ place: 1, ko: 3, entries: 1, fieldSize: 24, kind: "month_final" })).toBe(180);
  });

  it("финал года — ×2", () => {
    expect(tournamentPoints({ place: 1, ko: 0, entries: 1, fieldSize: 20, kind: "year_final" })).toBe(200);
  });
});

describe("подробности расчёта", () => {
  it("нокаут пополам — +2,5, округление в конце", () => {
    // 7 место из 20: 25 × 1,00 + 2,5 = 27,5 → 28
    const b = pointsBreakdown({ place: 7, ko: 0.5, entries: 1, fieldSize: 20 });
    expect(b).toMatchObject({ base: 25, coef: 1, status: 1, reentries: 0, raw: 27.5, total: 28 });
  });

  it("равные стеки 7–8 из 20 — 22,5 баллов", () => {
    expect(tournamentPoints({ place: 7, placeTo: 8, ko: 0, entries: 1, fieldSize: 20 })).toBe(23);
  });

  it("аддоны на очки не влияют — их и нет во входных данных", () => {
    expect(pointsBreakdown({ place: 3, ko: 0, entries: 1, fieldSize: 20 }).total).toBe(60);
  });

  it("округление: 0,5 и больше — вверх, без ошибок дробей", () => {
    expect([82.5, 82.49, 5.5, 5 * 1.1, 0.5, 2.4999999999].map(roundHalfUp)).toEqual([83, 82, 6, 6, 1, 3]);
  });
});

describe("«сколько очков даст место сейчас»", () => {
  it("поле 24: места 1–9 по одному, затем 10–12 и 13–24 одной строкой", () => {
    const rows = placesPreview(24);
    expect(rows.slice(0, 3)).toEqual([
      { from: 1, to: 1, points: 110 },
      { from: 2, to: 2, points: 83 },
      { from: 3, to: 3, points: 66 },
    ]);
    expect(rows.slice(-2)).toEqual([
      { from: 10, to: 12, points: 6 },
      { from: 13, to: 24, points: 2 },
    ]);
  });

  it("маленькое поле — только сыгранные места", () => {
    expect(placesPreview(3).map((r) => [r.from, r.points])).toEqual([
      [1, 39],
      [2, 29],
      [3, 23],
    ]);
  });
});

describe("правила из админки", () => {
  it("правила по умолчанию проходят проверку как есть", () => {
    expect(sanitizeRules(structuredClone(DEFAULT_RULES))).toEqual(DEFAULT_RULES);
  });

  it("числа строкой и с запятой понимаются", () => {
    const r = sanitizeRules({ ...DEFAULT_RULES, koPoints: "2,5", statusCoef: { ...DEFAULT_RULES.statusCoef, month_final: "1,75" } });
    expect(r.koPoints).toBe(2.5);
    expect(r.statusCoef.month_final).toBe(1.75);
  });

  it("ошибки понятны", () => {
    expect(() => sanitizeRules({ ...DEFAULT_RULES, placePoints: [100, 120] })).toThrow("Баллы за 2 место больше, чем за 1");
    expect(() => sanitizeRules({ ...DEFAULT_RULES, placePoints: [] })).toThrow("от 1 до 30 мест");
    expect(() => sanitizeRules({ ...DEFAULT_RULES, koPoints: -1 })).toThrow("Очки за нокаут");
    expect(() => sanitizeRules({ ...DEFAULT_RULES, fieldBase: 0 })).toThrow("База коэффициента поля");
    expect(() => sanitizeRules({ ...DEFAULT_RULES, elo: { ...DEFAULT_RULES.elo, newbieGames: 2.5 } })).toThrow("целое");
  });

  it("другие правила меняют расчёт", () => {
    const rules = { ...DEFAULT_RULES, koPoints: 10, reentryPenalty: 0 };
    expect(tournamentPoints({ place: 1, ko: 3, entries: 2, fieldSize: 20 }, rules)).toBe(130);
  });
});
