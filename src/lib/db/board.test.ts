import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardRating } from "./board";
import { startPeriod } from "./periods";
import { createPlayer } from "./players";
import { saveSettings } from "./settings";
import { openStore } from "./sqlite";
import { currentTournament } from "./tournament";

const DAY = 86_400_000;
const NOV1 = new Date(2026, 10, 1).getTime();
const NOW = NOV1 + 10 * DAY;

let dir: string;
let db: DatabaseSync;
const ids: Record<string, number> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-board-"));
  db = openStore(dir, NOV1 - DAY).db;
  for (const [i, name] of ["Саша", "Ира", "Олег", "Женя"].entries()) ids[name] = createPlayer(db, { name, phone: `+7900000000${i}` }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function finished(at: number, rows: [string, number, number][]) {
  const tid = Number(
    db.prepare("INSERT INTO tournaments (name, status, created_at, started_at, updated_at) VALUES ('Т', 'finished', ?, ?, ?)").run(at, at, at).lastInsertRowid,
  );
  for (const [who, place, points] of rows) {
    db.prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at, place, entries, points) VALUES (?, ?, 'busted', ?, ?, 1, ?)").run(
      tid,
      ids[who],
      at,
      place,
      points,
    );
  }
}

describe("рейтинг на табло", () => {
  it("пусто — экранов нет", () => {
    expect(boardRating(db, NOW)).toEqual({ seconds: 25, month: null, all: null, players: null, preview: null, chipLeaders: null, busts: [] });
  });

  it("топ месяца и за всё время — только имена и очки, не больше N строк", () => {
    finished(NOV1 - 5 * DAY, [["Женя", 1, 100]]);
    startPeriod(db, "month", { startAt: NOV1 }, NOW);
    finished(NOV1 + DAY, [["Саша", 1, 60], ["Ира", 2, 45], ["Олег", 3, 36]]);
    saveSettings(db, { boardTop: 3, boardSeconds: 20 });
    const b = boardRating(db, NOW);
    expect(b.seconds).toBe(20);
    expect(b.month).toEqual({
      title: "Ноябрь",
      rows: [
        { name: "Саша", value: "60" },
        { name: "Ира", value: "45" },
        { name: "Олег", value: "36" },
      ],
    });
    expect(b.all!.rows.map((r) => r.name)).toEqual(["Женя", "Саша", "Ира"]);
    expect(JSON.stringify(b)).not.toContain("+7900"); // телефонов нет
  });

  it("игроки текущего турнира и «сколько даст место» — по числу вошедших", () => {
    const tid = currentTournament(db).id;
    const ins = db.prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at) VALUES (?, ?, 'registered', ?)");
    const pid: Record<string, number> = {};
    for (const n of ["Саша", "Ира", "Олег", "Женя"]) pid[n] = Number(ins.run(tid, ids[n], NOW).lastInsertRowid);
    const ev = db.prepare("INSERT INTO events (tournament_id, participant_id, type, at) VALUES (?, ?, ?, ?)");
    for (const n of ["Саша", "Ира", "Олег"]) ev.run(tid, pid[n], "entry", NOW);
    const bust = Number(ev.run(tid, pid["Олег"], "bust", NOW + 1).lastInsertRowid);
    db.prepare("INSERT INTO knockouts (bust_event_id, knocker_participant_id, share) VALUES (?, ?, 1)").run(bust, pid["Саша"]);

    const b = boardRating(db, NOW);
    // свежий вылет — для заставки «ВЫЛЕТ»: кто, место, кто выбил (имена и места, без телефонов)
    expect(b.busts).toEqual([
      { key: `e${bust}`, at: NOW + 1, out: [{ playerId: ids["Олег"], name: "Олег", place: "3" }], knockers: [{ playerId: ids["Саша"], name: "Саша" }] },
    ]);
    expect(boardRating(db, NOW + 6 * 60_000).busts).toEqual([]); // через 5 минут — уже не свежий
    expect(b.players).toEqual({
      playing: 2,
      total: 3,
      finished: false,
      rows: [
        { name: "Саша", value: "KO 1", out: false },
        { name: "Ира", value: "", out: false },
        { name: "3. Олег", value: "", out: true },
      ],
    });
    // 3 вошедших (записавшаяся Женя не в поле): коэф. √(3/20) = 0,39
    expect(b.preview).toEqual({
      field: 3,
      final: false,
      rows: [
        { name: "1 место", value: "39" },
        { name: "2 место", value: "29" },
        { name: "3 место", value: "23" },
      ],
    });
  });

  it("вылет двоих в одной раздаче — одна заставка; отменённый вылет не показывается", () => {
    const tid = currentTournament(db).id;
    const ins = db.prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at) VALUES (?, ?, 'registered', ?)");
    const ev = db.prepare("INSERT INTO events (tournament_id, participant_id, type, at, hand_id, hand_order, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const pid: Record<string, number> = {};
    for (const n of ["Саша", "Ира", "Олег", "Женя"]) {
      pid[n] = Number(ins.run(tid, ids[n], NOW).lastInsertRowid);
      ev.run(tid, pid[n], "entry", NOW, null, null, null);
    }
    const ko = db.prepare("INSERT INTO knockouts (bust_event_id, knocker_participant_id, share) VALUES (?, ?, ?)");
    const b1 = Number(ev.run(tid, pid["Олег"], "bust", NOW + 1, 1, 1, null).lastInsertRowid);
    const b2 = Number(ev.run(tid, pid["Женя"], "bust", NOW + 1, 1, 2, null).lastInsertRowid);
    ko.run(b1, pid["Саша"], 0.5);
    ko.run(b1, pid["Ира"], 0.5);
    ko.run(b2, pid["Саша"], 0.5);
    ko.run(b2, pid["Ира"], 0.5);
    ev.run(tid, pid["Ира"], "bust", NOW + 2, null, null, NOW + 3); // отменён
    const busts = boardRating(db, NOW).busts;
    expect(busts).toHaveLength(1);
    expect(busts[0].out.map((o) => o.name).sort()).toEqual(["Женя", "Олег"]);
    expect(busts[0].knockers.map((k) => k.name).sort()).toEqual(["Ира", "Саша"]);
  });

  it("лидеры по фишкам — только посчитанные стеки игроков в игре, трое", () => {
    const tid = currentTournament(db).id;
    db.prepare("UPDATE tournaments SET structure_json = ? WHERE id = ?").run(
      JSON.stringify({ startingStack: 30000, rebuyStack: 30000, addonStack: 40000, doubleAddonStack: 80000 }),
      tid,
    );
    const ins = db.prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at) VALUES (?, ?, 'registered', ?)");
    const ev = db.prepare("INSERT INTO events (tournament_id, participant_id, type, at) VALUES (?, ?, ?, ?)");
    const count = db.prepare("UPDATE participants SET stack_count = ?, stack_count_at = ? WHERE id = ?");
    const pid: Record<string, number> = {};
    for (const n of ["Саша", "Ира", "Олег", "Женя"]) {
      pid[n] = Number(ins.run(tid, ids[n], NOW).lastInsertRowid);
      ev.run(tid, pid[n], "entry", NOW);
    }
    expect(boardRating(db, NOW).chipLeaders).toBeNull(); // никого не посчитали — блока нет
    count.run(52000, NOW + 10, pid["Саша"]);
    count.run(91000, NOW + 10, pid["Ира"]);
    count.run(15000, NOW + 10, pid["Олег"]);
    count.run(70000, NOW + 10, pid["Женя"]);
    ev.run(tid, pid["Саша"], "addon", NOW + 20); // аддон после подсчёта прибавляется
    expect(boardRating(db, NOW).chipLeaders).toEqual([
      { name: "Саша", stack: 92000, countedAt: NOW + 10 },
      { name: "Ира", stack: 91000, countedAt: NOW + 10 },
      { name: "Женя", stack: 70000, countedAt: NOW + 10 },
    ]);
  });
});
