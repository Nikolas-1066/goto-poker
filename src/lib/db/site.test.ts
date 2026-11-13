import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePeriod, openPeriod, startPeriod } from "./periods";
import { createPlayer } from "./players";
import { addItem, setCancelled } from "./schedule";
import { applyAction } from "../clock";
import { getAbout, saveAbout, siteArchive, siteFacts, siteLive, sitePlayer, siteRating, siteResultFull, siteResults, siteSchedule } from "./site";
import { loadState, openStore, transaction, writeState } from "./sqlite";
import { applyPlayerAction, currentTournament, listParticipants, type PlayerAction } from "./tournament";

const DAY = 86_400_000;
const NOV1 = Date.UTC(2026, 10, 1, 9, 0);
const NOW = Date.UTC(2026, 10, 13, 12, 0); // пятница 13 ноября, 15:00 в клубе

let dir: string;
let db: DatabaseSync;
const ids: Record<string, number> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-site-"));
  db = openStore(dir, NOV1 - 40 * DAY).db;
  for (const [i, name] of ["Саша", "Ира", "Олег", "Женя"].entries()) {
    ids[name] = createPlayer(db, { name, phone: `+7900000000${i}`, note: "секретная заметка" }).id;
  }
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Сыгранный турнир по игрокам: [кто, место, очки, KO] */
function finished(name: string, at: number, rows: [string, number, number, number][], kind = "regular") {
  const tid = Number(
    db
      .prepare("INSERT INTO tournaments (name, kind, mode, status, created_at, started_at, updated_at) VALUES (?, ?, 'players', 'finished', ?, ?, ?)")
      .run(name, kind, at, at, at).lastInsertRowid,
  );
  for (const [who, place, points, ko] of rows) {
    db.prepare(
      "INSERT INTO participants (tournament_id, player_id, status, registered_at, place, entries, points, ko) VALUES (?, ?, 'busted', ?, ?, 1, ?, ?)",
    ).run(tid, ids[who], at, place, points, ko);
  }
  return tid;
}

/** Телефоны, заметки и деньги на сайт не уходят */
const expectNoSecrets = (data: unknown) => {
  const json = JSON.stringify(data);
  expect(json).not.toContain("+7900");
  expect(json).not.toContain("секретная");
  expect(json).not.toMatch(/phone|note"|debt|paid/);
};

describe("рейтинг на сайте", () => {
  it("пустая база — пустые таблицы", () => {
    expect(siteRating(db)).toEqual({ open: [], all: [], elo: [], archive: [] });
  });

  it("месяц с зоной финала, за всё время, ELO и архив", () => {
    finished("Октябрьский", NOV1 - 5 * DAY, [["Женя", 1, 100, 2]]);
    startPeriod(db, "month", { startAt: NOV1 }, NOW);
    finished("Пятничный", NOV1 + DAY, [["Саша", 1, 60, 1.5], ["Ира", 2, 45, 0], ["Олег", 3, 36, 0]]);
    db.prepare("UPDATE players SET elo = 1030.4, elo_games = 1 WHERE id = ?").run(ids["Саша"]);
    db.prepare("UPDATE players SET elo = 990, elo_games = 1 WHERE id = ?").run(ids["Ира"]);

    const r = siteRating(db);
    expect(r.open).toHaveLength(1);
    expect(r.open[0]).toMatchObject({ label: "Месяц · Ноябрь", finalistsN: 9 });
    expect(r.open[0].rows).toEqual([
      { rank: 1, playerId: ids["Саша"], name: "Саша", points: 60, tournaments: 1, wins: 1, ko: 1.5 },
      { rank: 2, playerId: ids["Ира"], name: "Ира", points: 45, tournaments: 1, wins: 0, ko: 0 },
      { rank: 3, playerId: ids["Олег"], name: "Олег", points: 36, tournaments: 1, wins: 0, ko: 0 },
    ]);
    expect(r.all.map((x) => x.name)).toEqual(["Женя", "Саша", "Ира", "Олег"]);
    // ELO — только у кого есть сыгранные турниры
    expect(r.elo).toEqual([
      { rank: 1, playerId: ids["Саша"], name: "Саша", elo: 1030, games: 1 },
      { rank: 2, playerId: ids["Ира"], name: "Ира", elo: 990, games: 1 },
    ]);
    expect(r.archive).toEqual([]);
    expectNoSecrets(r);

    // закрыли месяц — он в архиве с финалистами
    const month = openPeriod(db, "month")!;
    closePeriod(db, month.id, {}, NOW);
    const after = siteRating(db);
    expect(after.archive).toEqual([{ id: month.id, label: "Месяц · Ноябрь" }]);
    const arch = siteArchive(db, month.id)!;
    expect(arch.rows.map((x) => [x.rank, x.name, x.points])).toEqual([[1, "Саша", 60], [2, "Ира", 45], [3, "Олег", 36]]);
    expect(arch.finalists.map((f) => [f.name, f.rank, f.wildcard])).toEqual([["Саша", 1, false], ["Ира", 2, false], ["Олег", 3, false]]);
    expectNoSecrets(arch);
    // идущий период в архиве не открывается
    expect(siteArchive(db, openPeriod(db, "month")!.id)).toBeNull();
    expect(siteArchive(db, 999)).toBeNull();
  });
});

describe("итоги турниров", () => {
  it("только топ-3 и сколько было игроков; свежие сверху; незавершённые не показываются", () => {
    finished("Первый", NOV1, [["Саша", 1, 60, 1], ["Ира", 2, 45, 0], ["Олег", 3, 36, 0], ["Женя", 4, 0, 0]]);
    finished("Финал", NOV1 + DAY, [["Ира", 1, 90, 2], ["Саша", 2, 60, 0]], "month_final");
    db.prepare("INSERT INTO tournaments (name, mode, status, created_at, updated_at) VALUES ('Идёт', 'players', 'running', ?, ?)").run(NOW, NOW);
    expect(siteFacts(db)).toEqual({ players: 4, tournaments: 2, finalistsN: null });
    const res = siteResults(db);
    expect(res.map((t) => [t.name, t.kindLabel, t.players, t.top.length])).toEqual([
      ["Финал", "Финал месяца", 2, 2],
      ["Первый", "", 4, 3],
    ]);
    expect(res[1].top).toEqual([
      { playerId: ids["Саша"], name: "Саша", place: "1", points: 60, ko: 1 },
      { playerId: ids["Ира"], name: "Ира", place: "2", points: 45, ko: 0 },
      { playerId: ids["Олег"], name: "Олег", place: "3", points: 36, ko: 0 },
    ]);
    expectNoSecrets(res);
  });
});

describe("все места турнира", () => {
  it("по нажатию — вся таблица; незавершённого и чужого турнира нет", () => {
    const tid = finished("Первый", NOV1, [["Саша", 1, 60, 1], ["Ира", 2, 45, 0], ["Олег", 3, 36, 0], ["Женя", 4, 0, 0]]);
    const full = siteResultFull(db, tid)!;
    expect(full).toMatchObject({ id: tid, name: "Первый", players: 4 });
    expect(full.rows.map((r) => [r.place, r.name, r.points])).toEqual([["1", "Саша", 60], ["2", "Ира", 45], ["3", "Олег", 36], ["4", "Женя", 0]]);
    expectNoSecrets(full);
    expect(siteResultFull(db, currentTournament(db).id)).toBeNull();
    expect(siteResultFull(db, 999)).toBeNull();
  });
});

describe("турнир идёт сейчас", () => {
  const T0 = NOW;
  const edit = (fn: (state: ReturnType<typeof loadState>) => void, hook?: (state: ReturnType<typeof loadState>) => void) => {
    const before = loadState(db);
    const next = structuredClone(before);
    fn(next);
    transaction(db, () => {
      hook?.(next);
      writeState(db, before, next);
    });
  };
  const act = (action: PlayerAction, now = T0) => edit(() => {}, (next) => void applyPlayerAction(db, next, action, now));
  const pid = (name: string) => listParticipants(db, currentTournament(db).id).find((p) => p.name === name)!.id;

  it("пока не начали или турнир «Вручную» — ничего; идёт — уровень, блайнды, игроки, нокауты, фишки, вылетевшие", () => {
    edit((d) => {
      d.tournament = { ...applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[0].id }, T0, (id) => d.presets.find((p) => p.id === id)), mode: "players" };
    });
    act({ type: "setSeating", autoSeat: false });
    for (const name of ["Саша", "Ира", "Олег"]) act({ type: "enter", playerId: ids[name] });
    act({ type: "register", playerId: ids["Женя"] }); // записан, но не пришёл — на сайте не виден
    expect(siteLive(db, T0)).toBeNull();

    edit((d) => {
      d.tournament = applyAction(d.tournament, { type: "start" }, T0, () => undefined);
    });
    act({ type: "bust", busted: [{ participantId: pid("Олег"), handOrder: 1 }], knockers: [pid("Ира")] }, T0 + 1000);
    act({ type: "setStack", participantId: pid("Ира"), stack: 41_000 }, T0 + 2000);

    const live = siteLive(db, T0 + 3000)!;
    const first = loadState(db).tournament.structure!.steps.find((s) => s.kind === "level")!;
    expect(live).toMatchObject({ paused: false, onBreak: false, level: 1, playing: 2, total: 3, kindLabel: "" });
    expect(live.blinds).toEqual({ sb: first.sb, bb: first.bb, ante: first.ante });
    expect(live.players).toEqual([
      { playerId: ids["Ира"], name: "Ира", ko: 1 },
      { playerId: ids["Саша"], name: "Саша", ko: 0 },
    ]);
    expect(live.out).toEqual([{ playerId: ids["Олег"], name: "Олег", place: "3", ko: 0 }]);
    expect(live.chipLeaders).toEqual([{ playerId: ids["Ира"], name: "Ира", stack: 41_000 }]);
    expect(live.avgStack).toBeGreaterThan(0);
    expectNoSecrets(live);

    edit((d) => {
      d.tournament.mode = "manual";
    });
    expect(siteLive(db, T0 + 3000)).toBeNull();
  });
});

describe("страница игрока", () => {
  it("турниры, места, очки, нокауты, место в рейтинге — и ничего личного", () => {
    startPeriod(db, "month", { startAt: NOV1 }, NOW);
    finished("Первый", NOV1 + DAY, [["Саша", 1, 60, 1], ["Ира", 2, 45, 0]]);
    finished("Второй", NOV1 + 2 * DAY, [["Ира", 1, 60, 1], ["Саша", 2, 45, 0]]);
    const p = sitePlayer(db, ids["Саша"])!;
    expect(p).toMatchObject({ id: ids["Саша"], name: "Саша", stats: { tournaments: 2, wins: 1, top3: 2, bestPlace: 1, ko: 1, points: 105 } });
    expect(p.tournaments.map((t) => [t.name, t.place, t.points, t.field])).toEqual([["Второй", "2", 45, 2], ["Первый", "1", 60, 2]]);
    expect(p.ratings.map((r) => r.label)).toEqual(["Месяц · Ноябрь", "За всё время"]);
    expect(Object.keys(p).sort()).toEqual(["elo", "eloGames", "finals", "id", "name", "ratings", "stats", "tournaments"]);
    expectNoSecrets(p);
    expect(sitePlayer(db, 999)).toBeNull();
  });
});

describe("расписание на сайте", () => {
  it("без отменённых; структура — название, стек и цена входа", () => {
    const preset = (db.prepare("SELECT id, name, starting_stack FROM presets LIMIT 1").get() as { id: string; name: string; starting_stack: number });
    db.prepare("UPDATE presets SET prices_json = ? WHERE id = ?").run(JSON.stringify({ entry: 800, reentry: 800, addon: 800, doubleAddon: 1200 }), preset.id);
    const today = "2026-11-13";
    addItem(db, { date: "2026-11-20", time: "19:00", name: "Пятничный", presetId: preset.id, seatLimit: 27, note: "" }, today, NOW);
    const gone = addItem(db, { date: "2026-11-21", time: "19:00", name: "Отменённый", presetId: preset.id, seatLimit: "", note: "" }, today, NOW);
    setCancelled(db, gone.id, true, NOW);
    const s = siteSchedule(db, NOW);
    expect(s.today).toBe(today);
    expect(s.items).toEqual([
      {
        id: expect.any(Number),
        date: "2026-11-20",
        time: "19:00",
        name: "Пятничный",
        note: "",
        seatLimit: 27,
        started: false,
        structure: { name: preset.name, startingStack: preset.starting_stack, entryPrice: 800 },
      },
    ]);
  });
});

describe("«О клубе»", () => {
  it("сначала пусто; сохраняется и читается", () => {
    expect(getAbout(db).address).toBe("");
    saveAbout(db, { address: "Воронеж, ул. Примерная, 1", telegram: "t.me/gotopoker" }, NOW);
    expect(getAbout(db)).toMatchObject({ address: "Воронеж, ул. Примерная, 1", telegram: "https://t.me/gotopoker", vk: "" });
    expect(() => saveAbout(db, { vk: "javascript:alert(1)" }, NOW)).toThrow();
  });
});
