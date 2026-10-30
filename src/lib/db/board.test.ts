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
    expect(boardRating(db, NOW)).toEqual({ seconds: 25, month: null, all: null, players: null, preview: null });
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
});
