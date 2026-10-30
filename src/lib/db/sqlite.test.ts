import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import type { Db } from "../types";
import { MIGRATIONS } from "./schema";
import {
  DB_FILE_NAME,
  getMeta,
  loadState,
  migrate,
  normalizeLegacy,
  openDatabase,
  openStore,
  schemaVersion,
  transaction,
  writeState,
} from "./sqlite";

const NOW = 1_793_034_027_953;

/** Как выглядит goto-poker.json, записанный старой версией (пресет без новых полей стеков). */
function legacyJson() {
  return {
    version: 1,
    presets: [
      {
        id: "std",
        name: "Стандарт",
        description: "Уровни по 20 минут",
        startingStack: 30000,
        rebuyStack: 30000,
        addonStack: 40000,
        doubleAddonStack: 80000,
        rebuyUntilLevel: 8,
        addonUntilLevel: 8,
        steps: [
          { id: "a1", kind: "level", sb: 100, bb: 200, ante: 0, minutes: 20 },
          { id: "a2", kind: "break", minutes: 10, note: "Укрупнение 100" },
          { id: "a3", kind: "level", sb: 200, bb: 400, ante: 400, minutes: 20 },
        ],
        updatedAt: 1_792_000_000_000,
      },
      {
        // очень старый пресет: нет двойного аддона и правил ребаев
        id: "old",
        name: "Турбо",
        startingStack: 20000,
        rebuyStack: 20000,
        addonStack: 30000,
        steps: [{ id: "b1", kind: "level", sb: 100, bb: 200, ante: 200, minutes: 12 }],
        updatedAt: 1_791_000_000_000,
      },
    ],
    tournament: {
      name: "Турбо",
      presetId: "old",
      structure: {
        id: "old",
        name: "Турбо",
        startingStack: 20000,
        rebuyStack: 20000,
        addonStack: 30000,
        steps: [{ id: "b1", kind: "level", sb: 100, bb: 200, ante: 200, minutes: 12 }],
      },
      status: "running",
      stepIndex: 0,
      stepEndsAt: 1_793_034_087_953,
      remainingMs: 600000,
      elapsedBaseMs: 151616,
      runStartedAt: 1_793_033_931_966,
      entries: 8,
      playersLeft: 8,
      rebuys: 2,
      addons: 0,
      doubleAddons: 3,
      combination: "J3",
      ticker: "Привет всем, сегодня играем на пер. Крупской 5",
      tickerOn: true,
      updatedAt: NOW,
    },
  };
}

let dir: string;
const opened: DatabaseSync[] = [];

function open(now = NOW) {
  const s = openStore(dir, now);
  opened.push(s.db);
  return s;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-db-"));
});

afterEach(() => {
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeLegacy = (data: unknown = legacyJson()) =>
  fs.writeFileSync(path.join(dir, "goto-poker.json"), typeof data === "string" ? data : JSON.stringify(data));

describe("первый запуск без старых данных", () => {
  it("создаёт базу с тремя пресетами по умолчанию и пустым турниром", () => {
    const { state, initialized, db } = open();
    expect(initialized).toBe("new");
    expect(fs.existsSync(path.join(dir, DB_FILE_NAME))).toBe(true);
    expect(state.presets.map((p) => p.name)).toEqual(["Стандарт", "Турбо", "Дипстек"]);
    expect(state.tournament.status).toBe("idle");
    expect(state.tournament.structure).toBeNull();
    expect(getMeta(db, "initial_source")).toBe("new");
  });
});

describe("перенос из goto-poker.json", () => {
  it("переносит пресеты, турнир и табло без потерь", () => {
    writeLegacy();
    const { state, initialized } = open();
    expect(initialized).toBe("json");
    // ровно то, что старая версия показала бы после чтения своего файла
    expect(state).toEqual(normalizeLegacy(legacyJson()));
  });

  it("идущий турнир продолжает с той же секунды", () => {
    writeLegacy();
    const t = open().state.tournament;
    expect(t.status).toBe("running");
    expect(t.stepEndsAt).toBe(1_793_034_087_953);
    expect(t.runStartedAt).toBe(1_793_033_931_966);
    expect(t.elapsedBaseMs).toBe(151616);
    expect([t.entries, t.playersLeft, t.rebuys, t.doubleAddons]).toEqual([8, 8, 2, 3]);
    expect([t.combination, t.tickerOn]).toEqual(["J3", true]);
  });

  it("старые пресеты получают новые поля, как и раньше", () => {
    writeLegacy();
    const { state } = open();
    const old = state.presets.find((p) => p.id === "old")!;
    expect(old.doubleAddonStack).toBe(60000);
    expect(old.rebuyUntilLevel).toBe(0);
    expect(old.prices).toEqual({ entry: 0, reentry: 0, addon: 0, doubleAddon: 0 });
    expect(state.tournament.structure?.doubleAddonStack).toBe(60000);
    expect(state.tournament.structure?.prices).toEqual({ entry: 0, reentry: 0, addon: 0, doubleAddon: 0 });
  });

  it("JSON не удаляется: копия в backups/, исходник переименован", () => {
    writeLegacy();
    open();
    expect(fs.existsSync(path.join(dir, "goto-poker.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "goto-poker.json.migrated"))).toBe(true);
    const backups = fs.readdirSync(path.join(dir, "backups"));
    expect(backups).toEqual([expect.stringMatching(/^goto-poker-before-sqlite-.*\.json$/)]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "backups", backups[0]), "utf8"))).toEqual(legacyJson());
  });

  it("повторный запуск ничего не переносит заново и не дублирует", () => {
    writeLegacy();
    open().db.close();
    writeLegacy({ ...legacyJson(), presets: [] }); // кто-то положил JSON обратно
    const again = open(NOW + 1000);
    expect(again.initialized).toBeNull();
    expect(again.state.presets).toHaveLength(2);
    const count = again.db.prepare("SELECT COUNT(*) AS n FROM tournaments").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("повреждённый JSON откладывается в сторону, база начинается с пресетов по умолчанию", () => {
    writeLegacy("{ это не json");
    const { state, initialized } = open();
    expect(initialized).toBe("json-broken");
    expect(state.presets).toHaveLength(3);
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.startsWith("goto-poker.json.broken-"))).toBe(true);
    expect(files).not.toContain("goto-poker.json");
  });
});

describe("запись изменений", () => {
  function change(db: DatabaseSync, prev: Db, edit: (d: Db) => void) {
    const next = structuredClone(prev);
    edit(next);
    transaction(db, () => writeState(db, prev, next));
    return next;
  }

  it("действия с часами и счётчиками сохраняются и читаются обратно", () => {
    writeLegacy();
    const { db, state } = open();
    const find = (id: string) => state.presets.find((p) => p.id === id);
    let next = change(db, state, (d) => {
      d.tournament = applyAction(d.tournament, { type: "pause" }, NOW + 5000, find);
    });
    next = change(db, next, (d) => {
      d.tournament = applyAction(d.tournament, { type: "update", patch: { playersLeft: 7, ticker: "Новая строка" } }, NOW + 6000, find);
    });
    expect(loadState(db)).toEqual(next);
    expect(next.tournament.status).toBe("paused");
    expect(next.tournament.playersLeft).toBe(7);
  });

  it("добавление, изменение, удаление и порядок пресетов", () => {
    const { db, state } = open();
    const next = change(db, state, (d) => {
      d.presets[0].name = "Стандарт 2";
      d.presets.splice(1, 1); // удалить «Турбо»
      d.presets.unshift({ ...d.presets[1], id: "new", name: "Новый" }); // добавить в начало
    });
    expect(loadState(db).presets.map((p) => p.name)).toEqual(["Новый", "Стандарт 2", "Дипстек"]);
    expect(loadState(db)).toEqual(next);
  });

  it("цены пресета и турнира сохраняются", () => {
    const { db, state } = open();
    const prices = { entry: 1500, reentry: 1000, addon: 1000, doubleAddon: 2000 };
    const find = (id: string) => next.presets.find((p) => p.id === id);
    let next = change(db, state, (d) => {
      d.presets[0].prices = prices;
    });
    next = change(db, next, (d) => {
      d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[0].id }, NOW, find);
    });
    const loaded = loadState(db);
    expect(loaded.presets[0].prices).toEqual(prices);
    expect(loaded.tournament.structure?.prices).toEqual(prices);
  });

  it("после закрытия и нового открытия всё на месте", () => {
    writeLegacy();
    const first = open();
    const next = change(first.db, first.state, (d) => {
      d.tournament = applyAction(d.tournament, { type: "finish" }, NOW + 60_000, () => undefined);
    });
    first.db.close();
    expect(open(NOW + 120_000).state).toEqual(next);
  });

  it("отмечает время начала и окончания турнира", () => {
    const { db, state } = open();
    const preset = state.presets[0];
    const find = () => preset;
    let next = change(db, state, (d) => {
      d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: preset.id }, NOW, find);
    });
    next = change(db, next, (d) => {
      d.tournament = applyAction(d.tournament, { type: "start" }, NOW + 1000, find);
    });
    change(db, next, (d) => {
      d.tournament = applyAction(d.tournament, { type: "finish" }, NOW + 9000, find);
    });
    const row = db.prepare("SELECT started_at, finished_at FROM tournaments WHERE is_current = 1").get();
    expect(row).toEqual({ started_at: NOW + 1000, finished_at: NOW + 9000 });
  });

  it("ошибка посреди записи ничего не портит", () => {
    const { db, state } = open();
    const next = structuredClone(state);
    next.presets[0].name = "Не сохранится";
    // у второго пресета ломаем обязательное поле — запись должна откатиться целиком
    (next.presets[1] as unknown as { name: null }).name = null;
    expect(() => transaction(db, () => writeState(db, state, next))).toThrow();
    expect(loadState(db)).toEqual(state);
  });
});

describe("схема и миграции", () => {
  it("новая база получает последнюю версию схемы", () => {
    const { db } = open();
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it("база от более новой программы не открывается (чтобы старая версия её не испортила)", () => {
    const { db } = open();
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow("более новой версией");
  });

  it("база версии 1 (без цен) обновляется: пресеты на месте, цены — 0", () => {
    const file = path.join(dir, "v1.db");
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const old = new DatabaseSync(file);
    old.exec(MIGRATIONS[0]);
    old.exec("PRAGMA user_version = 1");
    old.prepare("INSERT INTO presets (id, name, steps_json, updated_at) VALUES ('p', 'Старый', '[]', 1)").run();
    old.close();
    const db = openDatabase(file);
    opened.push(db);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const p = loadState(db).presets[0];
    expect(p.name).toBe("Старый");
    expect(p.prices).toEqual({ entry: 0, reentry: 0, addon: 0, doubleAddon: 0 });
  });

  it("повторная миграция ничего не делает", () => {
    const db = openDatabase(path.join(dir, "x.db"));
    opened.push(db);
    expect(() => migrate(db)).not.toThrow();
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it("таблицы игроков и турниров связаны правильно", () => {
    const { db } = open();
    const ins = db.prepare("INSERT INTO players (name, phone, created_at, updated_at) VALUES (?, ?, ?, ?)");
    const sasha = Number(ins.run("Саша", "+79001112233", NOW, NOW).lastInsertRowid);
    const ira = Number(ins.run("Ира", "+79004445566", NOW, NOW).lastInsertRowid);
    // телефон у каждого свой
    expect(() => ins.run("Саша 2", "+79001112233", NOW, NOW)).toThrow();

    const tid = (db.prepare("SELECT id FROM tournaments WHERE is_current = 1").get() as { id: number }).id;
    const part = db.prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at) VALUES (?, ?, 'playing', ?)");
    const pSasha = Number(part.run(tid, sasha, NOW).lastInsertRowid);
    const pIra = Number(part.run(tid, ira, NOW).lastInsertRowid);
    // игрок в турнире один раз
    expect(() => part.run(tid, sasha, NOW)).toThrow();

    const bust = Number(
      db.prepare("INSERT INTO events (tournament_id, participant_id, type, at) VALUES (?, ?, 'bust', ?)").run(tid, pIra, NOW)
        .lastInsertRowid,
    );
    db.prepare("INSERT INTO knockouts (bust_event_id, knocker_participant_id, share) VALUES (?, ?, 1)").run(bust, pSasha);
    // несуществующего участника записать нельзя
    expect(() =>
      db.prepare("INSERT INTO knockouts (bust_event_id, knocker_participant_id, share) VALUES (?, 9999, 1)").run(bust),
    ).toThrow();
    // неизвестный тип события — нельзя
    expect(() =>
      db.prepare("INSERT INTO events (tournament_id, participant_id, type, at) VALUES (?, ?, 'rebuy', ?)").run(tid, pIra, NOW),
    ).toThrow();
  });

  it("текущий турнир на табло может быть только один", () => {
    const { db } = open();
    expect(() =>
      db.prepare("INSERT INTO tournaments (name, is_current, created_at, updated_at) VALUES ('Второй', 1, 0, 0)").run(),
    ).toThrow();
  });
});
