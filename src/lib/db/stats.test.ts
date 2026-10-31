import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import { computeStats, periodRange } from "../stats";
import type { Db, TournamentAction } from "../types";
import { addPayment } from "./cash";
import { createPlayer } from "./players";
import { openStore, transaction, writeState } from "./sqlite";
import { loadStatsData } from "./stats";
import { applyPlayerAction, archiveCurrentIfUsed, currentTournament, listParticipants, type PlayerAction } from "./tournament";

// Пятница, 2 октября 2026, 19:00
const T0 = new Date(2026, 9, 2, 19).getTime();

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
const player = (action: PlayerAction, now = T0) =>
  write(
    () => {},
    (sqlite, next) => void applyPlayerAction(sqlite, next, action, now),
  );
const byName = (name: string) => listParticipants(db, currentTournament(db).id).find((p) => p.name === name)!;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-stats-"));
  const opened = openStore(dir, T0);
  db = opened.db;
  state = opened.state;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("данные статистики из базы", () => {
  it("завершённый турнир: игроки, re-entry, аддон, деньги, долг, бесплатно; брошенный — не считается", () => {
    clock({ type: "loadPreset", presetId: state.presets[0].id }, T0);
    write((d) => {
      d.tournament.mode = "players";
    });
    clock({ type: "setPrices", prices: { entry: 1500, reentry: 1000, addon: 1000, doubleAddon: 2000 } }, T0);
    const ids = ["Саша", "Ира", "Олег"].map((name, i) => createPlayer(db, { name, phone: `+7900000000${i}` }).id);
    for (const id of ids) player({ type: "enter", playerId: id });
    player({ type: "pay", participantId: byName("Саша").id, amount: 1500, method: "cash" });
    player({ type: "setFree", eventId: byName("Ира").cash.charges[0].eventId, free: true });
    clock({ type: "start" }, T0 + 1000);
    player({ type: "bust", busted: [{ participantId: byName("Олег").id, handOrder: 1 }], knockers: [byName("Саша").id] }, T0 + 2000);
    player({ type: "reentry", participantId: byName("Олег").id }, T0 + 3000);
    clock({ type: "goto", index: 9 }, T0 + 4000); // перерыв с аддоном
    player({ type: "addon", participantId: byName("Саша").id }, T0 + 5000);
    player({ type: "bust", busted: [{ participantId: byName("Олег").id, handOrder: 1 }], knockers: [byName("Саша").id] }, T0 + 6000);
    player({ type: "bust", busted: [{ participantId: byName("Ира").id, handOrder: 1 }], knockers: [byName("Саша").id] }, T0 + 7000);
    player({ type: "finish" }, T0 + 8000);
    const first = currentTournament(db).id;

    // следующий турнир брошен на середине — в статистику не идёт
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[0].id }, T0 + 9000, (x) =>
          d.presets.find((p) => p.id === x),
        );
      },
      (sqlite) => void archiveCurrentIfUsed(sqlite, T0 + 9000),
    );
    write((d) => {
      d.tournament.mode = "players";
    });
    player({ type: "enter", playerId: ids[0] }, T0 + 10_000);
    // Олег отдаёт долг за 2 октября в ноябре
    const nov = new Date(2026, 10, 3, 12).getTime();
    addPayment(db, { tournamentId: first, playerId: ids[2], amount: 2500, method: "transfer" }, nov);

    const data = loadStatsData(db);
    const oct = computeStats(data, periodRange("2026-10")!);
    expect(oct).toMatchObject({ tournaments: 1, players: 3, entries: 3, reentries: 1, addons: 1, newPlayers: 3, avgPlayers: 3 });
    expect(oct).toMatchObject({ paid: 1500, debt: 1000, free: 1500 }); // Саша должен 1 000 за аддон
    expect(oct.weekdays[4]).toMatchObject({ tournaments: 1, avgPlayers: 3, avgPaid: 4000 });
    expect(computeStats(data, periodRange("2026-11")!)).toMatchObject({ paid: 2500, tournaments: 0 });
  });
});
