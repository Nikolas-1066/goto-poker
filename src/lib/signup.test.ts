import { describe, expect, it } from "vitest";
import { sanitizeGuests, seatsWord, signupLabel, signupOpen, splitQueue } from "./signup";

describe("гости", () => {
  it("число 0…3, ники по желанию и не больше числа гостей", () => {
    expect(sanitizeGuests({})).toEqual({ guests: 0, guestNames: [] });
    expect(sanitizeGuests({ guests: 2, guestNames: ["  Петя  ", "", "Лишний"] })).toEqual({ guests: 2, guestNames: ["Петя"] });
    expect(() => sanitizeGuests({ guests: 4 })).toThrow("от 0 до 3");
    expect(() => sanitizeGuests({ guests: 1, guestNames: ["я".repeat(41)] })).toThrow("не длиннее 40");
  });
});

describe("лимит и лист ожидания", () => {
  const rows = [
    { id: 1, guests: 0 },
    { id: 2, guests: 2 },
    { id: 3, guests: 1 },
    { id: 4, guests: 0 },
  ];
  const ids = (list: { id: number }[]) => list.map((r) => r.id);
  it("без лимита все записаны", () => {
    const q = splitQueue(rows, null);
    expect([ids(q.going), ids(q.waiting), q.seats, q.free]).toEqual([[1, 2, 3, 4], [], 7, null]);
  });
  it("очередь строгая: не поместился с гостями — он и все после него ждут", () => {
    const q = splitQueue(rows, 5);
    expect([ids(q.going), ids(q.waiting), q.seats, q.free]).toEqual([[1, 2], [3, 4], 4, 1]);
  });
  it("кто-то отменил — очередь сдвигается сама", () => {
    const q = splitQueue(rows.filter((r) => r.id !== 2), 5);
    expect([ids(q.going), ids(q.waiting), q.free]).toEqual([[1, 3, 4], [], 1]);
  });
});

describe("подписи и срок записи", () => {
  it("запись — до времени начала по расписанию; на отменённый нельзя", () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 10, 20, h - 3, m); // 20 ноября, время клуба
    const item = { date: "2026-11-20", time: "19:00", status: "planned" as const };
    expect(signupOpen(item, at(18, 59))).toBe(true);
    expect(signupOpen(item, at(19))).toBe(false);
    expect(signupOpen({ ...item, status: "started" }, at(18))).toBe(true); // открыли в клубе заранее
    expect(signupOpen({ ...item, status: "cancelled" }, at(12))).toBe(false);
  });
  it("«Саша +2», «3 места»", () => {
    expect(signupLabel({ name: "Саша", guests: 2 })).toBe("Саша +2");
    expect(signupLabel({ name: "Саша", guests: 0 })).toBe("Саша");
    expect([1, 3, 12, 21].map(seatsWord)).toEqual(["1 место", "3 места", "12 мест", "21 место"]);
  });
});
