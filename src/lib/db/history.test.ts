import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import type { Db, TournamentAction } from "../types";
import { DEFAULT_RULES } from "../rating/points";
import { correctResults, finalizeResults, getTournamentDetails, listHistory, outdatedCount, rescoreAll, validatePlaces } from "./history";
import { saveRules } from "./rules";
import { createPlayer } from "./players";
import { openStore, transaction, writeState } from "./sqlite";
import { applyPlayerAction, archiveCurrentIfUsed, currentTournament, listParticipants, type PlayerAction } from "./tournament";

const T0 = 1_800_000_000_000;

let dir: string;
let db: DatabaseSync;
let state: Db;
let msg = "";

function write(edit: (next: Db) => void, hook?: (db: DatabaseSync, next: Db) => void) {
  const next = structuredClone(state);
  edit(next);
  transaction(db, () => {
    hook?.(db, next);
    writeState(db, state, next);
  });
  state = next;
}
const clock = (action: TournamentAction, now: number, hook?: (db: DatabaseSync, next: Db) => void) =>
  write((d) => {
    d.tournament = applyAction(d.tournament, action, now, (id) => d.presets.find((p) => p.id === id));
  }, hook);
const player = (action: PlayerAction, now = T0) =>
  write(
    () => {},
    (sqlite, next) => {
      msg = applyPlayerAction(sqlite, next, action, now).message;
    },
  );
const tid = () => currentTournament(db).id;
const byName = (name: string) => listParticipants(db, tid(), state.tournament.status === "finished").find((p) => p.name === name)!;
const bust = (who: string, by: string, at: number) =>
  player({ type: "bust", busted: [{ participantId: byName(who).id, handOrder: 1 }], knockers: [byName(by).id] }, at);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-history-"));
  const opened = openStore(dir, T0);
  db = opened.db;
  state = opened.state;
  clock({ type: "loadPreset", presetId: state.presets[0].id }, T0);
  write((d) => {
    d.tournament.mode = "players";
    d.tournament.name = "Пятница";
  });
  for (const [i, name] of ["Саша", "Ира", "Олег", "Женя"].entries()) {
    const p = createPlayer(db, { name, phone: `+7900000000${i}` });
    player({ type: "enter", playerId: p.id });
  }
  clock({ type: "start" }, T0 + 1000);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("завершение турнира", () => {
  it("остался один — он победитель; итоги сохраняются, кто не пришёл — «не пришёл»", () => {
    const anton = createPlayer(db, { name: "Антон", phone: "+79009999999" });
    player({ type: "register", playerId: anton.id });
    bust("Женя", "Саша", T0 + 2000);
    bust("Олег", "Ира", T0 + 3000);
    bust("Ира", "Саша", T0 + 4000);
    player({ type: "finish" }, T0 + 5000);

    expect(msg).toBe("Турнир завершён. Победитель — Саша");
    expect(state.tournament.status).toBe("finished");
    const saved = db
      .prepare("SELECT pl.name, p.status, p.place, p.ko, p.entries FROM participants p JOIN players pl ON pl.id = p.player_id ORDER BY p.place")
      .all();
    expect(saved).toEqual([
      { name: "Антон", status: "no_show", place: null, ko: 0, entries: 0 },
      { name: "Саша", status: "playing", place: 1, ko: 2, entries: 1 },
      { name: "Ира", status: "busted", place: 2, ko: 1, entries: 1 },
      { name: "Олег", status: "busted", place: 3, ko: 0, entries: 1 },
      { name: "Женя", status: "busted", place: 4, ko: 0, entries: 1 },
    ]);
  });

  it("в игре несколько — без дила завершить нельзя", () => {
    bust("Женя", "Саша", T0 + 2000);
    expect(() => player({ type: "finish" }, T0 + 3000)).toThrow("В игре ещё 3 игрока");
    expect(state.tournament.status).toBe("running");
  });

  it("дил: места оставшихся — как расставил администратор", () => {
    bust("Женя", "Саша", T0 + 2000);
    const order = [byName("Олег").id, byName("Саша").id, byName("Ира").id];
    player({ type: "finish", dealOrder: order }, T0 + 3000);
    expect(msg).toBe("Турнир завершён. Победитель — Олег");
    expect(["Олег", "Саша", "Ира", "Женя"].map((n) => byName(n).place)).toEqual([1, 2, 3, 4]);
    expect((db.prepare("SELECT deal FROM tournaments WHERE id = ?").get(tid()) as { deal: number }).deal).toBe(1);
  });

  it("дил с неполным списком — ошибка", () => {
    bust("Женя", "Саша", T0 + 2000);
    expect(() => player({ type: "finish", dealOrder: [byName("Олег").id, byName("Саша").id] }, T0 + 3000)).toThrow(
      "расставьте их места",
    );
  });

  it("после завершения действия с игроками запрещены", () => {
    bust("Женя", "Саша", T0 + 2000);
    bust("Олег", "Саша", T0 + 3000);
    bust("Ира", "Саша", T0 + 4000);
    player({ type: "finish" }, T0 + 5000);
    expect(() => player({ type: "reentry", participantId: byName("Ира").id, force: true })).toThrow("Турнир завершён");
  });

  it("«Завершить» кнопкой часов (по игрокам) тоже сохраняет итоги; повторное — не трогает исправления", () => {
    bust("Женя", "Саша", T0 + 2000);
    bust("Олег", "Саша", T0 + 3000);
    bust("Ира", "Саша", T0 + 4000);
    const hook = (sqlite: DatabaseSync, next: Db) => {
      const was = (sqlite.prepare("SELECT status FROM tournaments WHERE id = ?").get(tid()) as { status: string }).status;
      if (next.tournament.mode === "players" && was !== "finished") finalizeResults(sqlite, tid());
    };
    clock({ type: "finish" }, T0 + 5000, hook);
    expect(byName("Саша").place).toBe(1);

    const results = getTournamentDetails(db, tid())!.results.map((r) => ({ ...r, ko: r.name === "Саша" ? 2 : r.ko }));
    correctResults(db, tid(), results);
    clock({ type: "finish" }, T0 + 6000, hook);
    expect(byName("Саша").ko).toBe(2);
  });
});

describe("история", () => {
  function playToEnd() {
    bust("Женя", "Саша", T0 + 2000);
    bust("Олег", "Саша", T0 + 3000);
    bust("Ира", "Саша", T0 + 4000);
    player({ type: "finish" }, T0 + 5000);
  }

  it("сыгранный турнир есть в истории с победителем; новый пустой — нет", () => {
    playToEnd();
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[1].id }, T0 + 9000, (x) =>
          d.presets.find((p) => p.id === x),
        );
      },
      (sqlite) => void archiveCurrentIfUsed(sqlite, T0 + 9000),
    );
    const list = listHistory(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Пятница", status: "finished", players: 4, winner: "Саша", isCurrent: false, deal: false });
  });

  it("итоги турнира: места по порядку, входы, аддоны, нокауты", () => {
    playToEnd();
    const d = getTournamentDetails(db, tid())!;
    expect(d.results.map((r) => [r.name, r.place, r.ko])).toEqual([
      ["Саша", 1, 3],
      ["Ира", 2, 0],
      ["Олег", 3, 0],
      ["Женя", 4, 0],
    ]);
  });

  it("турнир, который вели вручную, — со счётчиками, без игроков", () => {
    write((d) => {
      d.tournament.mode = "manual";
    });
    // новый турнир вручную
    write(
      (d) => {
        d.tournament = applyAction(d.tournament, { type: "loadPreset", presetId: d.presets[1].id }, T0 + 9000, (x) =>
          d.presets.find((p) => p.id === x),
        );
      },
      (sqlite) => void archiveCurrentIfUsed(sqlite, T0 + 9000),
    );
    clock({ type: "update", patch: { entries: 12, playersLeft: 10, rebuys: 3 } }, T0 + 9500);
    clock({ type: "start" }, T0 + 10_000);
    const manual = listHistory(db).find((h) => h.isCurrent)!;
    expect(manual).toMatchObject({ mode: "manual", players: 12 });
    expect(getTournamentDetails(db, manual.id)).toMatchObject({ results: [], counters: { entries: 12, rebuys: 3 } });
  });
});

describe("исправление итогов", () => {
  beforeEach(() => {
    bust("Женя", "Саша", T0 + 2000);
    bust("Олег", "Ира", T0 + 3000);
    bust("Ира", "Саша", T0 + 4000);
    player({ type: "finish" }, T0 + 5000);
  });
  const rows = () =>
    getTournamentDetails(db, tid())!.results.map((r) => ({ participantId: r.participantId, name: r.name, place: r.place!, ko: r.ko, entries: r.entries }));
  const edit = (changes: Record<string, Partial<{ place: number; ko: number; entries: number }>>) =>
    rows().map((r) => ({ ...r, ...(changes[r.name] ?? {}) }));

  it("поменять места и нокауты; одинаковые места — делёж «3–4»; запись в журнал", () => {
    const n = correctResults(db, tid(), edit({ Олег: { place: 3, ko: 0.5 }, Женя: { place: 3 }, Ира: { ko: 0.5 } }), T0 + 9000);
    expect(n).toBe(3);
    const d = getTournamentDetails(db, tid())!;
    expect(d.results.map((r) => [r.name, r.place, r.placeTo, r.ko])).toEqual([
      ["Саша", 1, null, 2],
      ["Ира", 2, null, 0.5],
      ["Женя", 3, 4, 0],
      ["Олег", 3, 4, 0.5],
    ]);
    const log = db.prepare("SELECT details_json FROM audit_log WHERE action = 'tournament.correct'").all() as { details_json: string }[];
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0].details_json).changes).toHaveLength(3);
  });

  it("сохранить без изменений — журнал не засоряется", () => {
    expect(correctResults(db, tid(), rows())).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tournament.correct'").get()).toEqual({ n: 0 });
  });

  it("ошибки: пропуск мест, места вне поля, лишние нокауты, не все участники", () => {
    expect(() => correctResults(db, tid(), edit({ Ира: { place: 3 } }))).toThrow("После 1 места должно идти 2-е");
    expect(() => correctResults(db, tid(), edit({ Женя: { place: 9 } }))).toThrow("от 1 до 4");
    expect(() => correctResults(db, tid(), edit({ Саша: { ko: 0.3 } }))).toThrow("с половинкой");
    expect(() => correctResults(db, tid(), edit({ Саша: { ko: 5 } }))).toThrow("больше, чем вылетов");
    expect(() => correctResults(db, tid(), rows().slice(1))).toThrow("всех участников");
  });

  it("исправлять можно только завершённый турнир", () => {
    db.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").run(tid());
    expect(() => correctResults(db, tid(), rows())).toThrow("только итоги завершённого");
  });
});

describe("проверка мест", () => {
  it("правильные варианты, в том числе делёж мест", () => {
    expect(() => validatePlaces([1, 2, 3, 4])).not.toThrow();
    expect(() => validatePlaces([3, 1, 3, 2])).not.toThrow(); // 1, 2, 3–4
    expect(() => validatePlaces([1, 1, 3])).not.toThrow(); // 1–2, 3
    expect(() => validatePlaces([2, 2, 2, 1])).not.toThrow(); // 1, 2–4
  });

  it("неправильные варианты", () => {
    expect(() => validatePlaces([2, 2])).toThrow("Нет 1 места");
    expect(() => validatePlaces([1, 1, 2])).toThrow("После 1 места должно идти 3-е, а не 2-е");
    expect(() => validatePlaces([1, 2, 2, 3])).toThrow("должно идти 4-е");
    expect(() => validatePlaces([1, 0])).toThrow("от 1 до 2");
    expect(() => validatePlaces([1, 1.5])).toThrow("от 1 до 2");
  });
});

describe("очки рейтинга", () => {
  const points = () => Object.fromEntries(getTournamentDetails(db, tid())!.results.map((r) => [r.name, r.points]));

  it("при завершении: по формуле RATING.md, поле — 4 игрока (коэф. 0,45)", () => {
    // 4 игрока → √(4/20) = 0,447 → 0,45
    bust("Женя", "Саша", T0 + 2000); // 4 место
    bust("Олег", "Ира", T0 + 3000); // 3 место
    bust("Ира", "Саша", T0 + 4000); // 2 место, 1 KO
    player({ type: "finish" }, T0 + 5000);
    expect(points()).toEqual({
      Саша: 55, // 100 × 0,45 + 2 × 5 = 55
      Ира: 39, // 75 × 0,45 + 5 = 38,75 → 39
      Олег: 27, // 60 × 0,45 = 27
      Женя: 23, // 50 × 0,45 = 22,5 → 23
    });
    expect(getTournamentDetails(db, tid())!.rulesId).toBe(1);
    expect(byName("Саша").points).toBe(55);
  });

  it("re-entry — минус 5, но не меньше минимума", () => {
    write((d) => {
      d.tournament.structure!.rebuyUntilLevel = 8;
    });
    bust("Женя", "Саша", T0 + 2000);
    player({ type: "reentry", participantId: byName("Женя").id }, T0 + 2500);
    bust("Женя", "Саша", T0 + 3000); // снова 4 место, 2 входа
    bust("Олег", "Ира", T0 + 4000);
    bust("Ира", "Саша", T0 + 5000);
    player({ type: "finish" }, T0 + 6000);
    expect(points().Женя).toBe(18); // 22,5 − 5 = 17,5 → 18
  });

  it("равные стеки — среднее за делимые места", () => {
    bust("Женя", "Саша", T0 + 2000);
    player(
      { type: "bust", busted: [{ participantId: byName("Олег").id, handOrder: 1 }, { participantId: byName("Ира").id, handOrder: 1 }], knockers: [byName("Саша").id] },
      T0 + 3000,
    );
    player({ type: "finish" }, T0 + 4000);
    // места 2–3: (75 + 60) / 2 × 0,45 = 30,375 → 30
    expect([points().Олег, points().Ира]).toEqual([30, 30]);
  });

  it("исправление итогов пересчитывает очки по той же версии правил, даже если правила уже поменяли", () => {
    bust("Женя", "Саша", T0 + 2000);
    bust("Олег", "Ира", T0 + 3000);
    bust("Ира", "Саша", T0 + 4000);
    player({ type: "finish" }, T0 + 5000);
    saveRules(db, { ...DEFAULT_RULES, koPoints: 100 });
    const rows = getTournamentDetails(db, tid())!.results.map((r) => ({ ...r, ko: r.name === "Олег" ? 1 : r.ko }));
    correctResults(db, tid(), rows.map((r) => (r.name === "Ира" ? { ...r, ko: 0 } : r)));
    expect(points().Олег).toBe(32); // 27 + 5 (а не +100 по новым правилам)
    expect(getTournamentDetails(db, tid())!.rulesId).toBe(1);
  });

  it("«Пересчитать» — все сыгранные турниры по текущим правилам", () => {
    bust("Женя", "Саша", T0 + 2000);
    bust("Олег", "Ира", T0 + 3000);
    bust("Ира", "Саша", T0 + 4000);
    player({ type: "finish" }, T0 + 5000);
    expect(outdatedCount(db)).toEqual({ currentId: 1, outdated: 0 });
    saveRules(db, { ...DEFAULT_RULES, koPoints: 10 });
    expect(outdatedCount(db)).toEqual({ currentId: 2, outdated: 1 });
    expect(points().Саша).toBe(55); // пока по старым
    expect(rescoreAll(db)).toBe(1);
    expect(points().Саша).toBe(65); // 45 + 2 × 10
    expect(outdatedCount(db).outdated).toBe(0);
  });

  it("идущий турнир и турнир «вручную» не пересчитываются", () => {
    bust("Женя", "Саша", T0 + 2000);
    expect(rescoreAll(db)).toBe(0);
    expect(points().Женя).toBeNull();
  });
});
