// Рассадка за столами — чистые функции, общие для сервера и админки в браузере (без кода базы).
// Столов в клубе до 3, мест за столом до 10; сколько мест занимать за столом — настройка клуба.
// Автопосадка: первый стол, где есть место до лимита, случайное свободное место (стол 1 → 2 → 3).
// Подсказки после старта: «Закройте стол N» (все помещаются за меньшим числом столов)
// и «Пересадите» (разница между столами 2 человека и больше). Пересаживают только по кнопке.

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
 * Место для нового игрока: первый стол (1, 2, 3), где людей меньше лимита, и случайное
 * свободное место на нём (из 1…лимит). null — все столы заполнены.
 */
export function pickSeat(occupied: Seat[], seatsPerTable: number, random: () => number = Math.random): Seat | null {
  for (let table = 1; table <= MAX_TABLES; table++) {
    const here = occupied.filter((s) => s.tableNo === table);
    if (here.length >= seatsPerTable) continue;
    const taken = new Set(here.map((s) => s.seatNo));
    const free: number[] = [];
    for (let seat = 1; seat <= seatsPerTable; seat++) if (!taken.has(seat)) free.push(seat);
    if (!free.length) continue;
    return { tableNo: table, seatNo: free[Math.min(free.length - 1, Math.floor(random() * free.length))] };
  }
  return null;
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

export type SeatedPlayer = { id: number; name: string; tableNo: number; seatNo: number };
export type Move = { participantId: number; name: string; from: Seat; to: Seat };
export type SeatingHint = { kind: "close"; tableNo: number; moves: Move[] } | { kind: "balance"; moves: Move[] };

/**
 * Что пересадить, когда за столами стало неровно (смотреть после старта турнира):
 * 1) все помещаются за меньшим числом столов — закрыть самый пустой стол (при равенстве — с большим номером),
 *    его игроков — за другие столы, к самому пустому, на свободные места по порядку;
 * 2) иначе, если разница между столами 2 человека и больше, — пересаживать с самого полного стола
 *    (игрок с последнего места) за самый пустой, пока разница не станет меньше 2.
 * null — всё ровно.
 */
export function seatingHint(players: SeatedPlayer[], seatsPerTable: number): SeatingHint | null {
  const tables = new Map<number, SeatedPlayer[]>();
  for (const p of players) tables.set(p.tableNo, [...(tables.get(p.tableNo) ?? []), p]);
  if (tables.size < 2) return null;

  // занятые места по столам — меняются по мере пересадки
  const taken = new Map<number, Set<number>>([...tables].map(([t, list]) => [t, new Set(list.map((p) => p.seatNo))]));
  const count = (t: number) => taken.get(t)!.size;
  const freeSeat = (t: number) => {
    for (let s = 1; s <= seatsPerTable; s++) if (!taken.get(t)!.has(s)) return s;
    return null;
  };
  const move = (p: SeatedPlayer, to: number): Move | null => {
    const seat = freeSeat(to);
    if (seat == null) return null;
    taken.get(p.tableNo)!.delete(p.seatNo);
    taken.get(to)!.add(seat);
    return { participantId: p.id, name: p.name, from: { tableNo: p.tableNo, seatNo: p.seatNo }, to: { tableNo: to, seatNo: seat } };
  };
  const emptiest = (except: number) =>
    [...taken.keys()].filter((t) => t !== except && count(t) < seatsPerTable).sort((a, b) => count(a) - count(b) || a - b)[0];

  const need = Math.ceil(players.length / seatsPerTable);
  if (tables.size > need) {
    const close = [...tables.keys()].sort((a, b) => count(a) - count(b) || b - a)[0];
    const moves: Move[] = [];
    for (const p of [...tables.get(close)!].sort((a, b) => a.seatNo - b.seatNo)) {
      const to = emptiest(close);
      const m = to == null ? null : move(p, to);
      if (!m) return null;
      moves.push(m);
    }
    return { kind: "close", tableNo: close, moves };
  }

  const moves: Move[] = [];
  const at = new Map<number, SeatedPlayer[]>([...tables].map(([t, list]) => [t, [...list].sort((a, b) => a.seatNo - b.seatNo)]));
  for (let guard = 0; guard < players.length; guard++) {
    const order = [...taken.keys()].sort((a, b) => count(b) - count(a) || a - b);
    const full = order[0];
    const empty = order[order.length - 1];
    if (count(full) - count(empty) < 2) break;
    const p = at.get(full)!.sort((a, b) => a.seatNo - b.seatNo).pop()!;
    const m = move(p, empty);
    if (!m) break;
    at.get(empty)!.push({ ...p, tableNo: empty, seatNo: m.to.seatNo });
    moves.push(m);
  }
  return moves.length ? { kind: "balance", moves } : null;
}
