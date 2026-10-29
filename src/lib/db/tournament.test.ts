import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import type { Db, TournamentAction } from "../types";
import { createPlayer } from "./players";
import { loadState, openStore, transaction, writeState } from "./sqlite";
import {
  applyPlayerAction,
  archiveCurrentIfUsed,
  currentTournament,
  listParticipants,
  NeedsForceError,
  resetParticipants,
  type PlayerAction,
} from "./tournament";

const T0 = 1_800_000_000_000;
const MIN = 60_000;

let dir: string;
let db: DatabaseSync;
let state: Db;

/** Как store.updateDb: изменение Db + запись в другие таблицы — одной транзакцией */
function write(edit: (next: Db) => void, hook?: (db: DatabaseSync, next: Db) => void) {
  const next = structuredClone(state);
  edit(next);
  transaction(db, () => {
    hook?.(db, next);
    writeState(db, state, next);
  });
  state = next;
  return next;
}
const clock = (action: TournamentAction, now: number) =>
  write((d) => {
    d.tournament = applyAction(d.tournament, action, now, (id) => d.presets.find((p) => p.id === id));
  });
const player = (action: PlayerAction, now = T0) => write(() => {}, (sqlite, next) => applyPlayerAction(sqlite, next, action, now));
const people = () => listParticipants(db, currentTournament(db).id);
const byName = (name: string) => people().find((p) => p.name === name)!;
/** Вылет — кнопка появится на шаге 1.4; здесь пишем событие напрямую */
function bust(participantId: number, at: number) {
  write(
    () => {},
    (sqlite, next) => {
      sqlite
        .prepare("INSERT INTO events (tournament_id, participant_id, type, at) VALUES (?, ?, 'bust', ?)")
        .run(currentTournament(sqlite).id, participantId, at);
      next.tournament.updatedAt = at;
    },
  );
}

let sasha: number;
let ira: number;
let oleg: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-tournament-"));
  const opened = openStore(dir, T0);
  db = opened.db;
  state = opened.state;
  // «Стандарт»: уровни по 20 минут, ребаи и аддоны до конца 8 уровня
  clock({ type: "loadPreset", presetId: state.presets[0].id }, T0);
  write((d) => {
    d.tournament.mode = "players";
  });
  sasha = createPlayer(db, { name: "Саша", phone: "+79001112233" }).id;
  ira = createPlayer(db, { name: "Ира", phone: "+79002223344" }).id;
  oleg = createPlayer(db, { name: "Олег", phone: "+79003334455" }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("запись и «Пришёл»", () => {
  it("записать заранее, потом «Пришёл» — игрок в игре, счётчики табло обновились", () => {
    player({ type: "register", playerId: sasha });
    expect(byName("Саша").status).toBe("registered");
    expect(state.tournament.entries).toBe(0);

    player({ type: "enter", participantId: byName("Саша").id });
    expect(byName("Саша")).toMatchObject({ status: "playing", entries: 1 });
    expect(state.tournament).toMatchObject({ entries: 1, playersLeft: 1, rebuys: 0 });
  });

  it("«Пришёл» сразу по игроку из базы, без записи", () => {
    player({ type: "enter", playerId: ira });
    expect(byName("Ира").status).toBe("playing");
    expect(byName("Ира").arrivedAt).toBe(T0);
  });

  it("дважды записать или дважды войти нельзя", () => {
    player({ type: "register", playerId: sasha });
    expect(() => player({ type: "register", playerId: sasha })).toThrow("уже записан");
    player({ type: "enter", playerId: sasha });
    expect(() => player({ type: "enter", playerId: sasha })).toThrow("Саша уже в турнире");
  });

  it("при первом входе запоминается дата первого визита игрока", () => {
    player({ type: "enter", playerId: oleg }, T0 + 5000);
    player({ type: "enter", playerId: sasha }, T0 + 6000);
    const row = db.prepare("SELECT first_visit_at FROM players WHERE id = ?").get(oleg) as { first_visit_at: number };
    expect(row.first_visit_at).toBe(T0 + 5000);
  });

  it("убрать из записи можно только того, кто ещё не входил", () => {
    player({ type: "register", playerId: sasha });
    player({ type: "unregister", participantId: byName("Саша").id });
    expect(people()).toHaveLength(0);

    player({ type: "enter", playerId: ira });
    expect(() => player({ type: "unregister", participantId: byName("Ира").id })).toThrow("убрать из записи нельзя");
  });

  it("после закрытия регистрации вход — только с подтверждением", () => {
    clock({ type: "start" }, T0);
    clock({ type: "goto", index: 12 }, T0 + MIN); // далеко после 8 уровня
    expect(() => player({ type: "enter", playerId: sasha }, T0 + 2 * MIN)).toThrow(NeedsForceError);
    player({ type: "enter", playerId: sasha, force: true }, T0 + 2 * MIN);
    expect(byName("Саша").status).toBe("playing");
  });

  it("ошибка в действии ничего не записывает", () => {
    const before = structuredClone(state);
    expect(() => player({ type: "enter", participantId: 999 })).toThrow("Участник не найден");
    expect(loadState(db)).toEqual(before);
  });
});

describe("re-entry и аддоны", () => {
  beforeEach(() => {
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
  });

  it("re-entry после вылета: снова в игре, счётчики Re-entry и «в игре» обновились", () => {
    bust(byName("Ира").id, T0 + 1000);
    expect(byName("Ира")).toMatchObject({ status: "busted", place: 2 });
    player({ type: "reentry", participantId: byName("Ира").id }, T0 + 2000);
    expect(byName("Ира")).toMatchObject({ status: "playing", entries: 2, reentries: 1 });
    expect(state.tournament).toMatchObject({ entries: 2, playersLeft: 2, rebuys: 1 });
  });

  it("re-entry тому, кто в игре, — понятная ошибка", () => {
    expect(() => player({ type: "reentry", participantId: byName("Саша").id })).toThrow("Саша ещё в игре");
  });

  it("в финале re-entry нет", () => {
    db.prepare("UPDATE tournaments SET kind = 'month_final' WHERE is_current = 1").run();
    bust(byName("Ира").id, T0 + 1000);
    expect(() => player({ type: "reentry", participantId: byName("Ира").id, force: true })).toThrow("В финале re-entry нет");
  });

  it("аддон и двойной аддон считаются по игроку и на табло", () => {
    player({ type: "addon", participantId: byName("Саша").id });
    player({ type: "double_addon", participantId: byName("Ира").id });
    expect(byName("Саша").addons).toBe(1);
    expect(byName("Ира").doubleAddons).toBe(1);
    expect(state.tournament).toMatchObject({ addons: 1, doubleAddons: 1 });
  });

  it("после закрытия аддонов — только с подтверждением", () => {
    clock({ type: "start" }, T0);
    clock({ type: "goto", index: 12 }, T0 + MIN);
    expect(() => player({ type: "addon", participantId: byName("Саша").id }, T0 + 2 * MIN)).toThrow(NeedsForceError);
  });
});

describe("режим учёта", () => {
  it("в ручном режиме действия с игроками не трогают счётчики табло", () => {
    write((d) => {
      d.tournament.mode = "manual";
      d.tournament.entries = 20;
      d.tournament.playersLeft = 15;
    });
    player({ type: "enter", playerId: sasha });
    expect(state.tournament).toMatchObject({ entries: 20, playersLeft: 15 });
  });

  it("переход на «по игрокам» сразу пересчитывает счётчики по участникам", () => {
    write((d) => {
      d.tournament.mode = "manual";
      d.tournament.entries = 20;
    });
    player({ type: "enter", playerId: sasha });
    player({ type: "setMode", mode: "players" });
    expect(state.tournament).toMatchObject({ mode: "players", entries: 1, playersLeft: 1 });
    expect(loadState(db).tournament.mode).toBe("players");
  });

  it("в режиме «по игрокам» ручные счётчики из админки не принимаются", () => {
    player({ type: "enter", playerId: sasha });
    clock({ type: "update", patch: { playersLeft: 9, entries: 9, ticker: "Привет" } }, T0 + 1000);
    expect(state.tournament).toMatchObject({ playersLeft: 1, entries: 1, ticker: "Привет" });
  });

  it("каждое действие двигает время изменения турнира (табло и другие телефоны видят его)", () => {
    const before = state.tournament.updatedAt;
    player({ type: "register", playerId: sasha }, before - 5000); // даже если часы устройства отстают
    expect(state.tournament.updatedAt).toBeGreaterThan(before);
  });
});

describe("сброс и новый турнир", () => {
  it("«Сбросить турнир»: входы и вылеты удаляются, записавшиеся остаются", () => {
    player({ type: "enter", playerId: sasha });
    player({ type: "register", playerId: ira });
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "reset" }, T0 + 1000, () => undefined);
      },
      (sqlite, next) => resetParticipants(sqlite, next, T0 + 1000),
    );
    expect(people().map((p) => [p.name, p.status])).toEqual([
      ["Ира", "registered"],
      ["Саша", "registered"],
    ]);
    expect(state.tournament).toMatchObject({ entries: 0, playersLeft: 0 });
  });

  it("новая структура после сыгранного турнира — новый турнир, старый с игроками остаётся в истории", () => {
    player({ type: "enter", playerId: sasha });
    const oldId = currentTournament(db).id;
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[1].id }, T0 + 5000, (id) =>
          d.presets.find((p) => p.id === id),
        );
      },
      (sqlite) => void archiveCurrentIfUsed(sqlite, T0 + 5000),
    );
    const newId = currentTournament(db).id;
    expect(newId).not.toBe(oldId);
    expect(people()).toHaveLength(0);
    expect(listParticipants(db, oldId).map((p) => p.name)).toEqual(["Саша"]);
    expect(state.tournament.mode).toBe("players"); // режим переходит в новый турнир
    expect(loadState(db)).toEqual(state);
  });

  it("новая структура до начала турнира и без игроков — тот же турнир, без лишних записей", () => {
    const id = currentTournament(db).id;
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[2].id }, T0 + 5000, (x) =>
          d.presets.find((p) => p.id === x),
        );
      },
      (sqlite) => void archiveCurrentIfUsed(sqlite, T0 + 5000),
    );
    expect(currentTournament(db).id).toBe(id);
  });
});
