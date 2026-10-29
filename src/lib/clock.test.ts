import { describe, expect, it } from "vitest";
import { applyAction, boardView, emptyTournament, formatClock, resolveClock, structureDurationMs } from "./clock";
import type { Preset, Tournament, TournamentAction } from "./types";

const MIN = 60_000;
const T0 = 1_800_000_000_000; // условное «сейчас»

// Уровень 1 (10 мин) · Уровень 2 (10) · перерыв (5) · Уровень 3 (10) · Уровень 4 (10)
const preset: Preset = {
  id: "p1",
  name: "Тестовый",
  startingStack: 30000,
  rebuyStack: 30000,
  addonStack: 40000,
  doubleAddonStack: 80000,
  rebuyUntilLevel: 2,
  addonUntilLevel: 3,
  steps: [
    { id: "l1", kind: "level", sb: 100, bb: 200, ante: 0, minutes: 10 },
    { id: "l2", kind: "level", sb: 200, bb: 400, ante: 400, minutes: 10 },
    { id: "b1", kind: "break", minutes: 5, note: "Укрупнение" },
    { id: "l3", kind: "level", sb: 300, bb: 600, ante: 600, minutes: 10 },
    { id: "l4", kind: "level", sb: 400, bb: 800, ante: 800, minutes: 10 },
  ],
  updatedAt: 0,
};

const find = (id: string) => (id === preset.id ? preset : undefined);
const act = (t: Tournament, action: TournamentAction, now: number) => applyAction(t, action, now, find);
const loaded = () => act(emptyTournament(), { type: "loadPreset", presetId: "p1" }, T0);
const started = () => act(loaded(), { type: "start" }, T0);

describe("загрузка пресета", () => {
  it("копирует структуру и ставит таймер на первый уровень", () => {
    const t = loaded();
    expect(t.status).toBe("idle");
    expect(t.name).toBe("Тестовый");
    expect(t.presetId).toBe("p1");
    expect(t.structure?.steps).toHaveLength(5);
    expect(t.remainingMs).toBe(10 * MIN);
    expect(t.structure).not.toBe(preset); // копия, а не ссылка
  });

  it("сохраняет своё название турнира, комбинацию и бегущую строку", () => {
    const before = { ...emptyTournament(), name: "Пятница", combination: "J3", ticker: "Привет", tickerOn: true };
    const t = act(before, { type: "loadPreset", presetId: "p1" }, T0);
    expect(t.name).toBe("Пятница");
    expect(t.combination).toBe("J3");
    expect(t.ticker).toBe("Привет");
    expect(t.tickerOn).toBe(true);
  });

  it("сбрасывает счётчики прошлого турнира", () => {
    const before = { ...emptyTournament(), entries: 20, playersLeft: 5, rebuys: 3 };
    const t = act(before, { type: "loadPreset", presetId: "p1" }, T0);
    expect([t.entries, t.playersLeft, t.rebuys]).toEqual([0, 0, 0]);
  });

  it("ошибка, если пресета нет", () => {
    expect(() => act(emptyTournament(), { type: "loadPreset", presetId: "нет" }, T0)).toThrow("Пресет не найден");
  });

  it("правка пресета после загрузки не меняет идущий турнир", () => {
    const own = structuredClone(preset);
    const t = applyAction(emptyTournament(), { type: "loadPreset", presetId: "p1" }, T0, () => own);
    own.steps[0].minutes = 99;
    expect(t.structure?.steps[0].minutes).toBe(10);
  });
});

describe("старт, пауза, продолжение", () => {
  it("без структуры старт невозможен", () => {
    expect(() => act(emptyTournament(), { type: "start" }, T0)).toThrow("Сначала загрузите структуру");
  });

  it("после старта время идёт", () => {
    const t = started();
    expect(t.status).toBe("running");
    const v = resolveClock(t, T0 + 3 * MIN);
    expect(v.index).toBe(0);
    expect(v.remainingMs).toBe(7 * MIN);
    expect(v.elapsedMs).toBe(3 * MIN);
  });

  it("пауза замораживает время, продолжение не теряет ни секунды", () => {
    const paused = act(started(), { type: "pause" }, T0 + 4 * MIN);
    expect(paused.status).toBe("paused");
    expect(paused.remainingMs).toBe(6 * MIN);
    // на паузе время не идёт
    expect(resolveClock(paused, T0 + 30 * MIN).remainingMs).toBe(6 * MIN);
    expect(resolveClock(paused, T0 + 30 * MIN).elapsedMs).toBe(4 * MIN);

    const resumed = act(paused, { type: "resume" }, T0 + 30 * MIN);
    const v = resolveClock(resumed, T0 + 31 * MIN);
    expect(v.remainingMs).toBe(5 * MIN);
    expect(v.elapsedMs).toBe(5 * MIN);
  });

  it("повторный старт во время игры ничего не меняет", () => {
    const t = started();
    expect(act(t, { type: "start" }, T0 + MIN).stepEndsAt).toBe(t.stepEndsAt);
  });

  it("пауза на паузе ничего не меняет", () => {
    const paused = act(started(), { type: "pause" }, T0 + MIN);
    expect(act(paused, { type: "pause" }, T0 + 2 * MIN)).toEqual(paused);
  });
});

describe("переходы уровней сами по себе", () => {
  it("проходит несколько уровней, даже если сервер долго не спрашивали", () => {
    const t = started();
    // 10 + 10 + 5 = 25 мин → идёт уровень 3, прошло 2 мин
    const v = resolveClock(t, T0 + 27 * MIN);
    expect(v.index).toBe(3);
    expect(v.remainingMs).toBe(8 * MIN);
    expect(v.overtime).toBe(false);
  });

  it("на границе уровня переходит на следующий", () => {
    const v = resolveClock(started(), T0 + 10 * MIN);
    expect(v.index).toBe(1);
    expect(v.remainingMs).toBe(10 * MIN);
  });

  it("последний уровень доигран до нуля — «овертайм», индекс не уходит за конец", () => {
    const total = structureDurationMs(preset.steps);
    const v = resolveClock(started(), T0 + total + 5 * MIN);
    expect(v.index).toBe(4);
    expect(v.remainingMs).toBe(0);
    expect(v.overtime).toBe(true);
  });

  it("пауза после нескольких переходов запоминает правильный уровень", () => {
    const paused = act(started(), { type: "pause" }, T0 + 22 * MIN);
    expect(paused.stepIndex).toBe(2); // перерыв
    expect(paused.remainingMs).toBe(3 * MIN);
  });
});

describe("ручные переходы и время", () => {
  it("«след.» во время игры запускает следующий шаг с полного времени", () => {
    const t = act(started(), { type: "next" }, T0 + 3 * MIN);
    const v = resolveClock(t, T0 + 3 * MIN);
    expect(v.index).toBe(1);
    expect(v.remainingMs).toBe(10 * MIN);
  });

  it("«пред.» на первом уровне остаётся на первом", () => {
    const t = act(started(), { type: "prev" }, T0 + MIN);
    expect(t.stepIndex).toBe(0);
  });

  it("переход на номер шага за концом структуры ставит последний шаг", () => {
    const t = act(loaded(), { type: "goto", index: 99 }, T0);
    expect(t.stepIndex).toBe(4);
  });

  it("переход после завершения турнира ставит паузу", () => {
    const finished = act(started(), { type: "finish" }, T0 + MIN);
    expect(act(finished, { type: "next" }, T0 + 2 * MIN).status).toBe("paused");
  });

  it("«заново» перезапускает текущий шаг", () => {
    const t = act(started(), { type: "restartStep" }, T0 + 7 * MIN);
    expect(resolveClock(t, T0 + 7 * MIN).remainingMs).toBe(10 * MIN);
  });

  it("+1 минута во время игры", () => {
    const t = act(started(), { type: "adjustTime", deltaMs: MIN }, T0 + 2 * MIN);
    expect(resolveClock(t, T0 + 2 * MIN).remainingMs).toBe(9 * MIN);
  });

  it("убавить время во время игры можно не меньше чем до 1 секунды", () => {
    const t = act(started(), { type: "adjustTime", deltaMs: -60 * MIN }, T0 + 2 * MIN);
    expect(resolveClock(t, T0 + 2 * MIN).remainingMs).toBe(1000);
  });

  it("на паузе убавить время можно до нуля, но не меньше", () => {
    const paused = act(started(), { type: "pause" }, T0 + MIN);
    expect(act(paused, { type: "adjustTime", deltaMs: -60 * MIN }, T0 + MIN).remainingMs).toBe(0);
  });

  it("установить время вручную", () => {
    const running = act(started(), { type: "setTime", remainingMs: 90_000 }, T0 + MIN);
    expect(resolveClock(running, T0 + MIN).remainingMs).toBe(90_000);
    const paused = act(act(started(), { type: "pause" }, T0), { type: "setTime", remainingMs: 90_000 }, T0);
    expect(paused.remainingMs).toBe(90_000);
  });
});

describe("сброс и завершение", () => {
  it("сброс возвращает к началу и обнуляет счётчики, структура остаётся", () => {
    let t = started();
    t = act(t, { type: "update", patch: { entries: 10, playersLeft: 8, rebuys: 2, addons: 3, doubleAddons: 1 } }, T0);
    t = act(t, { type: "reset" }, T0 + 15 * MIN);
    expect(t.status).toBe("idle");
    expect(t.stepIndex).toBe(0);
    expect(t.remainingMs).toBe(10 * MIN);
    expect(t.elapsedBaseMs).toBe(0);
    expect([t.entries, t.playersLeft, t.rebuys, t.addons, t.doubleAddons]).toEqual([0, 0, 0, 0, 0]);
    expect(t.structure?.steps).toHaveLength(5);
  });

  it("завершение фиксирует время игры и останавливает часы", () => {
    const t = act(started(), { type: "finish" }, T0 + 12 * MIN);
    expect(t.status).toBe("finished");
    expect(t.stepIndex).toBe(1);
    expect(t.elapsedBaseMs).toBe(12 * MIN);
    expect(resolveClock(t, T0 + 60 * MIN).elapsedMs).toBe(12 * MIN);
  });
});

describe("изменение счётчиков и подписей", () => {
  it("отрицательные и дробные числа исправляются", () => {
    const t = act(loaded(), { type: "update", patch: { entries: -3, playersLeft: 7.6 } }, T0);
    expect(t.entries).toBe(0);
    expect(t.playersLeft).toBe(8);
  });

  it("слишком длинный текст обрезается", () => {
    const t = act(loaded(), { type: "update", patch: { name: "Я".repeat(200), combination: "К".repeat(100) } }, T0);
    expect(t.name).toHaveLength(80);
    expect(t.combination).toHaveLength(40);
  });

  it("каждое действие обновляет время изменения (по нему табло понимает, что данные новые)", () => {
    const t = act(loaded(), { type: "update", patch: { ticker: "Привет" } }, T0 + 5000);
    expect(t.updatedAt).toBe(T0 + 5000);
  });

  it("неизвестное действие — ошибка", () => {
    expect(() => act(loaded(), { type: "что-то" } as unknown as TournamentAction, T0)).toThrow("Неизвестное действие");
  });
});

describe("что показывает табло", () => {
  it("на уровне 1: блайнды, следующие блайнды, время до перерыва", () => {
    const v = boardView(started(), T0 + 2 * MIN);
    expect(v.levelNumber).toBe(1);
    expect(v.activeLevel?.bb).toBe(200);
    expect(v.nextLevel?.bb).toBe(400);
    expect(v.nextLevelNumber).toBe(2);
    expect(v.msToBreak).toBe(18 * MIN); // 8 мин уровня 1 + 10 мин уровня 2
  });

  it("в перерыве: блайнды и номер следующего уровня, «до перерыва» не показывается", () => {
    const v = boardView(started(), T0 + 21 * MIN);
    expect(v.step?.kind).toBe("break");
    expect(v.levelNumber).toBe(3);
    expect(v.activeLevel?.bb).toBe(600);
    expect(v.nextLevel?.bb).toBe(800);
    expect(v.msToBreak).toBeNull();
  });

  it("после последнего перерыва «до перерыва» не показывается", () => {
    expect(boardView(started(), T0 + 26 * MIN).msToBreak).toBeNull();
  });

  it("ребаи открыты до конца уровня 2 и в перерыве после него, закрыты на уровне 3", () => {
    const t = started();
    expect(boardView(t, T0 + 15 * MIN).rebuyOpen).toBe(true); // уровень 2
    expect(boardView(t, T0 + 21 * MIN).rebuyOpen).toBe(true); // перерыв после уровня 2
    expect(boardView(t, T0 + 26 * MIN).rebuyOpen).toBe(false); // уровень 3
    expect(boardView(t, T0 + 26 * MIN).addonOpen).toBe(true); // аддоны до уровня 3
    expect(boardView(t, T0 + 36 * MIN).addonOpen).toBe(false); // уровень 4
  });

  it("после завершения турнира ребаи и аддоны закрыты", () => {
    const t = act(started(), { type: "finish" }, T0 + MIN);
    expect(boardView(t, T0 + MIN).rebuyOpen).toBe(false);
    expect(boardView(t, T0 + MIN).addonOpen).toBe(false);
  });

  it("фишки в игре и средний стек считаются с двойными аддонами", () => {
    const t = act(started(), { type: "update", patch: { entries: 10, rebuys: 2, addons: 3, doubleAddons: 1, playersLeft: 8 } }, T0);
    const v = boardView(t, T0);
    // 10×30000 + 2×30000 + 3×40000 + 1×80000
    expect(v.totalChips).toBe(560_000);
    expect(v.avgStack).toBe(70_000);
  });

  it("средний стек не показывается, если в игре никого", () => {
    expect(boardView(started(), T0).avgStack).toBeNull();
  });
});

describe("формат времени", () => {
  it("минуты и секунды, неполная секунда округляется вверх", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59_001)).toBe("01:00");
    expect(formatClock(10 * MIN)).toBe("10:00");
  });

  it("часы показываются, когда больше часа", () => {
    expect(formatClock(60 * MIN)).toBe("1:00:00");
    expect(formatClock(75 * MIN + 5000)).toBe("1:15:05");
  });
});
