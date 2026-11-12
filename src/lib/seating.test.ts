import { describe, expect, it } from "vitest";
import { pickSeat, playerStack, sanitizeSeating, seatingHint, shortChips, type SeatedPlayer } from "./seating";

const seats = (table: number, ...nos: number[]) => nos.map((seatNo) => ({ tableNo: table, seatNo }));

describe("автопосадка", () => {
  it("сначала заполняется стол 1 до лимита, потом стол 2", () => {
    expect(pickSeat([], 10, () => 0)).toEqual({ tableNo: 1, seatNo: 1 });
    expect(pickSeat(seats(1, 1, 2, 3, 4, 5, 6, 7, 8, 9), 9, () => 0)).toEqual({ tableNo: 2, seatNo: 1 });
    expect(pickSeat(seats(1, 1, 2, 3, 4, 5, 6, 7, 8, 9), 10, () => 0)).toEqual({ tableNo: 1, seatNo: 10 });
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
  let id = 0;
  const at = (table: number, ...nos: number[]): SeatedPlayer[] => nos.map((seatNo) => ({ id: ++id, name: `И${id}`, tableNo: table, seatNo }));

  it("ровно — подсказки нет; один стол — тоже", () => {
    expect(seatingHint([...at(1, 1, 2, 3), ...at(2, 1, 2)], 4)).toBeNull(); // 5 человек за 4-местными — нужно 2 стола
    expect(seatingHint(at(1, 1, 2, 3), 10)).toBeNull();
  });

  it("разница 2 и больше — пересадить с последнего места полного стола на свободное место пустого", () => {
    const h = seatingHint([...at(1, 1, 2, 3, 4, 5, 6, 7, 8), ...at(2, 1, 2, 3, 5, 6, 7)], 9)!;
    // 8 и 6 → один игрок со стола 1, место 8 → стол 2, место 4
    expect(h.kind).toBe("balance");
    expect(h.moves.map((m) => [m.from, m.to])).toEqual([[{ tableNo: 1, seatNo: 8 }, { tableNo: 2, seatNo: 4 }]]);
  });

  it("после заполнения «стол 1, потом стол 2» — выровнять за несколько пересадок", () => {
    const h = seatingHint([...at(1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10), ...at(2, 1, 2)], 10)!;
    expect(h.kind).toBe("balance");
    expect(h.moves).toHaveLength(4); // 10 и 2 → 6 и 6
    expect(h.moves.map((m) => m.from.seatNo)).toEqual([10, 9, 8, 7]);
    expect(h.moves.map((m) => m.to.seatNo)).toEqual([3, 4, 5, 6]);
  });

  it("все помещаются за меньшим числом столов — закрыть самый пустой", () => {
    // 6 + 3 + 3 = 12 при лимите 10 → нужно 2 стола; закрываем стол 3 (самый пустой, при равенстве — с большим номером)
    const h = seatingHint([...at(1, 1, 2, 3, 4, 5, 6), ...at(2, 2, 4, 6), ...at(3, 1, 5, 9)], 10)!;
    expect(h.kind).toBe("close");
    if (h.kind !== "close") return;
    expect(h.tableNo).toBe(3);
    // по одному к самому пустому: стол 2 (3 чел.) → места 1, 3, потом снова стол 2 (5) vs стол 1 (6)
    expect(h.moves.map((m) => [m.from.seatNo, m.to.tableNo, m.to.seatNo])).toEqual([
      [1, 2, 1],
      [5, 2, 3],
      [9, 2, 5],
    ]);
  });

  it("два стола, все помещаются за одним — закрыть второй", () => {
    const h = seatingHint([...at(1, 1, 2, 3, 4), ...at(2, 1, 2, 3, 4)], 9)!;
    expect(h).toMatchObject({ kind: "close", tableNo: 2 });
    expect(h.moves.map((m) => m.to.seatNo)).toEqual([5, 6, 7, 8]);
  });
});
