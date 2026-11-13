import { describe, expect, it } from "vitest";
import {
  addDays,
  clubTime,
  clubToday,
  dayHint,
  formatDay,
  hasStarted,
  isDate,
  isTime,
  sanitizeItem,
  sanitizeTemplate,
  sortSchedule,
  templateDates,
  templateLabel,
  weekdayOf,
} from "./schedule";

describe("даты расписания", () => {
  it("сегодня и время — по часам клуба (Москва), а не сервера", () => {
    // 20 ноября 2026, 22:30 по Гринвичу — в клубе уже 21 ноября, 01:30
    const now = Date.UTC(2026, 10, 20, 22, 30);
    expect(clubToday(now)).toBe("2026-11-21");
    expect(clubTime(now)).toBe("01:30");
    expect(clubTime(Date.UTC(2026, 10, 20, 16, 5))).toBe("19:05");
  });

  it("день недели и сдвиг дат", () => {
    expect(weekdayOf("2026-11-13")).toBe(5); // пятница
    expect(weekdayOf("2026-11-15")).toBe(7); // воскресенье
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-02-28")).toBe(true);
    expect(isTime("19:00")).toBe(true);
    expect(isTime("24:00")).toBe(false);
    expect(isTime("9:00")).toBe(false);
  });

  it("постоянный день: на 2 недели вперёд, считая сегодня", () => {
    // сегодня пятница 13.11 → пятницы 13 и 20; 27-е — уже за пределами 14 дней
    expect(templateDates(5, "2026-11-13")).toEqual(["2026-11-13", "2026-11-20"]);
    expect(templateDates(1, "2026-11-13")).toEqual(["2026-11-16", "2026-11-23"]);
    expect(templateDates(4, "2026-11-13")).toEqual(["2026-11-19", "2026-11-26"]);
  });

  it("начался ли турнир по расписанию", () => {
    const at = (h: number, m: number) => Date.UTC(2026, 10, 20, h - 3, m); // время клуба → UTC
    const item = { date: "2026-11-20", time: "19:00" };
    expect(hasStarted(item, at(18, 59))).toBe(false);
    expect(hasStarted(item, at(19, 0))).toBe(true);
    expect(hasStarted({ date: "2026-11-19", time: "23:00" }, at(10, 0))).toBe(true);
    expect(hasStarted({ date: "2026-11-21", time: "00:10" }, at(23, 0))).toBe(false);
  });

  it("подписи", () => {
    expect(formatDay("2026-11-20")).toBe("пт, 20 ноября");
    expect(formatDay("2027-01-03")).toBe("вс, 3 января");
    expect(dayHint("2026-11-13", "2026-11-13")).toBe("Сегодня");
    expect(dayHint("2026-11-14", "2026-11-13")).toBe("Завтра");
    expect(dayHint("2026-11-15", "2026-11-13")).toBe("");
    expect(templateLabel({ weekday: 5, time: "19:00" })).toBe("Каждую пятницу в 19:00");
    expect(templateLabel({ weekday: 7, time: "17:30" })).toBe("Каждое воскресенье в 17:30");
  });
});

describe("проверка ввода", () => {
  const ok = { date: "2026-11-20", time: "19:00", name: "  Пятничный  ", presetId: "abc", seatLimit: "", note: "" };

  it("турнир: обрезает пробелы, пустой лимит — без лимита", () => {
    expect(sanitizeItem(ok, "2026-11-13")).toEqual({ date: "2026-11-20", time: "19:00", name: "Пятничный", presetId: "abc", seatLimit: null, note: "" });
    expect(sanitizeItem({ ...ok, seatLimit: "27" }, "2026-11-13").seatLimit).toBe(27);
    expect(sanitizeItem({ ...ok, date: "2026-11-13" }, "2026-11-13").date).toBe("2026-11-13"); // сегодня — можно
  });

  it("турнир: понятные ошибки", () => {
    expect(() => sanitizeItem({ ...ok, date: "2026-11-12" }, "2026-11-13")).toThrow("уже прошла");
    expect(() => sanitizeItem({ ...ok, date: "20.11.2026" }, "2026-11-13")).toThrow("Выберите дату");
    expect(() => sanitizeItem({ ...ok, time: "7 вечера" }, "2026-11-13")).toThrow("19:00");
    expect(() => sanitizeItem({ ...ok, name: " " }, "2026-11-13")).toThrow("название");
    expect(() => sanitizeItem({ ...ok, presetId: "" }, "2026-11-13")).toThrow("структуру");
    expect(() => sanitizeItem({ ...ok, seatLimit: 1 }, "2026-11-13")).toThrow("Лимит мест");
    expect(() => sanitizeItem({ ...ok, seatLimit: "много" }, "2026-11-13")).toThrow("Лимит мест");
  });

  it("постоянный день", () => {
    expect(sanitizeTemplate({ ...ok, weekday: "5" })).toEqual({ weekday: 5, time: "19:00", name: "Пятничный", presetId: "abc", seatLimit: null, note: "" });
    expect(() => sanitizeTemplate({ ...ok, weekday: 8 })).toThrow("день недели");
  });

  it("порядок: дата, время", () => {
    const list = [
      { id: 1, date: "2026-11-21", time: "17:00" },
      { id: 2, date: "2026-11-20", time: "19:00" },
      { id: 3, date: "2026-11-20", time: "15:00" },
    ];
    expect(sortSchedule(list).map((x) => x.id)).toEqual([3, 2, 1]);
  });
});
