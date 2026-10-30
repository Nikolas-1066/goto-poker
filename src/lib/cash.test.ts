import { describe, expect, it } from "vitest";
import { cashByPlayer, cashSummary, checkPayment, debtWarning, formatRub, hasPrices, priceOf, type Charge, type Payment } from "./cash";

let id = 0;
const ch = (playerId: number, type: Charge["type"], price: number, extra: Partial<Charge> = {}): Charge => ({
  eventId: ++id,
  playerId,
  type,
  price,
  free: false,
  cancelled: false,
  at: id,
  ...extra,
});
const pay = (playerId: number, amount: number, method: Payment["method"] = "cash", cancelled = false): Payment => ({
  id: ++id,
  playerId,
  amount,
  method,
  at: id,
  cancelled,
});

describe("касса игрока", () => {
  it("начислено: входы и аддоны по их цене; оплачено; долг", () => {
    const c = cashByPlayer([ch(1, "entry", 1500), ch(1, "reentry", 1000), ch(1, "addon", 1000)], [pay(1, 2000)]).get(1)!;
    expect(c).toMatchObject({ charged: 3500, paid: 2000, debt: 1500, free: 0 });
    expect(c.charges).toHaveLength(3);
  });

  it("бесплатное действие не начисляется, но считается отдельно", () => {
    const c = cashByPlayer([ch(1, "entry", 1500), ch(1, "reentry", 1000, { free: true })], []).get(1)!;
    expect(c).toMatchObject({ charged: 1500, free: 1000, debt: 1500 });
  });

  it("отменённое действие и отменённая оплата не считаются", () => {
    const c = cashByPlayer([ch(1, "entry", 1500), ch(1, "addon", 1000, { cancelled: true })], [pay(1, 1500, "card", true)]).get(1)!;
    expect(c).toMatchObject({ charged: 1500, paid: 0, debt: 1500 });
    expect(c.charges).toHaveLength(1);
    expect(c.payments).toHaveLength(0);
  });

  it("оплата частями разными способами", () => {
    const c = cashByPlayer([ch(1, "entry", 1500)], [pay(1, 1000, "cash"), pay(1, 500, "card")]).get(1)!;
    expect(c.debt).toBe(0);
    expect(c.byMethod).toEqual({ cash: 1000, card: 500, transfer: 0 });
  });

  it("отменили вход после оплаты — переплата (долг меньше нуля)", () => {
    expect(cashByPlayer([ch(1, "entry", 1500, { cancelled: true })], [pay(1, 1500)]).get(1)!.debt).toBe(-1500);
  });
});

describe("итог кассы турнира", () => {
  it("начислено, бесплатно, собрано по способам, долги и переплаты", () => {
    const players = cashByPlayer(
      [ch(1, "entry", 1500), ch(2, "entry", 1500), ch(2, "addon", 1000), ch(3, "entry", 1500, { free: true }), ch(4, "entry", 0)],
      [pay(1, 1500, "cash"), pay(2, 1000, "transfer"), pay(5, 500, "card")],
    );
    expect(cashSummary(players.values())).toEqual({
      charged: 4000,
      free: 1500,
      paid: 3000,
      byMethod: { cash: 1500, card: 500, transfer: 1000 },
      debt: 1500,
      debtors: 1,
      overpaid: 500,
    });
  });
});

describe("проверка оплаты", () => {
  it("способ, целая сумма, не больше долга", () => {
    expect(checkPayment(500, "bitcoin", 1000)).toBe("Выберите способ оплаты");
    expect(checkPayment(0, "cash", 1000)).toMatch("больше нуля");
    expect(checkPayment(10.5, "cash", 1000)).toMatch("целое");
    expect(checkPayment(500, "cash", 0)).toBe("Долга нет — всё оплачено");
    expect(checkPayment(1500, "cash", 1000)).toBe("Больше, чем долг: 1 000 ₽");
    expect(checkPayment(1000, "transfer", 1000)).toBeNull();
  });
});

describe("цены", () => {
  const prices = { entry: 1500, reentry: 1000, addon: 800, doubleAddon: 1600 };
  it("цена по типу действия", () => {
    expect([priceOf(prices, "entry"), priceOf(prices, "reentry"), priceOf(prices, "addon"), priceOf(prices, "double_addon")]).toEqual([
      1500, 1000, 800, 1600,
    ]);
    expect(priceOf(undefined, "entry")).toBe(0);
  });
  it("заданы ли цены; формат рублей", () => {
    expect(hasPrices(prices)).toBe(true);
    expect(hasPrices({ entry: 0, reentry: 0, addon: 0, doubleAddon: 0 })).toBe(false);
    expect([formatRub(1500), formatRub(0), formatRub(125000)]).toEqual(["1 500 ₽", "0 ₽", "125 000 ₽"]);
  });
});

describe("предупреждение при завершении", () => {
  const sum = (debtors: number, debt: number) => ({ ...cashSummary([]), debtors, debt });
  it("долгов нет — молчит; есть — сколько игроков и сумма", () => {
    expect(debtWarning(sum(0, 0))).toBe("");
    expect(debtWarning(null)).toBe("");
    expect(debtWarning(sum(1, 1500))).toBe("Касса: 1 игрок не доплатил, всего 1 500 ₽. Долг останется на карточке игрока.");
    expect(debtWarning(sum(3, 4500))).toMatch("3 игрока не доплатили, всего 4 500 ₽");
    expect(debtWarning(sum(5, 7500))).toMatch("5 игроков не доплатили");
    expect(debtWarning(sum(12, 100))).toMatch("12 игроков");
    expect(debtWarning(sum(21, 100))).toMatch("21 игрок не доплатил");
  });
});
