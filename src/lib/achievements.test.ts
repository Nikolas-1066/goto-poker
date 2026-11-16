import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, achievementsLine, achievementViews, computeAchievements, type HistoryTournament } from "./achievements";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 2, 16, 0); // понедельник 2 ноября, 19:00 в клубе

let id = 0;
const t = (at: number, place: number, extra: Partial<HistoryTournament> = {}): HistoryTournament => ({
  tournamentId: ++id,
  at,
  place,
  ko: 0,
  entries: 1,
  kind: "regular",
  eloAfter: null,
  brought: 0,
  ...extra,
});
const ids = (h: Parameters<typeof computeAchievements>[0]) => computeAchievements(h).earned.map((e) => e.id);

describe("достижения", () => {
  it("25 штук, без повторов", () => {
    expect(ACHIEVEMENTS).toHaveLength(25);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(25);
  });

  it("первый турнир, первая победа, хет-трик — за какой турнир получены", () => {
    const a = t(T0, 4, { ko: 1 });
    const b = t(T0 + DAY, 1, { ko: 3 });
    const { earned } = computeAchievements({ tournaments: [b, a], periods: [] }); // порядок — по времени
    expect(earned).toEqual([
      { id: "games_1", at: a.at, tournamentId: a.tournamentId, periodId: null },
      { id: "wins_1", at: b.at, tournamentId: b.tournamentId, periodId: null },
      { id: "ko_one_3", at: b.at, tournamentId: b.tournamentId, periodId: null },
    ]);
  });

  it("лестницы: 10 турниров, 10 нокаутов всего; серия топ-3 — именно подряд", () => {
    const list = Array.from({ length: 10 }, (_, i) => t(T0 + i * 10 * DAY, [2, 3, 5, 1, 2, 3, 6, 6, 6, 6][i], { ko: 1 }));
    const got = ids({ tournaments: list, periods: [] });
    expect(got).toEqual(expect.arrayContaining(["games_10", "ko_10", "wins_1", "top3_streak", "top3_5"])); // топ-3: 2,3,1,2,3 — пять раз
    expect(got).not.toContain("wins_5");
    // топ-3 трижды, но не подряд — серии нет
    expect(ids({ tournaments: [t(T0, 1), t(T0 + DAY, 5), t(T0 + 2 * DAY, 2), t(T0 + 3 * DAY, 6), t(T0 + 4 * DAY, 3)], periods: [] })).not.toContain("top3_streak");
  });

  it("камбэк — победа с re-entry; привёл друга; ELO 1200 — лучший за всё время", () => {
    const got = ids({ tournaments: [t(T0, 1, { entries: 2, brought: 1, eloAfter: 1203.4 }), t(T0 + DAY, 5, { eloAfter: 1150 })], periods: [] });
    expect(got).toEqual(expect.arrayContaining(["comeback", "friend", "elo_1200"]));
    expect(got).not.toContain("elo_1400");
  });

  it("финалы и рейтинг: финалист, 3 финала, чемпион месяца, лидер месяца", () => {
    const periods = [1, 2, 3].map((n) => ({ periodId: n, at: T0 + n * 30 * DAY, finalist: true, leader: n === 2 }));
    const final = t(T0 + 35 * DAY, 1, { kind: "month_final" });
    const { earned } = computeAchievements({ tournaments: [final], periods });
    const by = Object.fromEntries(earned.map((e) => [e.id, e]));
    expect(by.finalist).toMatchObject({ periodId: 1, tournamentId: null });
    expect(by.final_win).toMatchObject({ tournamentId: final.tournamentId });
    expect(by.month_leader).toMatchObject({ periodId: 2 });
    expect(by.finalist_3).toMatchObject({ periodId: 3 });
  });

  it("без пропусков: 4 недели подряд; пропустил неделю — счёт заново", () => {
    const weekly = (weeks: number[]) => weeks.map((w) => t(T0 + w * 7 * DAY + 2 * DAY, 9));
    expect(ids({ tournaments: weekly([0, 1, 2, 3]), periods: [] })).toContain("weeks_4");
    expect(ids({ tournaments: weekly([0, 1, 3, 4, 5]), periods: [] })).not.toContain("weeks_4");
    // два турнира в одну неделю — всё равно одна неделя
    expect(ids({ tournaments: [...weekly([0, 1, 2]), t(T0 + 2 * 7 * DAY + 3 * DAY, 9)], periods: [] })).not.toContain("weeks_4");
  });

  it("для показа: прогресс и доля игроков", () => {
    const views = achievementViews({ tournaments: [t(T0, 2), t(T0 + DAY, 7)], periods: [] }, { games_1: 8, games_10: 1 }, 10);
    expect(views.find((v) => v.id === "games_1")).toMatchObject({ earned: { at: T0 }, have: 1, need: 1, percent: 80 });
    expect(views.find((v) => v.id === "games_10")).toMatchObject({ earned: null, have: 2, need: 10, percent: 10 });
    expect(achievementsLine(["ko_one_3", "wins_1", "нет-такого"])).toBe("🎩 Хет-трик, 🥇 Первая победа");
  });
});
