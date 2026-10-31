import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkOwnerPassword, hasOwnerPassword, isOwnerToken, ownerToken, resetOwnerPassword, setOwnerPassword } from "./owner";
import { openStore } from "./sqlite";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-owner-"));
  db = openStore(dir).db;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("пароль владельца", () => {
  it("сначала не задан; задали — проверяется, неверный не подходит", () => {
    expect(hasOwnerPassword(db)).toBe(false);
    expect(checkOwnerPassword(db, "")).toBe(false);
    expect(ownerToken(db)).toBeNull();
    setOwnerPassword(db, "секрет1");
    expect(hasOwnerPassword(db)).toBe(true);
    expect(checkOwnerPassword(db, "секрет1")).toBe(true);
    expect(checkOwnerPassword(db, "секрет2")).toBe(false);
  });

  it("в базе не хранится сам пароль", () => {
    setOwnerPassword(db, "секрет1");
    const row = db.prepare("SELECT value_json FROM settings WHERE key = 'owner'").get() as { value_json: string };
    expect(row.value_json).not.toContain("секрет1");
  });

  it("слишком короткий — понятная ошибка", () => {
    expect(() => setOwnerPassword(db, "123")).toThrow("минимум 4 символа");
  });

  it("смена пароля закрывает старые входы; сброс — тоже", () => {
    setOwnerPassword(db, "секрет1");
    const old = ownerToken(db)!;
    expect(isOwnerToken(db, old)).toBe(true);
    setOwnerPassword(db, "секрет2");
    expect(isOwnerToken(db, old)).toBe(false);
    expect(isOwnerToken(db, ownerToken(db)!)).toBe(true);
    resetOwnerPassword(db);
    expect(hasOwnerPassword(db)).toBe(false);
    expect(isOwnerToken(db, undefined)).toBe(false);
  });
});
