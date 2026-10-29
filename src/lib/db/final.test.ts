import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import type { Db, TournamentAction } from "../types";
import { getTournamentDetails } from "./history";
import { changeFinalist, closePeriod, finalistsOf, openPeriod, setFinalistsN, standingsOf, startPeriod } from "./periods";
import { createPlayer } from "./players";
import { openStore, transaction, writeState } from "./sqlite";
import { applyPlayerAction, archiveCurrentIfUsed, currentTournament, finalInfo, listParticipants, type PlayerAction } from "./tournament";

const DAY = 86_400_000;
const NOV1 = new Date(2026, 10, 1).getTime();
const T0 = NOV1 + 2 * DAY;

let dir: string;
let db: DatabaseSync;
let state: Db;
let msg = "";
const ids: Record<string, number> = {};

function write(edit: (next: Db) => void, hook?: (db: DatabaseSync, next: Db) => void) {
  const next = structuredClone(state);
  edit(next);
  transaction(db, () => {
    hook?.(db, next);
    writeState(db, state, next);
  });
  state = next;
}
const clock = (action: TournamentAction, now: number) =>
  write((d) => {
    d.tournament = applyAction(d.tournament, action, now, (id) => d.presets.find((p) => p.id === id));
  });
const player = (action: PlayerAction, now = T0) =>
  write(
    () => {},
    (sqlite, next) => {
      msg = applyPlayerAction(sqlite, next, action, now).message;
    },
  );
const newTournament = (now: number) =>
  write(
    (d) => {
      d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[0].id }, now, (x) => d.presets.find((p) => p.id === x));
      d.tournament.mode = "players";
    },
    (sqlite) => void archiveCurrentIfUsed(sqlite, now),
  );
const people = () => listParticipants(db, currentTournament(db).id, state.tournament.status === "finished");
const pid = (name: string) => people().find((p) => p.name === name)!.id;

/** Сыграть обычный турнир: места по порядку */
function play(order: string[], at: number) {
  newTournament(at);
  for (const n of order) player({ type: "enter", playerId: ids[n] }, at);
  clock({ type: "start" }, at + 10);
  for (let i = order.length - 1; i > 0; i--) {
    player({ type: "bust", busted: [{ participantId: pid(order[i]), handOrder: 1 }], knockers: [pid(order[0])] }, at + 100 * (order.length - i));
  }
  player({ type: "finish" }, at + 1000);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-final-"));
  const opened = openStore(dir, NOV1 - DAY);
  db = opened.db;
  state = opened.state;
  for (const [i, name] of ["Саша", "Ира", "Олег", "Женя", "Дима"].entries()) ids[name] = createPlayer(db, { name, phone: `+7900000000${i}` }).id;
  startPeriod(db, "month", { startAt: NOV1 }, T0);
  play(["Саша", "Ира", "Олег", "Женя", "Дима"], T0);
  play(["Ира", "Саша", "Женя", "Олег", "Дима"], T0 + DAY);
  setFinalistsN(db, openPeriod(db, "month")!.id, 3);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function closeMonth() {
  return closePeriod(db, openPeriod(db, "month")!.id, {}, T0 + 3 * DAY).closed;
}

describe("финал месяца", () => {
  /** Финалисты закрытого месяца (топ-3) и тот, кто в финал не прошёл */
  function setup() {
    const month = closeMonth();
    const top = finalistsOf(db, month).finalists.map((f) => Object.keys(ids).find((k) => ids[k] === f.playerId)!);
    const outsider = Object.keys(ids).find((k) => !top.includes(k))!;
    newTournament(T0 + 4 * DAY);
    return { month, top, outsider };
  }

  it("пока период не закрыт — финал по нему создать нельзя (его нет в списке)", () => {
    newTournament(T0 + 3 * DAY);
    expect(finalInfo(db).options).toEqual([]);
  });

  it("создаётся из списка финалистов: они записываются сами, тип — «Финал месяца»", () => {
    const { month, top } = setup();
    expect(top).toHaveLength(3);
    expect(finalInfo(db).options).toEqual([{ periodId: month.id, label: "Финал месяца «Ноябрь»" }]);
    player({ type: "setFinal", periodId: month.id }, T0 + 4 * DAY);
    expect(msg).toBe("Финал месяца «Ноябрь»: записано финалистов — 3");
    expect(people().map((p) => p.name).sort()).toEqual([...top].sort());
    expect(people().every((p) => p.status === "registered")).toBe(true);
    expect(finalInfo(db).final).toEqual({ periodId: month.id, label: "Финал месяца «Ноябрь»" });
  });

  it("записать можно только финалистов; wildcard — после добавления в «Архиве»", () => {
    const { month, outsider } = setup();
    player({ type: "setFinal", periodId: month.id }, T0 + 4 * DAY);
    expect(() => player({ type: "enter", playerId: ids[outsider] }, T0 + 4 * DAY)).toThrow(`${outsider} не в списке финалистов «Ноябрь»`);
    changeFinalist(db, month.id, ids[outsider], "add", "wildcard", T0 + 4 * DAY);
    player({ type: "registerFinalists" }, T0 + 4 * DAY);
    expect(msg).toBe("Записано финалистов: 1");
    expect(people().map((p) => p.name)).toContain(outsider);
  });

  function playFinal(month: { id: number }, top: string[]) {
    player({ type: "setFinal", periodId: month.id }, T0 + 4 * DAY);
    for (const n of top) player({ type: "enter", participantId: pid(n) }, T0 + 4 * DAY);
    clock({ type: "start" }, T0 + 4 * DAY + 10);
  }

  it("в финале re-entry нет", () => {
    const { month, top } = setup();
    playFinal(month, top);
    player({ type: "bust", busted: [{ participantId: pid(top[2]), handOrder: 1 }], knockers: [pid(top[0])] }, T0 + 4 * DAY + 20);
    expect(() => player({ type: "reentry", participantId: pid(top[2]), force: true }, T0 + 4 * DAY + 30)).toThrow("В финале re-entry нет");
  });

  it("очки финала — ×1,5; в рейтинг месяца не идут, «за всё время» — идут", () => {
    const { month, top } = setup();
    const before = standingsOf(db, "all").find((s) => s.name === top[0])!.points;
    playFinal(month, top);
    player({ type: "bust", busted: [{ participantId: pid(top[2]), handOrder: 1 }], knockers: [pid(top[0])] }, T0 + 4 * DAY + 20);
    player({ type: "bust", busted: [{ participantId: pid(top[1]), handOrder: 1 }], knockers: [pid(top[0])] }, T0 + 4 * DAY + 30);
    player({ type: "finish" }, T0 + 4 * DAY + 40);
    // 3 игрока: коэф. поля √(3/20) = 0,39; победитель: 100 × 0,39 × 1,5 + 2 × 5 = 68,5 → 69
    const d = getTournamentDetails(db, currentTournament(db).id)!;
    expect(d).toMatchObject({ kind: "month_final" });
    expect(d.results.find((r) => r.name === top[0])!.points).toBe(69);
    expect(standingsOf(db, openPeriod(db, "month")!)).toEqual([]); // в новый месяц финал не идёт
    expect(standingsOf(db, "all").find((s) => s.name === top[0])!.points).toBe(before + 69);
  });

  it("после старта тип турнира не меняется; второй финал по тому же периоду — нельзя", () => {
    const { month, top } = setup();
    player({ type: "setFinal", periodId: month.id }, T0 + 4 * DAY);
    player({ type: "enter", participantId: pid(top[0]) }, T0 + 4 * DAY);
    expect(() => player({ type: "setFinal", periodId: null }, T0 + 4 * DAY)).toThrow("до старта");
    newTournament(T0 + 5 * DAY);
    expect(finalInfo(db).options).toEqual([]); // по «Ноябрю» финал уже есть
    expect(() => player({ type: "setFinal", periodId: month.id }, T0 + 5 * DAY)).toThrow("уже создан");
  });

  it("не финалисты в записи — сначала убрать", () => {
    const { month, outsider } = setup();
    player({ type: "register", playerId: ids[outsider] }, T0 + 4 * DAY);
    expect(() => player({ type: "setFinal", periodId: month.id }, T0 + 4 * DAY)).toThrow(`сначала уберите из записи: ${outsider}`);
  });

  it("обратно в обычный турнир — можно до старта, тогда записать можно любого", () => {
    const { month, outsider } = setup();
    player({ type: "setFinal", periodId: month.id }, T0 + 4 * DAY);
    player({ type: "setFinal", periodId: null }, T0 + 4 * DAY);
    expect(finalInfo(db)).toMatchObject({ kind: "regular", final: null });
    player({ type: "enter", playerId: ids[outsider] }, T0 + 4 * DAY);
    expect(people().find((p) => p.name === outsider)!.status).toBe("playing");
  });
});
