import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accountMe,
  accountOfPlayer,
  changePassword,
  closeSession,
  confirmRequest,
  getPhoto,
  listRequests,
  login,
  photoVersions,
  register,
  rejectRequest,
  removeAccount,
  removePhoto,
  renamePlayer,
  resetPassword,
  saveFinalistMessage,
  SESSION_MS,
  sessionAccount,
  setPhoto,
} from "./accounts";
import { closePeriod, startPeriod } from "./periods";
import { createPlayer, getPlayer } from "./players";
import { openStore } from "./sqlite";

const DAY = 86_400_000;
const NOV1 = Date.UTC(2026, 10, 1, 9, 0);
const NOW = Date.UTC(2026, 10, 13, 12, 0);

let dir: string;
let db: DatabaseSync;
let sasha: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-accounts-"));
  db = openStore(dir, NOV1 - 40 * DAY).db;
  sasha = createPlayer(db, { name: "Саша", phone: "+79001112233" }).id;
  createPlayer(db, { name: "Ира", phone: "+79002223344" });
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const jpeg = (size = 500) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff]);
  return b;
};

describe("заявка и подтверждение", () => {
  it("заявка ждёт админа; подтвердили — вход привязан к игроку с тем же телефоном", () => {
    const token = register(db, { name: "Александр", phone: "8 900 111-22-33", password: "секрет1" }, NOW);
    const acc = sessionAccount(db, token, NOW)!;
    expect(acc.playerId).toBeNull();
    expect(accountMe(db, acc)).toEqual({ status: "pending", name: "Александр", phone: "+7 900 111-22-33", telegram: false });
    expect(listRequests(db)).toEqual([{ id: acc.id, name: "Александр", phone: "+79001112233", createdAt: NOW, match: { playerId: sasha, name: "Саша" } }]);

    expect(confirmRequest(db, acc.id, null, NOW)).toEqual({ playerId: sasha, created: false });
    expect(listRequests(db)).toEqual([]);
    const me = accountMe(db, sessionAccount(db, token, NOW)!);
    expect(me).toMatchObject({ status: "active", playerId: sasha, name: "Саша", photo: null });
    expect(accountOfPlayer(db, sasha)).toEqual({ phone: "+79001112233", confirmedAt: NOW });
    expect(() => confirmRequest(db, acc.id, null, NOW)).toThrow("уже подтверждена");
  });

  it("новичок, которого нет в базе: после подтверждения появляется новый игрок", () => {
    const token = register(db, { name: "Новичок", phone: "+79005556677", password: "секрет1" }, NOW);
    const id = sessionAccount(db, token, NOW)!.id;
    expect(listRequests(db)[0].match).toBeNull();
    const res = confirmRequest(db, id, null, NOW);
    expect(res.created).toBe(true);
    expect(getPlayer(db, res.playerId)).toMatchObject({ name: "Новичок", phone: "+79005556677" });
  });

  it("админ может привязать к другому игроку; два входа на одного игрока нельзя", () => {
    const a = sessionAccount(db, register(db, { name: "Саня", phone: "+79005556677", password: "секрет1" }, NOW), NOW)!;
    expect(confirmRequest(db, a.id, sasha, NOW)).toEqual({ playerId: sasha, created: false });
    const b = sessionAccount(db, register(db, { name: "Саша", phone: "+79001112233", password: "секрет2" }, NOW), NOW)!;
    expect(() => confirmRequest(db, b.id, null, NOW)).toThrow("уже есть вход");
  });

  it("повторная заявка с тем же телефоном не принимается; отклонённая — удаляется вместе с входом", () => {
    const token = register(db, { name: "Чужой", phone: "+79001112233", password: "секрет1" }, NOW);
    expect(() => register(db, { name: "Саша", phone: "89001112233", password: "секрет2" }, NOW)).toThrow("уже отправлена");
    rejectRequest(db, sessionAccount(db, token, NOW)!.id, NOW);
    expect(sessionAccount(db, token, NOW)).toBeNull();
    expect(listRequests(db)).toEqual([]);
    register(db, { name: "Саша", phone: "89001112233", password: "секрет2" }, NOW); // теперь можно
  });
});

describe("вход и пароль", () => {
  let token: string;
  beforeEach(() => {
    token = register(db, { name: "Саша", phone: "+79001112233", password: "секрет1" }, NOW);
    confirmRequest(db, sessionAccount(db, token, NOW)!.id, null, NOW);
  });

  it("верный пароль — вход, неверный или чужой телефон — нет; вход истекает через 30 дней", () => {
    expect(login(db, "8 (900) 111-22-33", "не тот", NOW)).toBeNull();
    expect(login(db, "+79009999999", "секрет1", NOW)).toBeNull();
    expect(login(db, "ерунда", "секрет1", NOW)).toBeNull();
    const t = login(db, "8 (900) 111-22-33", "секрет1", NOW)!;
    expect(sessionAccount(db, t, NOW)?.playerId).toBe(sasha);
    expect(sessionAccount(db, t, NOW + SESSION_MS + 1)).toBeNull();
    expect(sessionAccount(db, "чужая-строка", NOW)).toBeNull();
    closeSession(db, t);
    expect(sessionAccount(db, t, NOW)).toBeNull();
  });

  it("в базе нет ни пароля, ни строки из cookie в открытом виде", () => {
    const dump = JSON.stringify([db.prepare("SELECT * FROM accounts").all(), db.prepare("SELECT * FROM account_sessions").all()]);
    expect(dump).not.toContain("секрет1");
    expect(dump).not.toContain(token);
  });

  it("смена пароля: нужен текущий; другие устройства выходят", () => {
    const other = login(db, "+79001112233", "секрет1", NOW)!;
    const acc = sessionAccount(db, token, NOW)!;
    expect(() => changePassword(db, acc, "не тот", "новый-пароль", token, NOW)).toThrow("не подошёл");
    expect(() => changePassword(db, acc, "секрет1", "123", token, NOW)).toThrow("минимум 6");
    changePassword(db, acc, "секрет1", "новый-пароль", token, NOW);
    expect(sessionAccount(db, token, NOW)).not.toBeNull();
    expect(sessionAccount(db, other, NOW)).toBeNull();
    expect(login(db, "+79001112233", "секрет1", NOW)).toBeNull();
    expect(login(db, "+79001112233", "новый-пароль", NOW)).not.toBeNull();
  });

  it("админ сбрасывает пароль: временный пароль подходит, старые входы закрыты; вход можно отключить", () => {
    const temp = resetPassword(db, sasha, NOW);
    expect(temp).toMatch(/^\d{8}$/);
    expect(sessionAccount(db, token, NOW)).toBeNull();
    expect(login(db, "+79001112233", temp, NOW)).not.toBeNull();
    removeAccount(db, sasha, NOW);
    expect(accountOfPlayer(db, sasha)).toBeNull();
    expect(login(db, "+79001112233", temp, NOW)).toBeNull();
    expect(getPlayer(db, sasha)).not.toBeNull();
  });
});

describe("ник и фото", () => {
  it("ник меняется; чужой ник взять нельзя", () => {
    expect(renamePlayer(db, sasha, "  Sasha   Pro ", NOW)).toBe("Sasha Pro");
    expect(getPlayer(db, sasha)!.name).toBe("Sasha Pro");
    expect(() => renamePlayer(db, sasha, "ира", NOW)).toThrow("уже есть у другого игрока");
    expect(() => renamePlayer(db, sasha, " ", NOW)).toThrow("Укажите имя");
  });

  it("фото: только JPEG разумного размера; ставится, заменяется, убирается", () => {
    expect(photoVersions(db)).toEqual({});
    expect(() => setPhoto(db, sasha, new Uint8Array(500), "player", NOW)).toThrow("Не получилось прочитать");
    expect(() => setPhoto(db, sasha, jpeg(300_000), "player", NOW)).toThrow("слишком большое");
    expect(() => setPhoto(db, 999, jpeg(), "admin", NOW)).toThrow("Игрок не найден");
    setPhoto(db, sasha, jpeg(), "player", NOW);
    setPhoto(db, sasha, jpeg(700), "admin", NOW + 5);
    expect(photoVersions(db)).toEqual({ [sasha]: NOW + 5 });
    expect(getPhoto(db, sasha)!.length).toBe(700);
    removePhoto(db, sasha, "admin", NOW + 6);
    expect(getPhoto(db, sasha)).toBeNull();
  });
});

describe("финал в личном кабинете", () => {
  function finished(at: number, rows: [number, number, number][]) {
    const tid = Number(
      db.prepare("INSERT INTO tournaments (name, mode, status, created_at, started_at, updated_at) VALUES ('Т', 'players', 'finished', ?, ?, ?)").run(at, at, at).lastInsertRowid,
    );
    for (const [who, place, points] of rows) {
      db.prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at, place, entries, points) VALUES (?, ?, 'busted', ?, ?, 1, ?)").run(tid, who, at, place, points);
    }
  }

  it("идущий месяц — зона финала; закрытый — «вы финалист» и сообщение клуба", () => {
    const ira = (db.prepare("SELECT id FROM players WHERE name = 'Ира'").get() as { id: number }).id;
    const token = register(db, { name: "Саша", phone: "+79001112233", password: "секрет1" }, NOW);
    confirmRequest(db, sessionAccount(db, token, NOW)!.id, null, NOW);
    const me = () => accountMe(db, sessionAccount(db, token, NOW)!);

    const month = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    expect(me()).toMatchObject({ zones: [{ label: "Месяц · Ноябрь", zone: { state: "none" } }], finalistOf: [], finalistMessage: "" });

    finished(NOV1 + DAY, [[ira, 1, 60], [sasha, 2, 45]]);
    db.prepare("UPDATE periods SET finalists_n = 1 WHERE id = ?").run(month.id);
    expect(me()).toMatchObject({ zones: [{ zone: { state: "out", rank: 2, zone: 1, gap: 15 } }] });
    db.prepare("UPDATE periods SET finalists_n = 9 WHERE id = ?").run(month.id);
    expect(me()).toMatchObject({ zones: [{ zone: { state: "in", rank: 2, zone: 9 } }] });

    saveFinalistMessage(db, "Финал 5 декабря в 18:00", NOW);
    closePeriod(db, month.id, { nextStart: NOV1 + 30 * DAY }, NOV1 + 31 * DAY);
    expect(me()).toMatchObject({ finalistOf: ["Месяц · Ноябрь"], finalistMessage: "Финал 5 декабря в 18:00" });

    // финал сыгран — плашка пропадает
    db.prepare("INSERT INTO tournaments (name, mode, status, kind, final_of_period_id, created_at, updated_at) VALUES ('Финал', 'players', 'finished', 'month_final', ?, ?, ?)").run(month.id, NOW, NOW);
    expect(me()).toMatchObject({ finalistOf: [], finalistMessage: "" });
  });
});
