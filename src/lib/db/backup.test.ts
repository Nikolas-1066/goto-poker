import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import { backupDatabase, backupsDir, finishedNow, KEEP_BACKUPS, pruneBackups } from "./backup";
import { loadState, openDatabase, openStore, transaction, writeState } from "./sqlite";

const NOW = new Date(2026, 9, 29, 20, 30, 5).getTime(); // 29.10.2026 20:30:05 по местному времени

let dir: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-backup-"));
});

afterEach(() => {
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function open() {
  const s = openStore(dir, NOW);
  opened.push(s.db);
  return s;
}

describe("резервная копия", () => {
  it("кладёт в data/backups файл с датой, временем и причиной", () => {
    const { db } = open();
    const file = backupDatabase(db, dir, "start", NOW);
    expect(path.dirname(file)).toBe(backupsDir(dir));
    expect(path.basename(file)).toBe("goto-poker-2026-10-29_20-30-05-start.db");
  });

  it("копия открывается и содержит те же данные, включая последние изменения", () => {
    const { db, state } = open();
    const next = structuredClone(state);
    next.tournament = applyAction(next.tournament, { type: "update", patch: { ticker: "До копии" } }, NOW, () => undefined);
    transaction(db, () => writeState(db, state, next));

    const copy = openDatabase(backupDatabase(db, dir, "finish", NOW));
    opened.push(copy);
    expect(loadState(copy)).toEqual(next);
  });

  it("копия не меняется, когда основная база меняется дальше", () => {
    const { db, state } = open();
    const file = backupDatabase(db, dir, "start", NOW);
    const next = structuredClone(state);
    next.presets[0].name = "После копии";
    transaction(db, () => writeState(db, state, next));

    const copy = openDatabase(file);
    opened.push(copy);
    expect(loadState(copy).presets[0].name).toBe(state.presets[0].name);
  });

  it("две копии в одну секунду не затирают друг друга", () => {
    const { db } = open();
    const a = backupDatabase(db, dir, "start", NOW);
    const b = backupDatabase(db, dir, "start", NOW);
    expect(a).not.toBe(b);
    expect(path.basename(b)).toBe("goto-poker-2026-10-29_20-30-05-2-start.db");
  });
});

describe("хранить только последние копии", () => {
  const touch = (name: string) => fs.writeFileSync(path.join(backupsDir(dir), name), "");
  const list = () => fs.readdirSync(backupsDir(dir)).sort();

  beforeEach(() => fs.mkdirSync(backupsDir(dir), { recursive: true }));

  it(`оставляет по ${KEEP_BACKUPS} самых новых копий каждого вида`, () => {
    for (let day = 1; day <= 35; day++) {
      const d = String(day).padStart(2, "0");
      touch(`goto-poker-2026-0${day <= 31 ? 1 : 2}-${day <= 31 ? d : String(day - 31).padStart(2, "0")}_20-00-00-start.db`);
    }
    for (let i = 1; i <= 3; i++) touch(`goto-poker-2026-01-0${i}_23-00-00-finish.db`);

    pruneBackups(backupsDir(dir), KEEP_BACKUPS);
    const starts = list().filter((n) => n.endsWith("-start.db"));
    expect(starts).toHaveLength(30);
    expect(starts[0]).toBe("goto-poker-2026-01-06_20-00-00-start.db"); // 5 самых старых удалены
    expect(starts.at(-1)).toBe("goto-poker-2026-02-04_20-00-00-start.db");
    // много перезапусков не вытесняют копии после турниров
    expect(list().filter((n) => n.endsWith("-finish.db"))).toHaveLength(3);
  });

  it("копия с номером в ту же секунду считается более новой", () => {
    touch("goto-poker-2026-01-01_20-00-00-start.db");
    touch("goto-poker-2026-01-01_20-00-00-2-start.db");
    pruneBackups(backupsDir(dir), 1);
    expect(list()).toEqual(["goto-poker-2026-01-01_20-00-00-2-start.db"]);
  });

  it("чужие файлы в папке не трогает (в т.ч. копию старого JSON)", () => {
    touch("goto-poker-before-sqlite-2026-10-29_20-00-00.json");
    touch("моя копия.db");
    touch("goto-poker-2026-01-01_20-00-00-start.db");
    touch("goto-poker-2026-01-02_20-00-00-start.db");
    pruneBackups(backupsDir(dir), 1);
    expect(list()).toEqual(
      ["goto-poker-2026-01-02_20-00-00-start.db", "goto-poker-before-sqlite-2026-10-29_20-00-00.json", "моя копия.db"].sort(),
    );
  });
});

describe("когда делать копию после изменения", () => {
  it("только в момент завершения турнира", () => {
    const { state } = open();
    const finished = structuredClone(state);
    finished.tournament.status = "finished";
    const running = structuredClone(state);
    running.tournament.status = "running";

    expect(finishedNow(running, finished)).toBe(true);
    expect(finishedNow(finished, finished)).toBe(false); // правки после завершения — без новой копии
    expect(finishedNow(state, running)).toBe(false);
  });
});
