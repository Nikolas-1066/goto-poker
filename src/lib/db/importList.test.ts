import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../types";
import { applyList, checkList } from "./importList";
import { createPlayer, listPlayers } from "./players";
import { addItem } from "./schedule";
import { listSignups, signUp } from "./signups";
import { loadState, openStore, transaction, writeState } from "./sqlite";
import { currentTournament, listParticipants } from "./tournament";

const NOW = Date.UTC(2026, 10, 13, 12, 0);
const TODAY = "2026-11-13";

let dir: string;
let db: DatabaseSync;
const ids: Record<string, number> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-import-"));
  db = openStore(dir, NOW - 86_400_000).db;
  for (const [i, name] of ["FALKROOM", "Глесо", "Ghost", "Саша"].entries()) ids[name] = createPlayer(db, { name, phone: `+7900000000${i}` }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Как store.updateDb: одной транзакцией */
const write = <T>(hook: (next: Db) => T): T => {
  const before = loadState(db);
  const next = structuredClone(before);
  let out!: T;
  transaction(db, () => {
    out = hook(next);
    writeState(db, before, next);
  });
  return out;
};

const TEXT = "FALKROOM\nглесо\nГост\nЛенин\t89001234567\nNMK";

describe("вставить список", () => {
  it("проверка: найден / похож / новый; ничего не меняет", () => {
    const rows = checkList(db, TEXT, { kind: "tournament" });
    expect(rows.map((r) => [r.name, r.match.kind])).toEqual([
      ["FALKROOM", "found"],
      ["глесо", "found"],
      ["Гост", "choose"],
      ["Ленин", "new"],
      ["NMK", "new"],
    ]);
    expect(rows[2].options).toEqual([{ id: ids.Ghost, name: "Ghost", tail: "··· 00-02", already: false }]);
    expect(listPlayers(db)).toHaveLength(4);
  });

  it("в текущий турнир: новые заводятся, все — «записан», повтор пропускается", () => {
    const r = write((next) =>
      applyList(db, next, { kind: "tournament" }, [{ playerId: ids.FALKROOM }, { playerId: ids["Глесо"] }, { name: "Ленин", phone: "89001234567" }, { playerId: ids.FALKROOM }], NOW),
    );
    expect(r).toEqual({ added: 3, created: 1, skipped: [] });
    const people = listParticipants(db, currentTournament(db).id);
    expect(people.map((p) => p.name).sort()).toEqual(["FALKROOM", "Глесо", "Ленин"].sort());
    expect(people.every((p) => p.status === "registered")).toBe(true);
    // второй раз — уже записаны
    expect(checkList(db, "FALKROOM", { kind: "tournament" })[0].options[0].already).toBe(true);
    expect(write((next) => applyList(db, next, { kind: "tournament" }, [{ playerId: ids.FALKROOM }], NOW)).added).toBe(0);
  });

  it("новый игрок без телефона или с занятым телефоном — понятная ошибка, ничего не записано", () => {
    expect(() => write((next) => applyList(db, next, { kind: "tournament" }, [{ playerId: ids.Ghost }, { name: "NMK", phone: "" }], NOW))).toThrow("«NMK»: Укажите телефон");
    expect(() => write((next) => applyList(db, next, { kind: "tournament" }, [{ name: "NMK", phone: "+79000000000" }], NOW))).toThrow("уже записан у игрока «FALKROOM»");
    expect(listParticipants(db, currentTournament(db).id)).toHaveLength(0);
    expect(listPlayers(db)).toHaveLength(4);
  });

  it("на турнир из расписания: запись админом, гости уже записанных не сбрасываются", () => {
    const it = addItem(db, { date: "2026-11-20", time: "19:00", name: "Пятничный", presetId: (db.prepare("SELECT id FROM presets LIMIT 1").get() as { id: string }).id, seatLimit: "", note: "" }, TODAY, NOW);
    signUp(db, it.id, { playerId: ids["Саша"] }, { guests: 2 }, NOW);
    const r = write((next) => applyList(db, next, { kind: "schedule", id: it.id }, [{ playerId: ids["Саша"] }, { playerId: ids.Ghost }], NOW));
    expect(r.added).toBe(1);
    const list = listSignups(db, it);
    expect(list.map((s) => [s.name, s.guests, s.byAdmin])).toEqual([
      ["Саша", 2, true],
      ["Ghost", 0, true],
    ]);
  });
});
