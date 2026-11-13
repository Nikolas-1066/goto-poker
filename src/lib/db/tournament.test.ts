import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import type { Db, TournamentAction } from "../types";
import { addPayment, playerDebts, tournamentCash } from "./cash";
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
let lastResult: ReturnType<typeof applyPlayerAction> | null = null;
const player = (action: PlayerAction, now = T0) =>
  write(
    () => {},
    (sqlite, next) => {
      lastResult = applyPlayerAction(sqlite, next, action, now);
    },
  );
const people = () => listParticipants(db, currentTournament(db).id);
const byName = (name: string) => people().find((p) => p.name === name)!;
/** Вылет одного игрока; knockers — кто выбил */
const bust = (participantId: number, at: number, ...knockers: number[]) =>
  player({ type: "bust", busted: [{ participantId, handOrder: 1 }], knockers }, at);

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

  /** «Стандарт»: аддон на перерыве после 8 уровня — это шаг №9 структуры */
  const toAddonBreak = () => clock({ type: "goto", index: 9 }, T0);

  it("аддон и двойной аддон считаются по игроку и на табло", () => {
    toAddonBreak();
    player({ type: "addon", participantId: byName("Саша").id });
    player({ type: "double_addon", participantId: byName("Ира").id });
    expect(byName("Саша").addons).toBe(1);
    expect(byName("Ира").doubleAddons).toBe(1);
    expect(state.tournament).toMatchObject({ addons: 1, doubleAddons: 1 });
    // второй аддон тому же игроку — нельзя, табло не меняется
    expect(() => player({ type: "double_addon", participantId: byName("Саша").id })).toThrow("Саша уже брал(а) аддон");
    expect(state.tournament).toMatchObject({ addons: 1, doubleAddons: 1 });
  });

  it("аддон не на своём перерыве (уровни до и после) — только с подтверждением", () => {
    expect(() => player({ type: "addon", participantId: byName("Саша").id })).toThrow(NeedsForceError); // уровень 1
    clock({ type: "goto", index: 4 }, T0); // первый перерыв (после 4 уровня) — не тот
    expect(() => player({ type: "addon", participantId: byName("Саша").id })).toThrow(NeedsForceError);
    clock({ type: "goto", index: 12 }, T0 + MIN);
    expect(() => player({ type: "addon", participantId: byName("Саша").id }, T0 + 2 * MIN)).toThrow(NeedsForceError);
    player({ type: "addon", participantId: byName("Саша").id, force: true }, T0 + 3 * MIN);
    expect(byName("Саша").addons).toBe(1);
  });

  it("перепутали игрока: аддон можно отменить в любой момент, даже после других действий", () => {
    toAddonBreak();
    player({ type: "addon", participantId: byName("Саша").id }, T0 + 1000);
    player({ type: "double_addon", participantId: byName("Ира").id }, T0 + 2000);
    bust(byName("Ира").id, T0 + 3000, byName("Саша").id); // Саша потом ещё и выбил Иру
    expect(byName("Саша").addonEventId).not.toBeNull();
    player({ type: "cancel", eventId: byName("Саша").addonEventId! }, T0 + 4000);
    expect(byName("Саша")).toMatchObject({ addons: 0, addonEventId: null, ko: 1 });
    expect(lastResult!.message).toBe("Отменено: аддон — Саша");
    // у вылетевшей Иры тоже можно отменить
    player({ type: "cancel", eventId: byName("Ира").addonEventId! }, T0 + 5000);
    expect(byName("Ира")).toMatchObject({ doubleAddons: 0, status: "busted" });
    expect(state.tournament).toMatchObject({ addons: 0, doubleAddons: 0 });
    // и выдать правильному — на перерыве без вопросов
    player({ type: "addon", participantId: byName("Саша").id }, T0 + 6000);
    expect(byName("Саша").addons).toBe(1);
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

describe("вылет и нокауты", () => {
  beforeEach(() => {
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
    player({ type: "enter", playerId: oleg });
  });
  const id = (name: string) => byName(name).id;

  it("вылет с «кто выбил»: место, нокаут, счётчики табло и подсказка админу", () => {
    bust(id("Ира"), T0 + 1000, id("Саша"));
    expect(byName("Ира")).toMatchObject({ status: "busted", place: 3, knockedOutBy: ["Саша"] });
    expect(byName("Саша").ko).toBe(1);
    expect(state.tournament).toMatchObject({ playersLeft: 2, entries: 3 });
    expect(lastResult).toEqual({ message: "Ира — 3 место, KO: Саша", undoEventId: byName("Ира").lastBustEventId });
  });

  it("делёж банка — по 0,5 нокаута двоим", () => {
    bust(id("Ира"), T0 + 1000, id("Саша"), id("Олег"));
    expect(byName("Саша").ko).toBe(0.5);
    expect(byName("Олег").ko).toBe(0.5);
    expect(lastResult!.message).toBe("Ира — 3 место, KO: Саша и Олег");
  });

  it("без нокаута", () => {
    bust(id("Олег"), T0 + 1000);
    expect(people().reduce((s, p) => s + p.ko, 0)).toBe(0);
    expect(lastResult!.message).toBe("Олег — 3 место");
  });

  it("двое в одной раздаче: у кого стек больше — выше; равные стеки делят места", () => {
    const dima = createPlayer(db, { name: "Дима", phone: "+79004445566" }).id;
    player({ type: "enter", playerId: dima });
    player({ type: "bust", busted: [{ participantId: id("Олег"), handOrder: 1 }, { participantId: id("Ира"), handOrder: 2 }], knockers: [id("Саша")] }, T0 + 1000);
    expect([byName("Олег").place, byName("Ира").place]).toEqual([3, 4]);
    expect(byName("Саша").ko).toBe(2);

    // отменяем раздачу целиком и проводим её заново с равными стеками
    player({ type: "cancel", eventId: byName("Олег").lastBustEventId! }, T0 + 2000);
    expect(people().filter((p) => p.status === "busted")).toHaveLength(0);
    player({ type: "bust", busted: [{ participantId: id("Олег"), handOrder: 1 }, { participantId: id("Ира"), handOrder: 1 }], knockers: [id("Саша")] }, T0 + 3000);
    expect(byName("Олег")).toMatchObject({ place: 3, placeTo: 4 });
    expect(lastResult!.message).toBe("Олег — 3–4 место, Ира — 3–4 место, KO: Саша");
  });

  it("ошибки вылета понятны и ничего не записывают", () => {
    bust(id("Ира"), T0 + 1000, id("Саша"));
    const before = structuredClone(state);
    expect(() => bust(id("Олег"), T0 + 2000, id("Ира"))).toThrow("Ира не в игре");
    expect(() => bust(id("Олег"), T0 + 2000, id("Олег"))).toThrow("Олег не может выбить сам себя");
    expect(() => player({ type: "bust", busted: [{ participantId: id("Олег"), handOrder: 1 }, { participantId: id("Саша"), handOrder: 2 }], knockers: [] })).toThrow(
      "Должен остаться хотя бы один игрок",
    );
    expect(loadState(db)).toEqual(before);
  });
});

describe("отмена", () => {
  beforeEach(() => {
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
  });

  it("отмена вылета возвращает игрока в игру и убирает нокаут", () => {
    bust(byName("Ира").id, T0 + 1000, byName("Саша").id);
    player({ type: "cancel", eventId: byName("Ира").lastBustEventId! }, T0 + 2000);
    expect(byName("Ира").status).toBe("playing");
    expect(byName("Саша").ko).toBe(0);
    expect(state.tournament.playersLeft).toBe(2);
    expect(lastResult!.message).toBe("Отменено: вылет — Ира");
  });

  it("«Отменить» сразу после «Пришёл» — игрок снова только записан", () => {
    player({ type: "enter", playerId: oleg }, T0 + 1000);
    player({ type: "cancel", eventId: lastResult!.undoEventId! }, T0 + 2000);
    expect(byName("Олег").status).toBe("registered");
    expect(state.tournament.entries).toBe(2);
  });

  it("вылет, после которого был re-entry, отменить нельзя — сначала отменяется re-entry", () => {
    // новый турнир на «Турбо»: re-entry до 6 уровня
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[1].id }, T0, (x) =>
          d.presets.find((p) => p.id === x),
        );
      },
      (sqlite) => void archiveCurrentIfUsed(sqlite, T0),
    );
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
    bust(byName("Ира").id, T0 + 1000, byName("Саша").id);
    const bustId = byName("Ира").lastBustEventId!;
    player({ type: "reentry", participantId: byName("Ира").id }, T0 + 2000);
    expect(() => player({ type: "cancel", eventId: bustId }, T0 + 3000)).toThrow("Сначала отмените более поздние действия");
  });

  it("дважды отменить нельзя; отмена пишется в журнал действий", () => {
    bust(byName("Ира").id, T0 + 1000);
    const e = byName("Ира").lastBustEventId!;
    player({ type: "cancel", eventId: e }, T0 + 2000);
    expect(() => player({ type: "cancel", eventId: e }, T0 + 3000)).toThrow("уже отменено");
    const log = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tournament.cancel'").get() as { n: number };
    expect(log.n).toBe(1);
  });
});

describe("рассадка", () => {
  beforeEach(() => {
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
    player({ type: "register", playerId: oleg });
  });
  const seat = (name: string, tableNo: number | null, seatNo: number | null) =>
    player({ type: "seat", participantId: byName(name).id, tableNo, seatNo });

  it("посадить за стол и на место, пересадить, убрать", () => {
    seat("Саша", 2, 5);
    expect(byName("Саша")).toMatchObject({ tableNo: 2, seatNo: 5 });
    expect(lastResult!.message).toBe("Саша — стол 2, место 5");
    seat("Саша", 1, null);
    expect(byName("Саша")).toMatchObject({ tableNo: 1, seatNo: null });
    seat("Саша", null, null);
    expect(byName("Саша")).toMatchObject({ tableNo: null, seatNo: null });
    expect(lastResult!.message).toBe("Саша — без стола");
  });

  it("записавшегося можно посадить заранее", () => {
    seat("Олег", 3, 1);
    expect(byName("Олег")).toMatchObject({ status: "registered", tableNo: 3, seatNo: 1 });
  });

  it("занятое место — понятная ошибка; после вылета место освобождается", () => {
    seat("Саша", 1, 4);
    expect(() => seat("Ира", 1, 4)).toThrow("Стол 1, место 4 уже занято: Саша");
    expect(() => seat("Олег", 1, 4)).toThrow("уже занято: Саша");
    // место без номера у двоих — можно
    seat("Ира", 1, null);
    seat("Олег", 1, null);
    bust(byName("Саша").id, T0 + 1000, byName("Ира").id);
    seat("Олег", 1, 4);
    expect(byName("Олег").seatNo).toBe(4);
  });

  it("стол и место — в разрешённых пределах", () => {
    expect(() => seat("Саша", 4, 1)).toThrow("Стол — от 1 до 3");
    expect(() => seat("Саша", 1, 11)).toThrow("Место — от 1 до 10");
    expect(() => seat("Саша", 0, 1)).toThrow("Стол — от 1 до 3");
  });
});

describe("автопосадка и стек (рассадка столов)", () => {
  const extra = (n: number) =>
    Array.from({ length: n }, (_, i) => createPlayer(db, { name: `Гость ${i + 1}`, phone: `+7911000${String(i).padStart(4, "0")}` }).id);
  const seated = () => people().filter((p) => p.status === "playing" && p.tableNo != null);

  it("«Пришёл» сажает за стол 1 до лимита, потом за стол 2 и подсказывает пересадку; места не повторяются", () => {
    player({ type: "setSeating", seatsPerTable: 4 });
    for (const id of [sasha, ira, oleg, ...extra(3)]) player({ type: "enter", playerId: id });
    expect(lastResult!.seat).toMatchObject({ tableNo: 2 });
    // стол 1 полный (4), за столом 2 двое — подсказка прямо в сообщении
    expect(lastResult!.message).toMatch(/· стол 2, место [1-4] · пересадите со стола 1 за стол 2 — 1 игрок$/);
    const list = seated();
    expect(list.filter((p) => p.tableNo === 1)).toHaveLength(4);
    expect(list.filter((p) => p.tableNo === 2)).toHaveLength(2);
    expect(new Set(list.map((p) => `${p.tableNo}/${p.seatNo}`)).size).toBe(6);
    expect(list.every((p) => p.seatNo! >= 1 && p.seatNo! <= 4)).toBe(true);
  });

  it("заранее посаженный остаётся на своём месте; без автопосадки — никого не сажают", () => {
    player({ type: "register", playerId: oleg });
    player({ type: "seat", participantId: byName("Олег").id, tableNo: 3, seatNo: 7 });
    player({ type: "enter", participantId: byName("Олег").id });
    expect(byName("Олег")).toMatchObject({ tableNo: 3, seatNo: 7 });
    player({ type: "setSeating", autoSeat: false });
    player({ type: "enter", playerId: sasha });
    expect(byName("Саша").tableNo).toBeNull();
    expect(lastResult!.seat).toBeUndefined();
    player({ type: "autoSeat", participantId: byName("Саша").id });
    expect(byName("Саша").tableNo).toBe(3); // открыт только стол 3 — туда же, пока есть место
  });

  it("re-entry — новое место; отмена «Пришёл» освобождает место", () => {
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
    bust(byName("Ира").id, T0 + 1000, byName("Саша").id);
    player({ type: "reentry", participantId: byName("Ира").id }, T0 + 2000);
    expect(byName("Ира").tableNo).toBe(1);
    expect(byName("Ира").seatNo).not.toBe(byName("Саша").seatNo);
    player({ type: "enter", playerId: oleg }, T0 + 3000);
    player({ type: "cancel", eventId: lastResult!.undoEventId! }, T0 + 4000);
    expect(byName("Олег")).toMatchObject({ status: "registered", tableNo: null, seatNo: null });
  });

  it("все места заняты — игрок в игре без места и понятное сообщение", () => {
    player({ type: "setSeating", seatsPerTable: 2 });
    for (const id of [sasha, ira, oleg, ...extra(4)]) player({ type: "enter", playerId: id });
    expect(lastResult!.seat).toBeNull();
    expect(lastResult!.message).toContain("свободных мест за столами нет");
    expect(() => player({ type: "autoSeat", participantId: people().find((p) => p.tableNo == null)!.id })).toThrow("Свободных мест");
  });

  it("пересадить нескольких сразу; занятое место — ошибка, ничего не меняется", () => {
    player({ type: "setSeating", autoSeat: false });
    for (const id of [sasha, ira, oleg]) player({ type: "enter", playerId: id });
    const seat = (n: string, t: number, sNo: number) => player({ type: "seat", participantId: byName(n).id, tableNo: t, seatNo: sNo });
    seat("Саша", 1, 1);
    seat("Ира", 1, 2);
    seat("Олег", 2, 1);
    // поменять Сашу и Иру местами — можно, их места освобождаются в той же пересадке
    player({
      type: "seatMany",
      moves: [
        { participantId: byName("Саша").id, tableNo: 1, seatNo: 2 },
        { participantId: byName("Ира").id, tableNo: 1, seatNo: 1 },
      ],
    });
    expect([byName("Саша").seatNo, byName("Ира").seatNo]).toEqual([2, 1]);
    expect(() =>
      player({ type: "seatMany", moves: [{ participantId: byName("Саша").id, tableNo: 2, seatNo: 1 }] }),
    ).toThrow("уже занято: Олег");
    expect(byName("Саша")).toMatchObject({ tableNo: 1, seatNo: 2 });
  });

  it("стек: расчётный, вписанный, снова расчётный", () => {
    player({ type: "enter", playerId: sasha });
    const start = state.presets[0].startingStack;
    expect(byName("Саша").stack).toEqual({ value: start, counted: false, countedAt: null });
    player({ type: "setStack", participantId: byName("Саша").id, stack: 52500 }, T0 + 5000);
    expect(byName("Саша").stack).toEqual({ value: 52500, counted: true, countedAt: T0 + 5000 });
    expect(() => player({ type: "setStack", participantId: byName("Саша").id, stack: -1 })).toThrow("целое число");
    player({ type: "setStack", participantId: byName("Саша").id, stack: null });
    expect(byName("Саша").stack.counted).toBe(false);
  });

  it("настройки: от 2 до 10 мест", () => {
    expect(() => player({ type: "setSeating", seatsPerTable: 1 })).toThrow("от 2 до 10");
    player({ type: "setSeating", seatsPerTable: 9 });
    expect(lastResult!.message).toBe("Столы: мест за столом 9 · автопосадка вкл");
  });
});

describe("касса (docs/CASH.md)", () => {
  const PRICES = { entry: 1500, reentry: 1000, addon: 1000, doubleAddon: 2000 };
  const cash = (who: string) => byName(who).cash;
  const tid = () => currentTournament(db).id;

  beforeEach(() => {
    clock({ type: "setPrices", prices: PRICES }, T0);
  });

  it("вход, re-entry и аддон начисляются по цене турнира", () => {
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
    bust(byName("Саша").id, T0 + 1000);
    player({ type: "reentry", participantId: byName("Саша").id }, T0 + 2000);
    clock({ type: "goto", index: 9 }, T0 + 3000);
    player({ type: "double_addon", participantId: byName("Саша").id }, T0 + 4000);
    expect(cash("Саша")).toMatchObject({ charged: 4500, paid: 0, debt: 4500 });
    expect(cash("Саша").charges.map((c) => [c.type, c.price])).toEqual([
      ["entry", 1500],
      ["reentry", 1000],
      ["double_addon", 2000],
    ]);
  });

  it("цена запоминается в момент действия: правка цен не меняет начисленное", () => {
    player({ type: "enter", playerId: sasha });
    clock({ type: "setPrices", prices: { ...PRICES, entry: 1200 } }, T0 + 1000);
    player({ type: "enter", playerId: ira }, T0 + 2000);
    expect([cash("Саша").charged, cash("Ира").charged]).toEqual([1500, 1200]);
  });

  it("отменили вход — начисление снято", () => {
    player({ type: "enter", playerId: sasha });
    player({ type: "cancel", eventId: lastResult!.undoEventId! });
    expect(cash("Саша")).toMatchObject({ charged: 0, debt: 0 });
  });

  it("оплата частями, остаток, отмена ошибочной оплаты", () => {
    player({ type: "enter", playerId: sasha });
    const id = byName("Саша").id;
    player({ type: "pay", participantId: id, amount: 1000, method: "cash" });
    expect(lastResult!.message).toBe("Саша: принято 1 000 ₽ (наличные), осталось 500 ₽");
    player({ type: "pay", participantId: id, amount: 500, method: "card" });
    expect(cash("Саша")).toMatchObject({ paid: 1500, debt: 0, byMethod: { cash: 1000, card: 500, transfer: 0 } });
    expect(() => player({ type: "pay", participantId: id, amount: 100, method: "cash" })).toThrow("Долга нет");

    player({ type: "cancelPayment", paymentId: cash("Саша").payments[1].id });
    expect(cash("Саша")).toMatchObject({ paid: 1000, debt: 500 });
    expect(() => player({ type: "pay", participantId: id, amount: 600, method: "transfer" })).toThrow("Больше, чем долг: 500 ₽");
  });

  it("«Бесплатно» на конкретном действии и снятие отметки", () => {
    player({ type: "enter", playerId: sasha });
    const entry = cash("Саша").charges[0].eventId;
    player({ type: "setFree", eventId: entry, free: true });
    expect(cash("Саша")).toMatchObject({ charged: 0, free: 1500, debt: 0 });
    player({ type: "setFree", eventId: entry, free: false });
    expect(cash("Саша")).toMatchObject({ charged: 1500, free: 0 });
  });

  it("«Пришёл + оплатил» — вход и оплата одним нажатием", () => {
    player({ type: "enter", playerId: ira, pay: "transfer" });
    expect(lastResult!.message).toMatch(/^Ира в игре, оплачено 1 500 ₽ · стол 1, место \d+$/);
    expect(cash("Ира")).toMatchObject({ paid: 1500, debt: 0, byMethod: { transfer: 1500 } });
  });

  it("отмена «Пришёл + оплатил» снимает и вход, и эту оплату", () => {
    player({ type: "enter", playerId: oleg, pay: "cash" });
    player({ type: "cancel", eventId: lastResult!.undoEventId! }, T0 + 1000);
    expect(lastResult!.message).toBe("Отменено: вход — Олег (и оплата 1 500 ₽ — верните деньги)");
    expect(cash("Олег")).toMatchObject({ charged: 0, paid: 0, debt: 0 });
  });

  it("с оплатой убрать из записи нельзя; отменили вход после отдельной оплаты — переплата", () => {
    player({ type: "enter", playerId: oleg });
    const entry = lastResult!.undoEventId!;
    player({ type: "pay", participantId: byName("Олег").id, amount: 1500, method: "cash" }, T0 + 1000);
    player({ type: "cancel", eventId: entry }, T0 + 2000);
    expect(cash("Олег").debt).toBe(-1500); // вход отменён, деньги приняты
    expect(() => player({ type: "unregister", participantId: byName("Олег").id })).toThrow("есть оплата");
  });

  it("после завершения турнира принять оплату можно, остальное — нет", () => {
    player({ type: "enter", playerId: sasha });
    player({ type: "enter", playerId: ira });
    clock({ type: "start" }, T0 + 1000);
    bust(byName("Ира").id, T0 + 2000, byName("Саша").id);
    clock({ type: "finish" }, T0 + 3000);
    expect(state.tournament.status).toBe("finished");
    player({ type: "pay", participantId: byName("Ира").id, amount: 1500, method: "cash" }, T0 + 4000);
    expect(cash("Ира").debt).toBe(0);
    expect(() => player({ type: "enter", playerId: oleg }, T0 + 5000)).toThrow("Турнир завершён");
  });

  it("без цен (старые турниры) ничего не начисляется", () => {
    clock({ type: "setPrices", prices: { entry: 0, reentry: 0, addon: 0, doubleAddon: 0 } }, T0);
    player({ type: "enter", playerId: sasha });
    expect(cash("Саша")).toMatchObject({ charged: 0, debt: 0 });
    expect(tournamentCash(db, tid()).summary).toMatchObject({ charged: 0, paid: 0, debt: 0 });
  });

  it("итог кассы турнира и долги игрока по прошлым турнирам", () => {
    player({ type: "enter", playerId: sasha, pay: "cash" });
    player({ type: "enter", playerId: ira });
    player({ type: "pay", participantId: byName("Ира").id, amount: 500, method: "card" });
    player({ type: "enter", playerId: oleg });
    player({ type: "setFree", eventId: cash("Олег").charges[0].eventId, free: true });
    expect(tournamentCash(db, tid()).summary).toEqual({
      charged: 3000,
      free: 1500,
      paid: 2000,
      byMethod: { cash: 1500, card: 500, transfer: 0 },
      debt: 1000,
      debtors: 1,
      overpaid: 0,
    });

    // новый турнир: долг Иры виден с прошлого, его можно закрыть оплатой за прошлый турнир
    const old = tid();
    archiveCurrentIfUsed(db, T0 + 10_000);
    clock({ type: "loadPreset", presetId: state.presets[0].id }, T0 + 10_000);
    expect(tid()).not.toBe(old);
    expect(playerDebts(db, ira, tid())).toEqual({ debts: [{ tournamentId: old, name: "Стандарт", date: expect.any(Number), debt: 1000 }], total: 1000 });
    expect(playerDebts(db, sasha, tid()).total).toBe(0);
    // Ира пришла на новый турнир — у неё видно долг, его принимают прямо здесь
    player({ type: "register", playerId: ira }, T0 + 11_000);
    expect(byName("Ира").oldDebts).toEqual([{ tournamentId: old, name: "Стандарт", date: expect.any(Number), debt: 1000 }]);
    expect(byName("Ира").cash.debt).toBe(0); // в новом турнире — своя касса
    player({ type: "pay", participantId: byName("Ира").id, amount: 400, method: "cash", tournamentId: old }, T0 + 12_000);
    expect(lastResult!.message).toBe("Ира: принято 400 ₽ (наличные) — долг с прошлого турнира, осталось 600 ₽");
    expect(() =>
      player({ type: "pay", participantId: byName("Ира").id, amount: 700, method: "cash", tournamentId: old }, T0 + 13_000),
    ).toThrow("Больше, чем долг: 600 ₽");
    addPayment(db, { tournamentId: old, playerId: ira, amount: 600, method: "card" }, T0 + 14_000);
    expect(playerDebts(db, ira).debts).toEqual([]);
    expect(byName("Ира").oldDebts).toEqual([]);
  });
});
