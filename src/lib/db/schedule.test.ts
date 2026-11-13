import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import { openedTournament } from "../schedule";
import type { Db } from "../types";
import { createPlayer } from "./players";
import {
  addItem,
  addTemplate,
  deleteTemplate,
  ensureSchedule,
  getItem,
  linkOpened,
  listSchedule,
  listTemplates,
  markOpened,
  setCancelled,
  updateItem,
  updateTemplate,
} from "./schedule";
import { loadState, openStore, transaction, writeState } from "./sqlite";
import { applyPlayerAction, archiveCurrentIfUsed, currentTournament } from "./tournament";

const TODAY = "2026-11-13"; // пятница
const T0 = Date.UTC(2026, 10, 13, 12, 0);

let dir: string;
let db: DatabaseSync;
let state: Db;
let preset: string;

/** Как store.updateDb: изменение Db + запись в другие таблицы — одной транзакцией */
function write(edit: (next: Db) => void, hook?: (db: DatabaseSync, next: Db) => void) {
  const next = structuredClone(state);
  edit(next);
  transaction(db, () => {
    hook?.(db, next);
    writeState(db, state, next);
  });
  state = next;
}
/** Как POST /api/schedule { type: "open" } */
function open(id: number, now = T0) {
  const item = getItem(db, id);
  write(
    (d) => {
      d.tournament = openedTournament(d.tournament, item, now, (pid) => d.presets.find((p) => p.id === pid));
    },
    (sqlite) => {
      markOpened(sqlite, id, now);
      archiveCurrentIfUsed(sqlite, now);
    },
  );
  linkOpened(db, id);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-schedule-"));
  db = openStore(dir).db;
  state = loadState(db)!;
  preset = state.presets[0].id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const friday = () => ({ weekday: 5, time: "19:00", name: "Пятничный", presetId: preset, seatLimit: 27, note: "" });

describe("постоянные дни", () => {
  it("ставит турниры на 2 недели вперёд и не дублирует", () => {
    addTemplate(db, friday(), TODAY, T0);
    expect(listSchedule(db, TODAY).map((x) => [x.date, x.time, x.name, x.seatLimit])).toEqual([
      ["2026-11-13", "19:00", "Пятничный", 27],
      ["2026-11-20", "19:00", "Пятничный", 27],
    ]);
    expect(ensureSchedule(db, TODAY, T0)).toBe(0);
    // прошла неделя — появилась следующая пятница
    expect(ensureSchedule(db, "2026-11-20", T0)).toBe(1);
    expect(listSchedule(db, "2026-11-20").map((x) => x.date)).toEqual(["2026-11-20", "2026-11-27"]);
  });

  it("отменённый турнир не ставится заново; его можно вернуть", () => {
    addTemplate(db, friday(), TODAY, T0);
    const second = listSchedule(db, TODAY)[1];
    setCancelled(db, second.id, true, T0);
    expect(ensureSchedule(db, TODAY, T0)).toBe(0);
    expect(listSchedule(db, TODAY).map((x) => x.status)).toEqual(["planned", "cancelled"]);
    expect(setCancelled(db, second.id, false, T0).status).toBe("planned");
  });

  it("правка постоянного дня меняет его будущие турниры, кроме поправленных вручную", () => {
    const t = addTemplate(db, friday(), TODAY, T0);
    const [first, second] = listSchedule(db, TODAY);
    updateItem(db, second.id, { ...second, time: "18:00", name: "Пятничный — день рождения клуба" }, TODAY, T0);
    updateTemplate(db, t.id, { ...friday(), time: "19:30", seatLimit: "" }, TODAY, T0);
    expect(getItem(db, first.id)).toMatchObject({ time: "19:30", seatLimit: null });
    expect(getItem(db, second.id)).toMatchObject({ time: "18:00", name: "Пятничный — день рождения клуба", seatLimit: 27 });
  });

  it("сменили день недели — турниры переезжают на новый день", () => {
    const t = addTemplate(db, friday(), TODAY, T0);
    updateTemplate(db, t.id, { ...friday(), weekday: 6 }, TODAY, T0);
    expect(listSchedule(db, TODAY).map((x) => x.date)).toEqual(["2026-11-14", "2026-11-21"]);
    expect(listTemplates(db)).toMatchObject([{ weekday: 6 }]);
  });

  it("убрали постоянный день — его будущие турниры пропадают, открытый остаётся", () => {
    const t = addTemplate(db, friday(), TODAY, T0);
    const [first] = listSchedule(db, TODAY);
    open(first.id);
    deleteTemplate(db, t.id, TODAY, T0);
    expect(listTemplates(db)).toEqual([]);
    expect(listSchedule(db, TODAY)).toMatchObject([{ id: first.id, status: "started", templateId: null }]);
  });
});

describe("турниры вручную", () => {
  const final = () => ({ date: "2026-11-29", time: "17:00", name: "Финал месяца", presetId: preset, seatLimit: "", note: "Только финалисты" });

  it("добавить, поправить, отменить", () => {
    const it0 = addItem(db, final(), TODAY, T0);
    expect(it0).toMatchObject({ date: "2026-11-29", status: "planned", templateId: null, seatLimit: null, note: "Только финалисты" });
    expect(updateItem(db, it0.id, { ...final(), date: "2026-11-30" }, TODAY, T0).date).toBe("2026-11-30");
    expect(setCancelled(db, it0.id, true, T0).status).toBe("cancelled");
  });

  it("понятные ошибки: прошедшая дата, нет структуры", () => {
    expect(() => addItem(db, { ...final(), date: "2026-11-12" }, TODAY, T0)).toThrow("уже прошла");
    expect(() => addItem(db, { ...final(), presetId: "нет такой" }, TODAY, T0)).toThrow("Структура турнира не найдена");
    expect(() => getItem(db, 999)).toThrow("не найден");
  });
});

describe("открыть турнир из расписания", () => {
  const today = () => addItem(db, { date: TODAY, time: "19:00", name: "Пятничный", presetId: preset, seatLimit: "", note: "" }, TODAY, T0);

  it("становится текущим: название, структура, «По игрокам»; строка привязана к турниру", () => {
    const item = today();
    open(item.id);
    expect(state.tournament).toMatchObject({ name: "Пятничный", presetId: preset, mode: "players", status: "idle" });
    const opened = getItem(db, item.id);
    expect(opened.status).toBe("started");
    expect(opened.tournamentId).toBe(currentTournament(db).id);
    expect(() => open(item.id)).toThrow("уже открыт");
    expect(() => updateItem(db, item.id, { ...item }, TODAY, T0)).toThrow("уже открыт");
    expect(() => setCancelled(db, item.id, true, T0)).toThrow("уже открыт");
  });

  it("отменённый открыть нельзя", () => {
    const item = today();
    setCancelled(db, item.id, true, T0);
    expect(() => open(item.id)).toThrow("отменён");
  });

  it("пока текущий турнир идёт или в нём отмечены игроки — нельзя; после завершения — можно, старый уходит в историю", () => {
    const first = today();
    open(first.id);
    const firstId = currentTournament(db).id;
    const pid = createPlayer(db, { name: "Саша", phone: "+79110000001" }).id;
    write(
      () => {},
      (sqlite, next) => void applyPlayerAction(sqlite, next, { type: "enter", playerId: pid }, T0),
    );
    const second = addItem(db, { date: TODAY, time: "22:00", name: "Ночной", presetId: preset, seatLimit: "", note: "" }, TODAY, T0);
    expect(() => open(second.id)).toThrow("уже отмечены игроки");
    expect(getItem(db, second.id).status).toBe("planned"); // ошибка — ничего не записалось

    write((d) => {
      d.tournament = applyAction(d.tournament, { type: "start" }, T0 + 1000, () => undefined);
    });
    expect(() => open(second.id)).toThrow("ещё идёт");

    write((d) => {
      d.tournament = applyAction(d.tournament, { type: "finish" }, T0 + 2000, () => undefined);
    });
    open(second.id, T0 + 3000);
    expect(state.tournament).toMatchObject({ name: "Ночной", status: "idle" });
    expect(currentTournament(db).id).not.toBe(firstId);
    expect(getItem(db, first.id).tournamentId).toBe(firstId);
  });
});
