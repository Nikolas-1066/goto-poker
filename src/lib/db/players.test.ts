import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlayer, getPlayer, listPlayers, updatePlayer } from "./players";
import { openStore } from "./sqlite";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-players-"));
  db = openStore(dir, 1000).db;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("игроки в базе", () => {
  it("добавить и найти", () => {
    const p = createPlayer(db, { name: " Саша ", phone: "8 900 123-45-67", note: "любит турбо" }, 5000);
    expect(p).toMatchObject({ name: "Саша", phone: "+79001234567", note: "любит турбо", elo: 1000, createdAt: 5000 });
    expect(getPlayer(db, p.id)).toEqual(p);
    expect(listPlayers(db)).toEqual([p]);
  });

  it("второй игрок с тем же телефоном — понятная ошибка", () => {
    createPlayer(db, { name: "Саша", phone: "+79001234567" });
    expect(() => createPlayer(db, { name: "Александр", phone: "89001234567" })).toThrow(
      "Телефон +7 900 123-45-67 уже записан у игрока «Саша»",
    );
    expect(listPlayers(db)).toHaveLength(1);
  });

  it("тёзки с разными телефонами — можно", () => {
    createPlayer(db, { name: "Саша", phone: "+79001234567" });
    createPlayer(db, { name: "Саша", phone: "+79007654321" });
    expect(listPlayers(db)).toHaveLength(2);
  });

  it("изменить имя, телефон и заметку", () => {
    const p = createPlayer(db, { name: "Саша", phone: "+79001234567" }, 1000);
    const u = updatePlayer(db, p.id, { name: "Саша К.", phone: "+79001112233", note: "капитан" }, 2000);
    expect(u).toMatchObject({ name: "Саша К.", phone: "+79001112233", note: "капитан", createdAt: 1000, updatedAt: 2000 });
  });

  it("сохранить игрока со своим же телефоном — не ошибка", () => {
    const p = createPlayer(db, { name: "Саша", phone: "+79001234567" });
    expect(() => updatePlayer(db, p.id, { name: "Саша К.", phone: "+79001234567" })).not.toThrow();
  });

  it("поменять телефон на чужой — нельзя", () => {
    createPlayer(db, { name: "Саша", phone: "+79001234567" });
    const ira = createPlayer(db, { name: "Ира", phone: "+79161112233" });
    expect(() => updatePlayer(db, ira.id, { name: "Ира", phone: "+79001234567" })).toThrow("уже записан у игрока «Саша»");
  });

  it("несуществующий игрок", () => {
    expect(() => updatePlayer(db, 999, { name: "Кто-то", phone: "+79001234567" })).toThrow("Игрок не найден");
  });

  it("добавление и правки записываются в журнал действий", () => {
    const p = createPlayer(db, { name: "Саша", phone: "+79001234567" });
    updatePlayer(db, p.id, { name: "Саша К.", phone: "+79001234567" });
    const log = db.prepare("SELECT action, details_json FROM audit_log WHERE action LIKE 'player.%' ORDER BY id").all() as {
      action: string;
      details_json: string;
    }[];
    expect(log.map((l) => l.action)).toEqual(["player.create", "player.update"]);
    expect(JSON.parse(log[1].details_json)).toMatchObject({ changed: ["name"], before: { name: "Саша" } });
  });
});
