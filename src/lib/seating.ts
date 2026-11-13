// Рассадка за столами — чистые функции, общие для сервера и админки в браузере (без кода базы).
// Столов в клубе до 3, мест за столом до 10; сколько мест занимать за столом — настройка клуба.
// Автопосадка: сначала стол 1 до лимита; когда открыто несколько столов — за тот, где меньше людей;
// все открытые заполнены — открывается следующий стол. Место — случайное свободное.
// Подсказки: «Закройте стол N» (все помещаются за меньшим числом столов) и «Пересадите» (разница
// между столами 2 человека и больше) — только сколько игроков с какого стола за какой, кого — решает админ.

export const MAX_TABLES = 3;
export const MAX_SEATS = 10;

/** «стол 2/5», «стол 2» или пусто */
export function formatSeat(tableNo: number | null, seatNo: number | null) {
  if (tableNo == null) return "";
  return seatNo != null ? `стол ${tableNo}/${seatNo}` : `стол ${tableNo}`;
}

// ---------- Настройки рассадки ----------

export type SeatingSettings = {
  /** Сколько мест занимать за столом (2–10) */
  seatsPerTable: number;
  /** Сажать автоматически при «Пришёл» и re-entry */
  autoSeat: boolean;
};

export const DEFAULT_SEATING: SeatingSettings = { seatsPerTable: MAX_SEATS, autoSeat: true };

/** Привести настройки к корректному виду. Бросает Error с понятным текстом. */
export function sanitizeSeating(input: unknown, base: SeatingSettings = DEFAULT_SEATING): SeatingSettings {
  const p = (input ?? {}) as Partial<Record<keyof SeatingSettings, unknown>>;
  let seats = base.seatsPerTable;
  if (p.seatsPerTable !== undefined) {
    seats = Number(p.seatsPerTable);
    if (!Number.isInteger(seats) || seats < 2 || seats > MAX_SEATS) throw new Error(`Мест за столом — от 2 до ${MAX_SEATS}`);
  }
  return { seatsPerTable: seats, autoSeat: p.autoSeat === undefined ? base.autoSeat : !!p.autoSeat };
}

// ---------- Выбор места ----------

export type Seat = { tableNo: number; seatNo: number };

/**
 * Место для нового игрока. Открытые столы — где уже кто-то сидит. Из открытых, где есть место до лимита, —
 * тот, где меньше людей (при равенстве — с меньшим номером). Все открытые заполнены (или открытых нет) —
 * первый неоткрытый стол. Место — случайное свободное из 1…лимит. null — все столы заполнены.
 */
export function pickSeat(occupied: Seat[], seatsPerTable: number, random: () => number = Math.random): Seat | null {
  const count = (t: number) => occupied.filter((s) => s.tableNo === t).length;
  const tables = Array.from({ length: MAX_TABLES }, (_, i) => i + 1);
  const open = tables.filter((t) => count(t) > 0 && count(t) < seatsPerTable).sort((a, b) => count(a) - count(b) || a - b);
  const table = open[0] ?? tables.find((t) => count(t) === 0);
  if (table == null) return null;
  const taken = new Set(occupied.filter((s) => s.tableNo === table).map((s) => s.seatNo));
  const free: number[] = [];
  for (let seat = 1; seat <= seatsPerTable; seat++) if (!taken.has(seat)) free.push(seat);
  if (!free.length) return null;
  return { tableNo: table, seatNo: free[Math.min(free.length - 1, Math.floor(random() * free.length))] };
}

// ---------- Стек ----------

export type Stacks = { startingStack: number; rebuyStack: number; addonStack: number; doubleAddonStack: number };
export type ChipEvent = { type: "entry" | "reentry" | "addon" | "double_addon"; at: number };
export type PlayerStack = { value: number; counted: boolean; countedAt: number | null };

/**
 * Стек игрока в текущем заходе. Расчётный: фишки последнего входа (старт или re-entry) + аддоны после него.
 * Если стек посчитали (вписали) после последнего входа — посчитанное + аддоны, взятые после подсчёта.
 */
export function playerStack(stacks: Stacks, events: ChipEvent[], counted: { stack: number; at: number } | null): PlayerStack {
  const list = [...events].sort((a, b) => a.at - b.at);
  let lastIn = -1;
  list.forEach((e, i) => {
    if (e.type === "entry" || e.type === "reentry") lastIn = i;
  });
  if (lastIn < 0) return { value: 0, counted: false, countedAt: null };
  const entry = list[lastIn];
  const addon = (e: ChipEvent) => (e.type === "addon" ? stacks.addonStack : e.type === "double_addon" ? stacks.doubleAddonStack : 0);
  const after = list.slice(lastIn + 1);
  if (counted && counted.at >= entry.at) {
    const value = counted.stack + after.filter((e) => e.at > counted.at).reduce((s, e) => s + addon(e), 0);
    return { value, counted: true, countedAt: counted.at };
  }
  const base = entry.type === "entry" ? stacks.startingStack : stacks.rebuyStack;
  return { value: base + after.reduce((s, e) => s + addon(e), 0), counted: false, countedAt: null };
}

/** «45к», «1,2м», «900» — коротко для мест за столом */
export function shortChips(n: number) {
  if (n >= 1_000_000) return `${String(Math.round(n / 100_000) / 10).replace(".", ",")}м`;
  if (n >= 10_000) return `${Math.round(n / 1000)}к`;
  if (n >= 1000) return `${String(Math.round(n / 100) / 10).replace(".", ",")}к`;
  return String(n);
}

// ---------- Подсказки: закрыть стол / выровнять ----------

/** Пересадить count игроков со стола from за стол to (кого именно — решает админ) */
export type TableMove = { from: number; to: number; count: number };
export type SeatingHint = { kind: "close"; tableNo: number; moves: TableMove[] } | { kind: "balance"; moves: TableMove[] };

/**
 * Что пересадить, когда за столами стало неровно (по числу людей за столами):
 * 1) все помещаются за меньшим числом столов — закрыть самый пустой стол (при равенстве — с большим номером),
 *    людей раздать на оставшиеся поровну;
 * 2) иначе, если разница между столами 2 человека и больше, — выровнять (разница не больше 1).
 * Поровну: каждому столу n/k, лишние по одному — тем, где людей больше (меньше пересадок).
 * Сколько с какого стола за какой: со столов, где лишние (по номеру), за столы, где не хватает (по номеру).
 * null — всё ровно.
 */
export function seatingHint(seated: { tableNo: number }[], seatsPerTable: number): SeatingHint | null {
  const counts = new Map<number, number>();
  for (const p of seated) counts.set(p.tableNo, (counts.get(p.tableNo) ?? 0) + 1);
  if (counts.size < 2) return null;
  const n = seated.length;
  const need = Math.max(1, Math.ceil(n / seatsPerTable));

  let close: number | null = null;
  if (counts.size > need) {
    close = [...counts.keys()].sort((a, b) => counts.get(a)! - counts.get(b)! || b - a)[0];
  } else {
    const values = [...counts.values()];
    if (Math.max(...values) - Math.min(...values) < 2) return null;
  }

  const keep = [...counts.keys()].filter((t) => t !== close);
  const base = Math.floor(n / keep.length);
  let extra = n % keep.length;
  const target = new Map<number, number>();
  for (const t of [...keep].sort((a, b) => counts.get(b)! - counts.get(a)! || a - b)) target.set(t, base + (extra-- > 0 ? 1 : 0));
  if (close != null) target.set(close, 0);

  const order = [...counts.keys()].sort((a, b) => a - b);
  const give = order.filter((t) => counts.get(t)! > target.get(t)!).map((t) => ({ t, left: counts.get(t)! - target.get(t)! }));
  const take = order.filter((t) => counts.get(t)! < target.get(t)!).map((t) => ({ t, left: target.get(t)! - counts.get(t)! }));
  const moves: TableMove[] = [];
  for (const g of give) {
    for (const r of take) {
      const c = Math.min(g.left, r.left);
      if (c <= 0) continue;
      moves.push({ from: g.t, to: r.t, count: c });
      g.left -= c;
      r.left -= c;
    }
  }
  if (!moves.length) return null;
  return close != null ? { kind: "close", tableNo: close, moves } : { kind: "balance", moves };
}

/** «1 игрок», «3 игрока», «5 игроков» */
export function playersCount(n: number) {
  const d = n % 10, h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? "игрок" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "игрока" : "игроков"}`;
}

/** «со стола 1 за стол 2 — 4 игрока» */
export function moveText(m: TableMove) {
  return `со стола ${m.from} за стол ${m.to} — ${playersCount(m.count)}`;
}

/** Подсказка одной фразой — для сообщения после «Пришёл» */
export function hintText(h: SeatingHint) {
  const list = h.moves.map(moveText).join(", ");
  return h.kind === "close" ? `можно закрыть стол ${h.tableNo}: пересадите ${list}` : `пересадите ${list}`;
}
