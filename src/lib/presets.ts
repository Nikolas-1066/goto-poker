// Пресеты по умолчанию, валидация и помощники для редактора структуры.

import type { BreakStep, LevelStep, Preset, Prices, Step } from "./types";

export const newId = () =>
  Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/** Ближайшее «красивое» значение блайнда: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k */
export function niceBlind(value: number) {
  if (value <= 0) return 0;
  const mantissas = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  let best = value;
  let bestDiff = Infinity;
  for (const m of mantissas) {
    const candidate = m * base;
    const diff = Math.abs(candidate - value);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return Math.round(best);
}

/** Предложить следующий уровень после `prev` (примерно ×1.4). */
export function suggestNextLevel(prev: LevelStep | undefined, minutes: number): LevelStep {
  if (!prev) return { id: newId(), kind: "level", sb: 100, bb: 200, ante: 200, minutes };
  let bb = niceBlind(prev.bb * 1.4);
  if (bb <= prev.bb) bb = niceBlind(prev.bb * 1.6);
  const anteIsBb = prev.ante === prev.bb;
  return {
    id: newId(),
    kind: "level",
    sb: Math.round(bb / 2),
    bb,
    ante: anteIsBb ? bb : prev.ante > 0 ? niceBlind((prev.ante / prev.bb) * bb) : 0,
    minutes,
  };
}

const BLINDS: [number, number][] = [
  [100, 200], [200, 400], [300, 600], [400, 800], [500, 1000], [600, 1200],
  [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000], [2500, 5000],
  [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000], [8000, 16000],
  [10000, 20000], [15000, 30000], [20000, 40000], [25000, 50000],
  [30000, 60000], [40000, 80000], [50000, 100000], [60000, 120000],
];

function buildSteps(opts: {
  minutes: number;
  breakEvery: number;
  breakMinutes: number;
  anteFrom: number;
  count: number;
  startAt?: number;
}): Step[] {
  const steps: Step[] = [];
  const blinds = BLINDS.slice(opts.startAt ?? 0, (opts.startAt ?? 0) + opts.count);
  blinds.forEach(([sb, bb], i) => {
    const levelNo = i + 1;
    steps.push({ id: newId(), kind: "level", sb, bb, ante: levelNo >= opts.anteFrom ? bb : 0, minutes: opts.minutes });
    if (levelNo % opts.breakEvery === 0 && i < blinds.length - 1) {
      steps.push({ id: newId(), kind: "break", minutes: opts.breakMinutes } satisfies BreakStep);
    }
  });
  return steps;
}

export function defaultPresets(): Preset[] {
  const now = Date.now();
  return [
    {
      id: newId(),
      name: "Стандарт",
      description: "Уровни по 20 минут, перерыв каждые 4 уровня",
      startingStack: 30000,
      rebuyStack: 30000,
      addonStack: 40000,
      doubleAddonStack: 80000,
      rebuyUntilLevel: 8,
      addonUntilLevel: 8,
      prices: { ...NO_PRICES },
      steps: buildSteps({ minutes: 20, breakEvery: 4, breakMinutes: 10, anteFrom: 3, count: 20 }),
      updatedAt: now,
    },
    {
      id: newId(),
      name: "Турбо",
      description: "Уровни по 12 минут, перерыв каждые 6 уровней",
      startingStack: 20000,
      rebuyStack: 20000,
      addonStack: 30000,
      doubleAddonStack: 60000,
      rebuyUntilLevel: 6,
      addonUntilLevel: 6,
      prices: { ...NO_PRICES },
      steps: buildSteps({ minutes: 12, breakEvery: 6, breakMinutes: 10, anteFrom: 2, count: 18 }),
      updatedAt: now,
    },
    {
      id: newId(),
      name: "Дипстек",
      description: "Уровни по 30 минут, перерыв каждые 4 уровня",
      startingStack: 50000,
      rebuyStack: 50000,
      addonStack: 50000,
      doubleAddonStack: 100000,
      rebuyUntilLevel: 8,
      addonUntilLevel: 8,
      prices: { ...NO_PRICES },
      steps: buildSteps({ minutes: 30, breakEvery: 4, breakMinutes: 15, anteFrom: 4, count: 22 }),
      updatedAt: now,
    },
  ];
}

const int = (v: unknown, max = 1_000_000_000) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0;
};

/** Привести присланный клиентом пресет к корректному виду. Бросает Error при ошибке. */
export function sanitizePreset(input: unknown, id: string): Preset {
  if (!input || typeof input !== "object") throw new Error("Некорректные данные пресета");
  const p = input as Record<string, unknown>;
  const name = String(p.name ?? "").trim().slice(0, 60);
  if (!name) throw new Error("Укажите название пресета");
  const rawSteps = Array.isArray(p.steps) ? p.steps : [];
  if (rawSteps.length > 200) throw new Error("Слишком много уровней");

  const steps: Step[] = rawSteps.map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const sid = typeof s.id === "string" && s.id ? s.id.slice(0, 32) : newId();
    const minutes = Math.min(600, Math.max(1, Math.round(Number(s.minutes) || 0)));
    if (s.kind === "break") {
      const note = String(s.note ?? "").trim().slice(0, 60);
      return { id: sid, kind: "break", minutes, ...(note ? { note } : {}) };
    }
    return { id: sid, kind: "level", sb: int(s.sb), bb: int(s.bb), ante: int(s.ante), minutes };
  });

  return {
    id,
    name,
    description: String(p.description ?? "").trim().slice(0, 200) || undefined,
    startingStack: int(p.startingStack),
    rebuyStack: int(p.rebuyStack),
    addonStack: int(p.addonStack),
    doubleAddonStack: int(p.doubleAddonStack),
    rebuyUntilLevel: int(p.rebuyUntilLevel, 200),
    addonUntilLevel: int(p.addonUntilLevel, 200),
    prices: sanitizePrices(p.prices),
    steps,
    updatedAt: Date.now(),
  };
}

export const NO_PRICES: Prices = { entry: 0, reentry: 0, addon: 0, doubleAddon: 0 };

/** Цены в рублях, целые от 0 до 1 000 000; неизвестное — 0 */
export function sanitizePrices(input: unknown): Prices {
  const p = (input ?? {}) as Record<string, unknown>;
  const rub = (v: unknown) => int(v, 1_000_000);
  return { entry: rub(p.entry), reentry: rub(p.reentry), addon: rub(p.addon), doubleAddon: rub(p.doubleAddon) };
}

/** Дополнить пресет из старой версии базы новыми полями. */
export function withPresetDefaults<T extends Partial<Preset>>(
  p: T,
): T & Pick<Preset, "doubleAddonStack" | "rebuyUntilLevel" | "addonUntilLevel" | "prices"> {
  return {
    ...p,
    prices: sanitizePrices(p.prices),
    doubleAddonStack: p.doubleAddonStack ?? (p.addonStack ?? 0) * 2,
    rebuyUntilLevel: p.rebuyUntilLevel ?? 0,
    addonUntilLevel: p.addonUntilLevel ?? 0,
  };
}
