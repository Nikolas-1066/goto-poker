import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlayer } from "./players";
import {
  changeFinalist,
  closePeriod,
  finalistsOf,
  getPeriod,
  nextPeriodName,
  openPeriod,
  reopenBlocker,
  reopenPeriod,
  setFinalistsN,
  standingsOf,
  startPeriod,
} from "./periods";
import { saveSettings } from "./settings";
import { openStore } from "./sqlite";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 20, 12).getTime(); // 20 ноября 2026
const NOV1 = new Date(2026, 10, 1).getTime();

let dir: string;
let db: DatabaseSync;
const ids: Record<string, number> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-periods-"));
  db = openStore(dir, NOV1 - 30 * DAY).db;
  for (const [i, name] of ["Саша", "Ира", "Олег", "Женя"].entries()) ids[name] = createPlayer(db, { name, phone: `+7900000000${i}` }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Записать завершённый турнир с готовыми итогами: [имя, место, очки, KO] */
function tournament(at: number, results: [string, number, number, number?][], kind = "regular") {
  const tid = Number(
    db
      .prepare("INSERT INTO tournaments (name, kind, status, created_at, started_at, finished_at, updated_at) VALUES ('Т', ?, 'finished', ?, ?, ?, ?)")
      .run(kind, at, at, at + 1000, at + 1000).lastInsertRowid,
  );
  const ins = db.prepare(
    "INSERT INTO participants (tournament_id, player_id, status, registered_at, place, entries, ko, points) VALUES (?, ?, 'busted', ?, ?, 1, ?, ?)",
  );
  for (const [name, place, points, ko] of results) ins.run(tid, ids[name], at, place, ko ?? 0, points);
  return tid;
}
const names = (list: { playerId: number }[]) => list.map((x) => Object.keys(ids).find((k) => ids[k] === x.playerId));

describe("первый период", () => {
  it("начинается с выбранной даты; турниры с этой даты сразу в месяце", () => {
    tournament(NOV1 - 5 * DAY, [["Женя", 1, 100]]); // до начала периода — не в месяце
    tournament(NOV1 + 2 * DAY, [["Саша", 1, 100], ["Ира", 2, 75]]);
    const p = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    expect(p).toMatchObject({ name: "Ноябрь", startedAt: NOV1, closedAt: null, finalistsN: 9 });
    expect(names(standingsOf(db, p))).toEqual(["Саша", "Ира"]);
    // «за всё время» — все турниры; у Жени и Саши всё поровну, но Женя набрал свои 100 раньше
    expect(names(standingsOf(db, "all"))).toEqual(["Женя", "Саша", "Ира"]);
  });

  it("нельзя: дата в будущем, второй открытый период, выключенный сезон", () => {
    expect(() => startPeriod(db, "month", { startAt: NOW + DAY }, NOW)).toThrow("не позже сегодняшнего");
    startPeriod(db, "month", { startAt: NOV1, name: "  Ноябрь-2 " }, NOW);
    expect(openPeriod(db, "month")!.name).toBe("Ноябрь-2");
    expect(() => startPeriod(db, "month", {}, NOW)).toThrow("период уже идёт");
    saveSettings(db, { seasonEnabled: false });
    expect(() => startPeriod(db, "season", {}, NOW)).toThrow("выключен");
  });
});

describe("какие турниры идут в какой рейтинг (RATING.md 7а, п. 3)", () => {
  it("финал месяца — не в месяц, но в сезон, год и «за всё время»; финал года — только «за всё время»", () => {
    const m = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    const s = startPeriod(db, "season", { startAt: NOV1 }, NOW);
    const y = startPeriod(db, "year", { startAt: NOV1 }, NOW);
    tournament(NOV1 + DAY, [["Саша", 1, 10]]);
    tournament(NOV1 + 2 * DAY, [["Ира", 1, 20]], "month_final");
    tournament(NOV1 + 3 * DAY, [["Олег", 1, 30]], "season_final");
    tournament(NOV1 + 4 * DAY, [["Женя", 1, 40]], "year_final");
    expect(names(standingsOf(db, m))).toEqual(["Саша"]);
    expect(names(standingsOf(db, s))).toEqual(["Ира", "Саша"]);
    expect(names(standingsOf(db, y))).toEqual(["Олег", "Ира", "Саша"]);
    expect(names(standingsOf(db, "all"))).toEqual(["Женя", "Олег", "Ира", "Саша"]);
  });
});

describe("закрытие периода", () => {
  let month: ReturnType<typeof startPeriod>;
  beforeEach(() => {
    month = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    tournament(NOV1 + DAY, [["Саша", 1, 100, 2], ["Ира", 2, 75], ["Олег", 3, 60], ["Женя", 4, 50]]);
    tournament(NOV1 + 5 * DAY, [["Ира", 1, 100], ["Женя", 2, 75]]);
  });

  it("таблица замораживается, сразу начинается новый период с выбранной даты", () => {
    const { closed, next } = closePeriod(db, month.id, { nextName: "Декабрь", nextStart: NOV1 + 10 * DAY }, NOW);
    expect(closed.closedAt).toBe(NOV1 + 10 * DAY);
    expect(next).toMatchObject({ name: "Декабрь", startedAt: NOV1 + 10 * DAY, closedAt: null });
    expect(names(standingsOf(db, closed))).toEqual(["Ира", "Женя", "Саша", "Олег"]);
    // турнир после закрытия — в новом периоде; замороженная таблица не меняется
    tournament(NOV1 + 12 * DAY, [["Олег", 1, 500]]);
    expect(names(standingsOf(db, closed))).toEqual(["Ира", "Женя", "Саша", "Олег"]);
    expect(names(standingsOf(db, openPeriod(db, "month")!))).toEqual(["Олег"]);
  });

  it("турниры между выбранной датой нового периода и нажатием кнопки — уже в новом периоде", () => {
    tournament(NOV1 + 15 * DAY, [["Олег", 1, 500]]);
    const { closed, next } = closePeriod(db, month.id, { nextStart: NOV1 + 14 * DAY }, NOW);
    expect(names(standingsOf(db, closed))).not.toContain(undefined);
    expect(standingsOf(db, closed).find((s) => s.playerId === ids["Олег"])!.points).toBe(60);
    expect(names(standingsOf(db, next))).toEqual(["Олег"]);
  });

  it("финалисты — топ-N; N можно поменять после закрытия; отказ — приглашается следующий; wildcard", () => {
    setFinalistsN(db, month.id, 2, NOW);
    const { closed } = closePeriod(db, month.id, {}, NOW);
    expect(names(finalistsOf(db, closed).finalists)).toEqual(["Ира", "Женя"]);
    setFinalistsN(db, closed.id, 3, NOW + 1);
    expect(names(finalistsOf(db, getPeriod(db, closed.id)!).finalists)).toEqual(["Ира", "Женя", "Саша"]);
    changeFinalist(db, closed.id, ids["Женя"], "remove", "уехал", NOW + 2);
    changeFinalist(db, closed.id, ids["Олег"], "add", "wildcard от клуба", NOW + 3);
    const f = finalistsOf(db, getPeriod(db, closed.id)!);
    expect(names(f.finalists)).toEqual(["Ира", "Саша", "Олег"]);
    expect(f.finalists.map((x) => x.source)).toEqual(["rating", "rating", "rating"]); // Олег 4-й — проходит по рейтингу вместо Жени
    const log = db.prepare("SELECT action FROM audit_log WHERE action LIKE 'period.%' ORDER BY id").all() as { action: string }[];
    expect(log.map((l) => l.action)).toEqual([
      "period.start",
      "period.finalists_n",
      "period.close",
      "period.finalists_n",
      "period.finalist_remove",
      "period.finalist_add",
    ]);
  });

  it("правки финалистов — только у закрытого периода", () => {
    expect(() => changeFinalist(db, month.id, ids["Саша"], "add", "", NOW)).toThrow("после закрытия");
  });

  it("закрыть дважды или с датой раньше начала — нельзя", () => {
    expect(() => closePeriod(db, month.id, { nextStart: NOV1 - DAY }, NOW)).toThrow("позже начала");
    closePeriod(db, month.id, {}, NOW);
    expect(() => closePeriod(db, month.id, {}, NOW)).toThrow("уже закрыт");
  });
});

describe("название следующего периода", () => {
  it("месяц закрывают после 15-го — по умолчанию следующий месяц, до 15-го — текущий", () => {
    const m = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    expect(closePeriod(db, m.id, {}, NOW).next.name).toBe("Декабрь"); // 20 ноября
    expect(nextPeriodName("month", new Date(2026, 11, 3).getTime())).toBe("Декабрь"); // 3 декабря
    expect(nextPeriodName("season", NOW)).toBe("Осень 2026");
  });
});

describe("отмена закрытия", () => {
  it("если нажали по ошибке и новых турниров не было — период снова открыт, новый удалён", () => {
    const m = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    tournament(NOV1 + DAY, [["Саша", 1, 100]]);
    const { closed } = closePeriod(db, m.id, {}, NOW);
    changeFinalist(db, closed.id, ids["Ира"], "add", "", NOW);
    expect(reopenBlocker(db, closed.id)).toBeNull();
    const back = reopenPeriod(db, closed.id, NOW + 1);
    expect(back.closedAt).toBeNull();
    expect(openPeriod(db, "month")!.id).toBe(m.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM periods").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM finalist_changes").get()).toEqual({ n: 0 });
    expect(names(standingsOf(db, back))).toEqual(["Саша"]);
  });

  it("в новом периоде уже играли — отменить нельзя", () => {
    const m = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    const { closed } = closePeriod(db, m.id, { nextStart: NOW - DAY }, NOW);
    tournament(NOW - 1000, [["Олег", 1, 10]]);
    expect(reopenBlocker(db, closed.id)).toBe("В новом периоде уже играли турниры");
    expect(() => reopenPeriod(db, closed.id, NOW)).toThrow("Отменить закрытие нельзя: в новом периоде уже играли турниры");
  });

  it("по периоду уже создан финал — отменить нельзя", () => {
    const m = startPeriod(db, "month", { startAt: NOV1 }, NOW);
    const { closed } = closePeriod(db, m.id, {}, NOW);
    db.prepare("INSERT INTO tournaments (name, kind, final_of_period_id, created_at, updated_at) VALUES ('Финал', 'month_final', ?, ?, ?)").run(
      closed.id,
      NOW,
      NOW,
    );
    expect(reopenBlocker(db, closed.id)).toBe("По этому периоду уже создан финал");
  });
});
