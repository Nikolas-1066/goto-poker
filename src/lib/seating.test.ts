import { describe, expect, it } from "vitest";
import { hintText, pickSeat, playerStack, playersCount, sanitizeSeating, seatingHint, shortChips } from "./seating";

const seats = (table: number, ...nos: number[]) => nos.map((seatNo) => ({ tableNo: table, seatNo }));

describe("автопосадка", () => {
  it("сначала заполняется стол 1 до лимита, потом стол 2", () => {
    expect(pickSeat([], 10, () => 0)).toEqual({ tableNo: 1, seatNo: 1 });
    expect(pickSeat(seats(1, 1, 2, 3, 4, 5, 6, 7, 8, 9), 9, () => 0)).toEqual({ tableNo: 2, seatNo: 1 });
    expect(pickSeat(seats(1, 1, 2, 3, 4, 5, 6, 7, 8, 9), 10, () => 0)).toEqual({ tableNo: 1, seatNo: 10 });
  });

  it("открыто несколько столов — за тот, где меньше людей; все открытые полные — следующий", () => {
    // стол 1: 10, стол 2: 6 → за стол 2
    expect(pickSeat([...seats(1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), ...seats(2, 1, 2, 3, 4, 5, 6)], 10, () => 0)).toEqual({ tableNo: 2, seatNo: 7 });
    // стол 1: 5, стол 2: 6 → за стол 1 (не «первый, где есть место», а где меньше)
    expect(pickSeat([...seats(1, 1, 2, 3, 4, 5), ...seats(2, 1, 2, 3, 4, 5, 6)], 10, () => 0)).toEqual({ tableNo: 1, seatNo: 6 });
    // поровну — с меньшим номером
    expect(pickSeat([...seats(1, 2, 3), ...seats(2, 1, 4)], 10, () => 0)).toEqual({ tableNo: 1, seatNo: 1 });
    // открыты столы 1 и 2, оба полные (лимит 3) — открывается стол 3
    expect(pickSeat([...seats(1, 1, 2, 3), ...seats(2, 1, 2, 3)], 3, () => 0)).toEqual({ tableNo: 3, seatNo: 1 });
    // стол 1 закрыли, играют за столом 2 — новые туда же, пока есть место
    expect(pickSeat(seats(2, 1, 2), 10, () => 0)).toEqual({ tableNo: 2, seatNo: 3 });
  });

  it("место — случайное из свободных", () => {
    // свободны 2, 4, 6 (лимит 6); random 0.99 → последнее свободное
    expect(pickSeat(seats(1, 1, 3, 5), 6, () => 0.99)).toEqual({ tableNo: 1, seatNo: 6 });
    expect(pickSeat(seats(1, 1, 3, 5), 6, () => 0.4)).toEqual({ tableNo: 1, seatNo: 4 });
  });

  it("все столы заполнены — места нет", () => {
    const all = [1, 2, 3].flatMap((t) => seats(t, 1, 2));
    expect(pickSeat(all, 2)).toBeNull();
  });

  it("настройки: 2–10 мест", () => {
    expect(sanitizeSeating({ seatsPerTable: "9", autoSeat: false })).toEqual({ seatsPerTable: 9, autoSeat: false });
    expect(sanitizeSeating({ autoSeat: true }, { seatsPerTable: 8, autoSeat: false })).toEqual({ seatsPerTable: 8, autoSeat: true });
    expect(() => sanitizeSeating({ seatsPerTable: 11 })).toThrow("от 2 до 10");
  });
});

describe("стек игрока", () => {
  const stacks = { startingStack: 30000, rebuyStack: 30000, addonStack: 40000, doubleAddonStack: 80000 };

  it("расчётный: старт + аддон", () => {
    expect(playerStack(stacks, [{ type: "entry", at: 1 }, { type: "addon", at: 5 }], null)).toEqual({ value: 70000, counted: false, countedAt: null });
  });

  it("после re-entry считается только новый заход", () => {
    const s = playerStack(stacks, [{ type: "entry", at: 1 }, { type: "addon", at: 2 }, { type: "reentry", at: 3 }], null);
    expect(s.value).toBe(30000);
  });

  it("посчитанный стек + аддоны после подсчёта; подсчёт до re-entry не действует", () => {
    const ev = [
      { type: "entry", at: 1 },
      { type: "double_addon", at: 20 },
    ] as const;
    expect(playerStack(stacks, [...ev], { stack: 52000, at: 10 })).toEqual({ value: 132000, counted: true, countedAt: 10 });
    expect(playerStack(stacks, [...ev, { type: "reentry", at: 30 }], { stack: 52000, at: 10 }).counted).toBe(false);
  });

  it("коротко: 45к, 1,2м", () => {
    expect([shortChips(900), shortChips(1500), shortChips(45000), shortChips(1_234_000)]).toEqual(["900", "1,5к", "45к", "1,2м"]);
  });
});

describe("подсказки рассадки", () => {
  // за столом t — n человек
  const at = (...counts: [number, number][]) => counts.flatMap(([t, n]) => Array.from({ length: n }, () => ({ tableNo: t })));

  it("ровно — подсказки нет; один стол — тоже", () => {
    expect(seatingHint(at([1, 3], [2, 2]), 4)).toBeNull(); // 5 человек за 4-местными — нужно 2 стола
    expect(seatingHint(at([1, 3]), 10)).toBeNull();
    expect(seatingHint(at([1, 7], [2, 6], [3, 6]), 9)).toBeNull();
  });

  it("стол 1 заполнен, пришедший сел за стол 2 — пересадите 4 игрока со стола 1 за стол 2", () => {
    const h = seatingHint(at([1, 10], [2, 1]), 10)!;
    expect(h).toEqual({ kind: "balance", moves: [{ from: 1, to: 2, count: 4 }] }); // 10 и 1 → 6 и 5
    expect(hintText(h)).toBe("пересадите со стола 1 за стол 2 — 4 игрока");
  });

  it("разница 2 — один игрок; лишний остаётся там, где людей больше", () => {
    expect(seatingHint(at([1, 6], [2, 8]), 9)).toEqual({ kind: "balance", moves: [{ from: 2, to: 1, count: 1 }] });
  });

  it("три стола: с двух полных за один пустой", () => {
    // 9 + 9 + 3 = 21 → 7, 7, 7
    expect(seatingHint(at([1, 9], [2, 9], [3, 3]), 9)).toEqual({
      kind: "balance",
      moves: [
        { from: 1, to: 3, count: 2 },
        { from: 2, to: 3, count: 2 },
      ],
    });
  });

  it("все помещаются за меньшим числом столов — закрыть самый пустой и раздать поровну", () => {
    // 6 + 3 + 3 = 12 при лимите 10 → нужно 2 стола; закрываем стол 3 (при равенстве — с большим номером) → 6 и 6
    const h = seatingHint(at([1, 6], [2, 3], [3, 3]), 10)!;
    expect(h).toEqual({ kind: "close", tableNo: 3, moves: [{ from: 3, to: 2, count: 3 }] });
    expect(hintText(h)).toBe("можно закрыть стол 3: пересадите со стола 3 за стол 2 — 3 игрока");
  });

  it("закрыть стол — люди расходятся за оба оставшихся", () => {
    // 5 + 5 + 4 = 14 при лимите 9 → 2 стола; закрыть 3 → 7 и 7
    expect(seatingHint(at([1, 5], [2, 5], [3, 4]), 9)).toEqual({
      kind: "close",
      tableNo: 3,
      moves: [
        { from: 3, to: 1, count: 2 },
        { from: 3, to: 2, count: 2 },
      ],
    });
  });

  it("два стола, все помещаются за одним — закрыть второй", () => {
    expect(seatingHint(at([1, 4], [2, 4]), 9)).toEqual({ kind: "close", tableNo: 2, moves: [{ from: 2, to: 1, count: 4 }] });
  });

  it("склонение: 1 игрок, 3 игрока, 5 игроков, 11 игроков", () => {
    expect([1, 3, 5, 11, 21, 22].map(playersCount)).toEqual(["1 игрок", "3 игрока", "5 игроков", "11 игроков", "21 игрок", "22 игрока"]);
  });
});
