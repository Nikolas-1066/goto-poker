import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import type { Db, TournamentAction } from "../types";
import { createPlayer } from "./players";
import { startPeriod } from "./periods";
import { isReportSent, markReportSent, tournamentReport } from "./report";
import { openStore, transaction, writeState } from "./sqlite";
import { applyPlayerAction, archiveCurrentIfUsed, currentTournament, listParticipants, type PlayerAction } from "./tournament";

const T0 = new Date(2026, 9, 2, 19).getTime();
const DAY = 86_400_000;

let dir: string;
let db: DatabaseSync;
let state: Db;

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
const player = (action: PlayerAction, now: number) => write(() => {}, (sqlite, next) => void applyPlayerAction(sqlite, next, action, now));
const byName = (name: string) => listParticipants(db, currentTournament(db).id).find((p) => p.name === name)!;

/** Турнир: все входят, вылетают по порядку `order` (последний — победитель), всех выбивает победитель */
function play(at: number, order: string[], ids: Record<string, number>) {
  write(
    (d) => {
      d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[0].id }, at, (x) => d.presets.find((p) => p.id === x));
    },
    (sqlite) => void archiveCurrentIfUsed(sqlite, at),
  );
  write((d) => {
    d.tournament.mode = "players";
  });
  clock({ type: "setPrices", prices: { entry: 1500, reentry: 1000, addon: 1000, doubleAddon: 2000 } }, at);
  for (const name of order) player({ type: "enter", playerId: ids[name] }, at);
  clock({ type: "start" }, at + 1000);
  const winner = order.at(-1)!;
  order.slice(0, -1).forEach((name, i) =>
    player({ type: "bust", busted: [{ participantId: byName(name).id, handOrder: 1 }], knockers: [byName(winner).id] }, at + 2000 + i),
  );
  player({ type: "finish" }, at + 9000);
  return currentTournament(db).id;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-report-"));
  const opened = openStore(dir, T0);
  db = opened.db;
  state = opened.state;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("отчёт после турнира", () => {
  it("места с KO, касса, рейтинг месяца до и после", () => {
    const ids = Object.fromEntries(["Саша", "Ира", "Олег"].map((name, i) => [name, createPlayer(db, { name, phone: `+7900000000${i}` }).id]));
    startPeriod(db, "month", { name: "Октябрь", startAt: T0 - DAY }, T0);
    play(T0, ["Олег", "Ира", "Саша"], ids); // Саша выиграл
    const second = play(T0 + DAY, ["Саша", "Ира", "Олег"], ids); // Олег выиграл
    player({ type: "pay", participantId: byName("Ира").id, amount: 1500, method: "card" }, T0 + DAY + 10_000);

    const r = tournamentReport(db, second)!;
    expect(r.tournament).toMatchObject({ players: 3, entries: 3, reentries: 0 });
    expect(r.places.map((p) => [p.place, p.name, p.ko])).toEqual([
      [1, "Олег", 2],
      [2, "Ира", 0],
      [3, "Саша", 0],
    ]);
    expect(r.cash!.summary).toMatchObject({ charged: 4500, paid: 1500, debt: 3000 });
    expect(r.cash!.debtors.map((d) => d.name).sort()).toEqual(["Олег", "Саша"]);
    expect(r.rating!.periodName).toBe("Октябрь");
    // до: Саша 1, Ира 2, Олег 3; после второго турнира Олег поднимается
    const oleg = r.rating!.participants.find((p) => p.name === "Олег")!;
    expect(oleg.before).toBe(3);
    expect(oleg.after).toBeLessThan(3);
    expect(r.rating!.top.find((t) => t.name === "Олег")!.shift).toBe(3 - oleg.after);
  });

  it("без периода рейтинга — rating = null; незавершённый турнир — ошибка", () => {
    const ids = Object.fromEntries(["Саша", "Ира"].map((name, i) => [name, createPlayer(db, { name, phone: `+7900000000${i}` }).id]));
    const id = play(T0, ["Ира", "Саша"], ids);
    expect(tournamentReport(db, id)!.rating).toBeNull();
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[0].id }, T0 + DAY, (x) =>
          d.presets.find((p) => p.id === x),
        );
      },
      (sqlite) => void archiveCurrentIfUsed(sqlite, T0 + DAY),
    );
    write((d) => {
      d.tournament.mode = "players";
    });
    player({ type: "enter", playerId: ids["Саша"] }, T0 + DAY);
    expect(() => tournamentReport(db, currentTournament(db).id)).toThrow("после завершения");
  });

  it("отметка «отчёт отправлен»", () => {
    expect(isReportSent(db, 7)).toBe(false);
    markReportSent(db, 7);
    markReportSent(db, 7);
    expect(isReportSent(db, 7)).toBe(true);
    expect(isReportSent(db, 8)).toBe(false);
  });
});
