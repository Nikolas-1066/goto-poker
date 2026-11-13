import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openedTournament } from "../schedule";
import type { Db } from "../types";
import { confirmRequest, register, sessionAccount, type Account } from "./accounts";
import { createPlayer } from "./players";
import { addItem, linkOpened, markOpened, setCancelled } from "./schedule";
import { cancelSignup, guestsOfTournament, listSignups, mySignups, signUp, siteSignups, syncAllSignups, syncSignups, unsyncSignup } from "./signups";
import { loadState, openStore, transaction, writeState } from "./sqlite";
import { applyPlayerAction, archiveCurrentIfUsed, currentTournament, listParticipants } from "./tournament";

const NOW = Date.UTC(2026, 10, 13, 12, 0); // пятница 13 ноября, 15:00 в клубе
const TODAY = "2026-11-13";

let dir: string;
let db: DatabaseSync;
let presetId: string;
const ids: Record<string, number> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-signups-"));
  db = openStore(dir, NOW - 86_400_000).db;
  presetId = (db.prepare("SELECT id FROM presets LIMIT 1").get() as { id: string }).id;
  for (const [i, name] of ["Саша", "Ира", "Олег", "Женя"].entries()) ids[name] = createPlayer(db, { name, phone: `+7900000000${i}` }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const item = (seatLimit: number | "" = "", date = "2026-11-20") => addItem(db, { date, time: "19:00", name: "Пятничный", presetId, seatLimit, note: "" }, TODAY, NOW);
const account = (name: string, phone: string, confirm = true): Account => {
  const token = register(db, { name, phone, password: "секрет1" }, NOW);
  const acc = sessionAccount(db, token, NOW)!;
  if (confirm) confirmRequest(db, acc.id, null, NOW);
  return sessionAccount(db, token, NOW)!;
};
/** Как store.updateDb: изменение турнира и записи — одной транзакцией */
const write = (edit: (next: Db) => void, hook?: (next: Db) => void) => {
  const before = loadState(db);
  const next = structuredClone(before);
  edit(next);
  transaction(db, () => {
    hook?.(next);
    writeState(db, before, next);
  });
};
const open = (id: number, now = NOW) => {
  const it = db.prepare("SELECT name, preset_id FROM schedule WHERE id = ?").get(id) as { name: string; preset_id: string };
  write(
    (d) => {
      d.tournament = openedTournament(d.tournament, { name: it.name, presetId: it.preset_id }, now, (pid) => d.presets.find((p) => p.id === pid));
    },
    () => {
      markOpened(db, id, now);
      archiveCurrentIfUsed(db, now);
    },
  );
  linkOpened(db, id);
};
const people = () => listParticipants(db, currentTournament(db).id).map((p) => [p.name, p.status]);

describe("запись на турнир", () => {
  it("записался с гостями; повторная запись меняет гостей, место в очереди то же; отмена", () => {
    const it1 = item();
    const sasha = account("Саша", "+79000000000");
    signUp(db, it1.id, { account: sasha }, { guests: 2, guestNames: ["Петя"] }, NOW);
    signUp(db, it1.id, { playerId: ids["Ира"] }, {}, NOW + 1);
    signUp(db, it1.id, { account: sasha }, { guests: 1 }, NOW + 2);
    expect(listSignups(db, it1).map((s) => [s.name, s.guests, s.guestNames, s.byAdmin, s.state])).toEqual([
      ["Саша", 1, [], false, "going"],
      ["Ира", 0, [], true, "going"],
    ]);
    expect(siteSignups(db, it1, NOW)).toEqual({
      going: [
        { playerId: ids["Саша"], name: "Саша", guests: 1 },
        { playerId: ids["Ира"], name: "Ира", guests: 0 },
      ],
      waiting: [],
      seats: 3,
      free: null,
      open: true,
    });
    expect(cancelSignup(db, { scheduleId: it1.id, account: sasha }, NOW + 3)).toEqual({ scheduleId: it1.id, playerId: ids["Саша"] });
    expect(listSignups(db, it1).map((s) => s.name)).toEqual(["Ира"]);
    expect(() => cancelSignup(db, { scheduleId: it1.id, account: sasha }, NOW + 4)).toThrow("Запись не найдена");
  });

  it("лимит мест и лист ожидания: отменили — первый из очереди проходит сам", () => {
    const it1 = item(3);
    const sasha = account("Саша", "+79000000000");
    const ira = account("Ира", "+79000000001");
    signUp(db, it1.id, { account: sasha }, { guests: 1 }, NOW);
    signUp(db, it1.id, { account: ira }, { guests: 1 }, NOW + 1); // двое не помещаются
    signUp(db, it1.id, { playerId: ids["Олег"] }, {}, NOW + 2); // место есть, но очередь строгая
    expect(listSignups(db, it1).map((s) => [s.name, s.state])).toEqual([["Саша", "going"], ["Ира", "waiting"], ["Олег", "waiting"]]);
    expect(siteSignups(db, it1, NOW)).toMatchObject({ seats: 2, free: 1 });
    expect(mySignups(db, ira, NOW)).toEqual([
      { scheduleId: it1.id, date: "2026-11-20", time: "19:00", name: "Пятничный", guests: 1, guestNames: [], state: "waiting", queue: 1, started: false },
    ]);
    cancelSignup(db, { scheduleId: it1.id, account: sasha }, NOW + 3);
    expect(listSignups(db, it1).map((s) => [s.name, s.state])).toEqual([["Ира", "going"], ["Олег", "going"]]);
    expect(mySignups(db, ira, NOW)[0]).toMatchObject({ state: "going", queue: 0 });
    expect(mySignups(db, sasha, NOW)).toEqual([]);
  });

  it("запись закрыта после времени начала и на отменённый турнир; админ записывает и после начала", () => {
    const today = item("", TODAY);
    const sasha = account("Саша", "+79000000000");
    const after = Date.UTC(2026, 10, 13, 16, 0); // 19:00 в клубе
    expect(() => signUp(db, today.id, { account: sasha }, {}, after)).toThrow("уже закрыта");
    signUp(db, today.id, { playerId: ids["Ира"] }, {}, after);
    expect(() => signUp(db, today.id, { playerId: 999 }, {}, after)).toThrow("Игрок не найден");
    expect(siteSignups(db, today, after).open).toBe(false);
    const gone = item();
    setCancelled(db, gone.id, true, NOW);
    expect(() => signUp(db, gone.id, { account: sasha }, {}, NOW)).toThrow("отменён");
    expect(mySignups(db, sasha, NOW)).toEqual([]);
  });

  it("новичок записывается до подтверждения заявки — под именем из заявки, без игрока", () => {
    const it1 = item();
    const novice = account("Новичок", "+79005556677", false);
    signUp(db, it1.id, { account: novice }, {}, NOW);
    expect(listSignups(db, it1)).toMatchObject([{ playerId: null, name: "Новичок" }]);
    const { playerId } = confirmRequest(db, novice.id, null, NOW);
    expect(listSignups(db, it1)).toMatchObject([{ playerId, name: "Новичок" }]);
  });
});

describe("открытый турнир", () => {
  it("при открытии записанные попадают в турнир; лист ожидания и неподтверждённые — нет; после подтверждения — попадают", () => {
    const it1 = item(3, TODAY);
    const sasha = account("Саша", "+79000000000");
    const novice = account("Новичок", "+79005556677", false);
    signUp(db, it1.id, { account: sasha }, { guests: 1, guestNames: ["Петя"] }, NOW);
    signUp(db, it1.id, { account: novice }, {}, NOW + 1);
    signUp(db, it1.id, { playerId: ids["Олег"] }, {}, NOW + 2); // лист ожидания
    open(it1.id);
    write(() => {}, (next) => void syncSignups(db, next, it1.id, NOW + 3));
    expect(people()).toEqual([["Саша", "registered"]]);
    expect(guestsOfTournament(db)).toEqual({ [ids["Саша"]]: { guests: 1, guestNames: ["Петя"] } });

    confirmRequest(db, novice.id, null, NOW + 4);
    write(() => {}, (next) => syncAllSignups(db, next, NOW + 5));
    expect(people().sort()).toEqual([["Новичок", "registered"], ["Саша", "registered"]]);
  });

  it("отмена записи убирает из турнира, пока игрок не пришёл; пришедшему отменять нечего", () => {
    const it1 = item("", TODAY);
    const sasha = account("Саша", "+79000000000");
    const ira = account("Ира", "+79000000001");
    signUp(db, it1.id, { account: sasha }, {}, NOW);
    signUp(db, it1.id, { account: ira }, {}, NOW + 1);
    open(it1.id);
    write(() => {}, (next) => void syncSignups(db, next, it1.id, NOW + 2));
    write(() => {}, (next) => void applyPlayerAction(db, next, { type: "enter", playerId: ids["Ира"] }, NOW + 3));

    write(() => {}, (next) => {
      const c = cancelSignup(db, { scheduleId: it1.id, account: sasha }, NOW + 4);
      unsyncSignup(db, next, c.scheduleId, c.playerId, true, NOW + 4);
    });
    expect(people()).toEqual([["Ира", "playing"]]);
    expect(() =>
      write(() => {}, (next) => {
        const c = cancelSignup(db, { scheduleId: it1.id, account: ira }, NOW + 5);
        unsyncSignup(db, next, c.scheduleId, c.playerId, true, NOW + 5);
      }),
    ).toThrow("уже отмечены в турнире");
    expect(listSignups(db, it1).map((s) => s.name)).toEqual(["Ира"]); // отмена откатилась вместе с ошибкой
  });
});
