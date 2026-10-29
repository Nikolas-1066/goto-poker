// Очки игрока за турнир — строго по docs/RATING.md, раздел 1.
//   очки = окр( баллы_за_место × коэф_поля × коэф_статуса + 5 × нокауты − 5 × повторные_входы ), минимум 1
// Все числа — настройки (RatingRules), по умолчанию — как в RATING.md.
// Чистые функции: общие для сервера и браузера (пример расчёта в админке, экран табло).

export type TournamentKind = "regular" | "month_final" | "season_final" | "year_final";

export type RatingRules = {
  /** Баллы за места 1, 2, 3, … (по умолчанию 9 мест) */
  placePoints: number[];
  /** Места после таблицы и до ⌈N/2⌉ включительно («верхняя половина поля») */
  upperHalfPoints: number;
  /** Остальные места («нижняя половина поля») */
  lowerHalfPoints: number;
  /** Коэффициент поля = √(N / fieldBase), до 0,01 */
  fieldBase: number;
  /** За каждый нокаут (доля 0,5 — половина) */
  koPoints: number;
  /** Штраф за каждый вход сверх первого */
  reentryPenalty: number;
  /** Минимум за участие */
  minPoints: number;
  /** Коэффициент статуса турнира */
  statusCoef: Record<TournamentKind, number>;
  /** ELO (docs/RATING.md, раздел 4) */
  elo: { start: number; k: number; newbieK: number; newbieGames: number };
};

export const DEFAULT_RULES: RatingRules = {
  placePoints: [100, 75, 60, 50, 40, 32, 25, 20, 15],
  upperHalfPoints: 5,
  lowerHalfPoints: 2,
  fieldBase: 20,
  koPoints: 5,
  reentryPenalty: 5,
  minPoints: 1,
  statusCoef: { regular: 1, month_final: 1.5, season_final: 1.5, year_final: 2 },
  elo: { start: 1000, k: 32, newbieK: 48, newbieGames: 5 },
};

export const KIND_LABEL: Record<TournamentKind, string> = {
  regular: "Обычный",
  month_final: "Финал месяца",
  season_final: "Финал сезона",
  year_final: "Финал года",
};

/** Округление «0,5 и больше — вверх» без ошибок дробей (82,49999… считается как 82,5) */
export function roundHalfUp(x: number) {
  const clean = Math.round(x * 1e6) / 1e6;
  return Math.sign(clean) * Math.floor(Math.abs(clean) + 0.5);
}

/** Коэффициент поля √(N / база), округлённый до 0,01. N — число разных игроков, а не входов. */
export function fieldCoef(n: number, rules: RatingRules = DEFAULT_RULES) {
  if (n <= 0) return 0;
  return Math.round(Math.sqrt(n / rules.fieldBase) * 100) / 100;
}

/** Баллы за одно место при поле N (до коэффициентов) */
export function placeBasePoints(place: number, n: number, rules: RatingRules = DEFAULT_RULES) {
  if (place >= 1 && place <= rules.placePoints.length) return rules.placePoints[place - 1];
  return place <= Math.ceil(n / 2) ? rules.upperHalfPoints : rules.lowerHalfPoints;
}

/** Баллы за место с учётом дележа «7–8»: среднее баллов за эти места */
export function sharedPlacePoints(place: number, placeTo: number | null, n: number, rules: RatingRules = DEFAULT_RULES) {
  const to = placeTo ?? place;
  let sum = 0;
  for (let p = place; p <= to; p++) sum += placeBasePoints(p, n, rules);
  return sum / (to - place + 1);
}

export type PointsInput = {
  place: number;
  placeTo?: number | null;
  /** Нокауты, с долями 0,5 */
  ko: number;
  /** Входов всего (первый + re-entry) */
  entries: number;
  /** Поле N — разных игроков */
  fieldSize: number;
  kind?: TournamentKind;
};

/** Подробный расчёт — чтобы показать админу, откуда взялись очки */
export function pointsBreakdown(input: PointsInput, rules: RatingRules = DEFAULT_RULES) {
  const base = sharedPlacePoints(input.place, input.placeTo ?? null, input.fieldSize, rules);
  const coef = fieldCoef(input.fieldSize, rules);
  const status = rules.statusCoef[input.kind ?? "regular"] ?? 1;
  const reentries = Math.max(0, input.entries - 1);
  const raw = base * coef * status + input.ko * rules.koPoints - reentries * rules.reentryPenalty;
  const total = Math.max(rules.minPoints, roundHalfUp(raw));
  return { base, coef, status, ko: input.ko, reentries, raw, total };
}

export function tournamentPoints(input: PointsInput, rules: RatingRules = DEFAULT_RULES) {
  return pointsBreakdown(input, rules).total;
}

/**
 * «Сколько очков даст каждое место сейчас» (экран табло): без нокаутов и re-entry.
 * Отдельно — места из таблицы, затем диапазоны «верхняя половина» и «нижняя половина».
 */
export function placesPreview(n: number, kind: TournamentKind = "regular", rules: RatingRules = DEFAULT_RULES) {
  const rows: { from: number; to: number; points: number }[] = [];
  for (let p = 1; p <= n; p++) {
    const points = tournamentPoints({ place: p, ko: 0, entries: 1, fieldSize: n, kind }, rules);
    const last = rows.at(-1);
    // одинаковые очки за соседние места после таблицы — одной строкой «10–12»
    if (last && last.points === points && p > rules.placePoints.length) last.to = p;
    else rows.push({ from: p, to: p, points });
  }
  return rows;
}

// ---------- Проверка правил из админки ----------

const num = (v: unknown, name: string, { min = 0, max = 100_000, int = false } = {}) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name}: число от ${min} до ${max}`);
  if (int && !Number.isInteger(n)) throw new Error(`${name}: целое число`);
  return n;
};

/** Привести присланные правила к корректному виду. Бросает Error с понятным текстом. */
export function sanitizeRules(input: unknown): RatingRules {
  const r = (input ?? {}) as Record<string, unknown>;
  const pp = Array.isArray(r.placePoints) ? r.placePoints : [];
  if (pp.length < 1 || pp.length > 30) throw new Error("Таблица мест: от 1 до 30 мест");
  const placePoints = pp.map((v, i) => num(v, `Баллы за ${i + 1} место`, { max: 10_000 }));
  for (let i = 1; i < placePoints.length; i++) {
    if (placePoints[i] > placePoints[i - 1]) throw new Error(`Баллы за ${i + 1} место больше, чем за ${i}`);
  }
  const sc = (r.statusCoef ?? {}) as Record<string, unknown>;
  const elo = (r.elo ?? {}) as Record<string, unknown>;
  return {
    placePoints,
    upperHalfPoints: num(r.upperHalfPoints, "Верхняя половина", { max: 10_000 }),
    lowerHalfPoints: num(r.lowerHalfPoints, "Нижняя половина", { max: 10_000 }),
    fieldBase: num(r.fieldBase, "База коэффициента поля", { min: 1, max: 1000 }),
    koPoints: num(r.koPoints, "Очки за нокаут", { max: 1000 }),
    reentryPenalty: num(r.reentryPenalty, "Штраф за re-entry", { max: 1000 }),
    minPoints: num(r.minPoints, "Минимум за участие", { max: 1000 }),
    statusCoef: {
      regular: num(sc.regular, "Коэффициент обычного турнира", { min: 0.1, max: 10 }),
      month_final: num(sc.month_final, "Коэффициент финала месяца", { min: 0.1, max: 10 }),
      season_final: num(sc.season_final, "Коэффициент финала сезона", { min: 0.1, max: 10 }),
      year_final: num(sc.year_final, "Коэффициент финала года", { min: 0.1, max: 10 }),
    },
    elo: {
      start: num(elo.start, "Стартовый ELO", { min: 0, max: 10_000, int: true }),
      k: num(elo.k, "K для ELO", { min: 1, max: 200 }),
      newbieK: num(elo.newbieK, "K для новичков", { min: 1, max: 200 }),
      newbieGames: num(elo.newbieGames, "Турниров «новичка»", { min: 0, max: 100, int: true }),
    },
  };
}
