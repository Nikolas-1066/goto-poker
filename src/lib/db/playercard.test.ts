import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recomputeElo } from "./elo";
import { closePeriod, startPeriod } from "./periods";
import { playerCard } from "./playercard";
import { createPlayer } from "./players";
import { openStore } from "./sqlite";

const DAY = 86_400_000;
const NOV1 = new Date(2026, 10, 1).getTime();
const NOW = NOV1 + 20 * DAY;

let dir: string;
let db: DatabaseSync;
const ids: Record<string, number> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-card-"));
  db = openStore(dir, NOV1 - DAY).db;
  for (const [i, name] of ["Саша", "Ира", "Олег"].entries()) ids[name] = createPlayer(db, { name, phone: `+7900000000${i}` }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Завершённый турнир: [имя, место, очки, KO, входов] */
function tournament(name: string, at: number, rows: [string, number, number, number, number][]) {
  const tid = Number(
    db
      .prepare("INSERT INTO tournaments (name, status, created_at, started_at, finished_at, updated_at) VALUES (?, 'finished', ?, ?, ?, ?)")
      .run(name, at, at, at + 1000, at + 1000).lastInsertRowid,
  );
  const ins = db.prepare(
    "INSERT INTO participants (tournament_id, player_id, status, registered_at, place, entries, ko, points) VALUES (?, ?, 'busted', ?, ?, ?, ?, ?)",
  );
  for (const [who, place, points, ko, entries] of rows) ins.run(tid, ids[who], at, place, entries, ko, points);
}

describe("карточка игрока", () => {
  beforeEach(() => {
    startPeriod(db, "month", { startAt: NOV1 }, NOW);
    tournament("Пятница", NOV1 + DAY, [["Саша", 1, 60, 2, 1], ["Ира", 2, 45, 0, 2], ["Олег", 3, 36, 0, 1]]);
    tournament("Суббота", NOV1 + 2 * DAY, [["Ира", 1, 60, 2, 1], ["Саша", 3, 36, 0.5, 1], ["Олег", 2, 45, 0, 1]]);
    recomputeElo(db, NOW);
  });

  it("турниры — от новых к старым, с местом, полем, входами, KO, очками и ELO", () => {
    const c = playerCard(db, ids["Саша"])!;
    expect(c.tournaments.map((t) => [t.name, t.place, t.field, t.entries, t.ko, t.points])).toEqual([
      ["Суббота", 3, 3, 1, 0.5, 36],
      ["Пятница", 1, 3, 1, 2, 60],
    ]);
    expect(c.tournaments[1].eloBefore).toBe(1000);
    expect(c.eloHistory).toHaveLength(2);
  });

  it("статистика: турниры, победы, топ-3, лучшее место, KO, re-entry, очки", () => {
    expect(playerCard(db, ids["Ира"])!.stats).toEqual({ tournaments: 2, wins: 1, top3: 2, bestPlace: 1, ko: 2, reentries: 1, points: 105 });
  });

  it("место в рейтинге месяца и за всё время", () => {
    const c = playerCard(db, ids["Олег"])!;
    expect(c.ratings).toEqual([
      { label: "Месяц · Ноябрь", rank: 3, of: 3, points: 81 },
      { label: "За всё время", rank: 3, of: 3, points: 81 },
    ]);
  });

  it("финалист закрытого периода", () => {
    const month = db.prepare("SELECT id FROM periods").get() as { id: number };
    db.prepare("UPDATE periods SET finalists_n = 2 WHERE id = ?").run(month.id);
    closePeriod(db, month.id, {}, NOW);
    expect(playerCard(db, ids["Саша"])!.finals).toEqual(["Месяц · Ноябрь"]);
    expect(playerCard(db, ids["Олег"])!.finals).toEqual([]);
  });

  it("новичок без турниров и несуществующий игрок", () => {
    const anton = createPlayer(db, { name: "Антон", phone: "+79009999999" });
    expect(playerCard(db, anton.id)!).toMatchObject({ tournaments: [], stats: { tournaments: 0, bestPlace: null } });
    expect(playerCard(db, 999)).toBeNull();
  });
});
