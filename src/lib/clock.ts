// Чистая логика часов турнира. Используется и на сервере, и в браузере,
// поэтому табло и админка всегда показывают одно и то же время.

import type { LevelStep, Step, Tournament, TournamentAction } from "./types";

export const stepMs = (step: Step | undefined) =>
  step ? Math.max(0, Math.round(step.minutes * 60_000)) : 0;

export type ClockView = {
  index: number;
  remainingMs: number;
  elapsedMs: number;
  /** Структура закончилась: последний шаг доигран до нуля */
  overtime: boolean;
};

/** Где турнир находится в момент `now` (без мутаций). */
export function resolveClock(t: Tournament, now: number): ClockView {
  const steps = t.structure?.steps ?? [];
  const elapsedMs =
    t.elapsedBaseMs +
    (t.status === "running" && t.runStartedAt ? Math.max(0, now - t.runStartedAt) : 0);

  if (t.status !== "running" || t.stepEndsAt === null || steps.length === 0) {
    return { index: t.stepIndex, remainingMs: Math.max(0, t.remainingMs), elapsedMs, overtime: false };
  }

  let index = t.stepIndex;
  let endsAt = t.stepEndsAt;
  while (now >= endsAt && index < steps.length - 1) {
    index += 1;
    endsAt += stepMs(steps[index]);
  }
  const remainingMs = Math.max(0, endsAt - now);
  return { index, remainingMs, elapsedMs, overtime: remainingMs === 0 && index === steps.length - 1 };
}

/** Зафиксировать текущее положение часов в объекте турнира. */
export function normalize(t: Tournament, now: number): Tournament {
  if (t.status !== "running" || t.stepEndsAt === null) return t;
  const view = resolveClock(t, now);
  return { ...t, stepIndex: view.index, stepEndsAt: now + view.remainingMs };
}

function clampIndex(t: Tournament, index: number) {
  const len = t.structure?.steps.length ?? 0;
  return Math.min(Math.max(0, index), Math.max(0, len - 1));
}

/** Перейти на шаг: таймер шага начинается заново, статус сохраняется. */
function jump(t: Tournament, index: number, now: number): Tournament {
  const i = clampIndex(t, index);
  const dur = stepMs(t.structure?.steps[i]);
  if (t.status === "running") return { ...t, stepIndex: i, stepEndsAt: now + dur, remainingMs: dur };
  return { ...t, stepIndex: i, remainingMs: dur, status: t.status === "finished" ? "paused" : t.status };
}

export function emptyTournament(): Tournament {
  return {
    name: "Турнир",
    presetId: null,
    structure: null,
    mode: "manual",
    status: "idle",
    stepIndex: 0,
    stepEndsAt: null,
    remainingMs: 0,
    elapsedBaseMs: 0,
    runStartedAt: null,
    entries: 0,
    playersLeft: 0,
    rebuys: 0,
    addons: 0,
    doubleAddons: 0,
    combination: "",
    ticker: "",
    tickerOn: false,
    updatedAt: Date.now(),
  };
}

const nonNeg = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/**
 * Применить действие к турниру. `presets` нужен только для loadPreset.
 * Бросает Error с понятным текстом, если действие невозможно.
 */
export function applyAction(
  input: Tournament,
  action: TournamentAction,
  now: number,
  findPreset: (id: string) => import("./types").Preset | undefined,
): Tournament {
  const t = normalize(input, now);
  const hasSteps = (t.structure?.steps.length ?? 0) > 0;
  const needSteps = () => {
    if (!hasSteps) throw new Error("Сначала загрузите структуру турнира");
  };
  let next: Tournament;

  switch (action.type) {
    case "start": {
      needSteps();
      if (t.status === "running") return t;
      const remaining = t.status === "idle" ? stepMs(t.structure!.steps[t.stepIndex]) : t.remainingMs;
      next = { ...t, status: "running", stepEndsAt: now + remaining, runStartedAt: now };
      break;
    }
    case "resume": {
      needSteps();
      if (t.status === "running") return t;
      next = { ...t, status: "running", stepEndsAt: now + t.remainingMs, runStartedAt: now };
      break;
    }
    case "pause": {
      if (t.status !== "running") return t;
      const view = resolveClock(t, now);
      next = {
        ...t,
        status: "paused",
        stepIndex: view.index,
        remainingMs: view.remainingMs,
        stepEndsAt: null,
        elapsedBaseMs: view.elapsedMs,
        runStartedAt: null,
      };
      break;
    }
    case "next":
      needSteps();
      next = jump(t, t.stepIndex + 1, now);
      break;
    case "prev":
      needSteps();
      next = jump(t, t.stepIndex - 1, now);
      break;
    case "goto":
      needSteps();
      next = jump(t, action.index, now);
      break;
    case "restartStep":
      needSteps();
      next = jump(t, t.stepIndex, now);
      break;
    case "adjustTime": {
      needSteps();
      if (t.status === "running") {
        const ends = Math.max(now + 1000, (t.stepEndsAt ?? now) + action.deltaMs);
        next = { ...t, stepEndsAt: ends };
      } else {
        next = { ...t, remainingMs: Math.max(0, t.remainingMs + action.deltaMs) };
      }
      break;
    }
    case "setTime": {
      needSteps();
      const ms = Math.max(0, Math.round(action.remainingMs));
      next = t.status === "running" ? { ...t, stepEndsAt: now + Math.max(1000, ms) } : { ...t, remainingMs: ms };
      break;
    }
    case "loadPreset": {
      const p = findPreset(action.presetId);
      if (!p) throw new Error("Пресет не найден");
      if (p.steps.length === 0) throw new Error("В пресете нет уровней");
      const { updatedAt: _ignored, ...structure } = p;
      void _ignored;
      next = {
        ...emptyTournament(),
        name: t.name === "Турнир" || !t.name ? p.name : t.name,
        combination: t.combination,
        ticker: t.ticker,
        tickerOn: t.tickerOn,
        mode: t.mode,
        presetId: p.id,
        structure: structuredClone(structure),
        remainingMs: stepMs(p.steps[0]),
      };
      break;
    }
    case "reset": {
      if (!t.structure) return t;
      next = {
        ...t,
        status: "idle",
        stepIndex: 0,
        stepEndsAt: null,
        remainingMs: stepMs(t.structure.steps[0]),
        elapsedBaseMs: 0,
        runStartedAt: null,
        entries: 0,
        playersLeft: 0,
        rebuys: 0,
        addons: 0,
        doubleAddons: 0,
      };
      break;
    }
    case "finish": {
      const view = resolveClock(t, now);
      next = {
        ...t,
        status: "finished",
        stepIndex: view.index,
        remainingMs: view.remainingMs,
        stepEndsAt: null,
        elapsedBaseMs: view.elapsedMs,
        runStartedAt: null,
      };
      break;
    }
    case "update": {
      const p = action.patch;
      next = { ...t };
      if (typeof p.name === "string") next.name = p.name.slice(0, 80);
      if (typeof p.combination === "string") next.combination = p.combination.slice(0, 40);
      // В режиме «по игрокам» счётчики считает сервер по участникам — ручные правки не принимаем
      if (t.mode !== "players") {
        if (p.entries !== undefined) next.entries = nonNeg(p.entries);
        if (p.playersLeft !== undefined) next.playersLeft = nonNeg(p.playersLeft);
        if (p.rebuys !== undefined) next.rebuys = nonNeg(p.rebuys);
        if (p.addons !== undefined) next.addons = nonNeg(p.addons);
        if (p.doubleAddons !== undefined) next.doubleAddons = nonNeg(p.doubleAddons);
      }
      if (typeof p.ticker === "string") next.ticker = p.ticker.slice(0, 500);
      if (typeof p.tickerOn === "boolean") next.tickerOn = p.tickerOn;
      break;
    }
    default:
      throw new Error("Неизвестное действие");
  }

  return { ...next, updatedAt: now };
}

// ---------- Производные значения для табло ----------

export type BoardView = ClockView & {
  step: Step | undefined;
  /** Номер уровня (перерывы не считаются) */
  levelNumber: number;
  /** Текущий или ближайший предстоящий уровень (для блайндов во время перерыва) */
  activeLevel: LevelStep | undefined;
  nextLevel: LevelStep | undefined;
  nextLevelNumber: number;
  /** Время до начала ближайшего перерыва; null — перерывов больше нет или сейчас перерыв */
  msToBreak: number | null;
  avgStack: number | null;
  totalChips: number;
  /** Сыгранный/текущий уровень для правил ребаев (во время перерыва — уровень перед ним) */
  periodLevel: number;
  rebuyOpen: boolean;
  addonOpen: boolean;
};

export function boardView(t: Tournament, now: number): BoardView {
  const clock = resolveClock(t, now);
  const steps = t.structure?.steps ?? [];
  const step = steps[clock.index];

  const levelNo = (upTo: number) => steps.slice(0, upTo + 1).filter((s) => s.kind === "level").length;

  let activeLevel: LevelStep | undefined;
  let activeIdx = -1;
  for (let i = clock.index; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "level") {
      activeLevel = s;
      activeIdx = i;
      break;
    }
  }

  let nextLevel: LevelStep | undefined;
  let nextIdx = -1;
  for (let i = Math.max(clock.index, activeIdx) + 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "level") {
      nextLevel = s;
      nextIdx = i;
      break;
    }
  }

  let msToBreak: number | null = null;
  if (step && step.kind !== "break") {
    let acc = clock.remainingMs;
    for (let i = clock.index + 1; i < steps.length; i++) {
      if (steps[i].kind === "break") {
        msToBreak = acc;
        break;
      }
      acc += stepMs(steps[i]);
    }
  }

  const s = t.structure;
  const totalChips = s
    ? t.entries * s.startingStack +
      t.rebuys * s.rebuyStack +
      t.addons * s.addonStack +
      (t.doubleAddons ?? 0) * (s.doubleAddonStack ?? s.addonStack * 2)
    : 0;
  const periodLevel = Math.max(1, levelNo(clock.index));
  const finished = t.status === "finished";
  const rebuyOpen = !!s && !finished && (s.rebuyUntilLevel ?? 0) > 0 && periodLevel <= s.rebuyUntilLevel;
  const addonOpen = !!s && !finished && (s.addonUntilLevel ?? 0) > 0 && periodLevel <= s.addonUntilLevel;
  const avgStack = t.playersLeft > 0 && totalChips > 0 ? Math.round(totalChips / t.playersLeft) : null;

  return {
    ...clock,
    step,
    levelNumber: step?.kind === "level" ? levelNo(clock.index) : activeIdx >= 0 ? levelNo(activeIdx) : 0,
    activeLevel,
    nextLevel,
    nextLevelNumber: nextIdx >= 0 ? levelNo(nextIdx) : 0,
    msToBreak,
    avgStack,
    totalChips,
    periodLevel,
    rebuyOpen,
    addonOpen,
  };
}

export function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const formatChips = (n: number) => n.toLocaleString("ru-RU");

export function structureDurationMs(steps: Step[]) {
  return steps.reduce((acc, s) => acc + stepMs(s), 0);
}
