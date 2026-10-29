import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "../rating/points";
import { currentRules, saveRules } from "./rules";
import { openStore } from "./sqlite";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-rules-"));
  db = openStore(dir, 1000).db;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("правила рейтинга в базе", () => {
  it("при первом обращении — правила по умолчанию из RATING.md, версия 1", () => {
    const v = currentRules(db, 5000);
    expect(v).toEqual({ id: 1, createdAt: 5000, rules: DEFAULT_RULES });
    expect(currentRules(db).id).toBe(1); // повторно не создаётся
  });

  it("сохранение — новая версия, старые остаются; запись в журнал", () => {
    currentRules(db);
    const { version, changed } = saveRules(db, { ...DEFAULT_RULES, koPoints: 10 }, 9000);
    expect(changed).toBe(true);
    expect(version).toMatchObject({ id: 2, createdAt: 9000 });
    expect(currentRules(db).rules.koPoints).toBe(10);
    expect(db.prepare("SELECT COUNT(*) AS n FROM rating_rules").get()).toEqual({ n: 2 });
    const log = db.prepare("SELECT details_json FROM audit_log WHERE action = 'rules.save'").get() as { details_json: string };
    expect(JSON.parse(log.details_json)).toMatchObject({ id: 2, before: { koPoints: 5 }, after: { koPoints: 10 } });
  });

  it("сохранить без изменений — новой версии нет", () => {
    currentRules(db);
    expect(saveRules(db, DEFAULT_RULES).changed).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM rating_rules").get()).toEqual({ n: 1 });
  });

  it("ошибочные правила не сохраняются", () => {
    expect(() => saveRules(db, { ...DEFAULT_RULES, placePoints: [10, 20] })).toThrow("больше, чем за 1");
    expect(currentRules(db).rules).toEqual(DEFAULT_RULES);
  });

  it("версия без новых полей дополняется значениями по умолчанию", () => {
    const { elo: _elo, ...old } = DEFAULT_RULES;
    void _elo;
    db.prepare("INSERT INTO rating_rules (created_at, rules_json) VALUES (1, ?)").run(JSON.stringify(old));
    expect(currentRules(db).rules.elo).toEqual(DEFAULT_RULES.elo);
  });
});
