import { describe, expect, it } from "vitest";
import { ABOUT_EMPTY, aboutIsEmpty, formatSiteDate, playersWord, sanitizeAbout, sanitizeLink } from "./site";

describe("«О клубе»", () => {
  it("обрезает пробелы, пустое — пусто", () => {
    expect(sanitizeAbout({})).toEqual(ABOUT_EMPTY);
    expect(aboutIsEmpty(sanitizeAbout({ address: "   " }))).toBe(true);
    expect(sanitizeAbout({ address: "  Воронеж, ул. Примерная, 1 ", rules: "1. Раз\r\n2. Два" })).toMatchObject({
      address: "Воронеж, ул. Примерная, 1",
      rules: "1. Раз\n2. Два",
    });
  });

  it("ссылки: дописывает https://, чужие схемы не пускает", () => {
    expect(sanitizeLink("t.me/gotopoker", "Telegram")).toBe("https://t.me/gotopoker");
    expect(sanitizeLink("https://vk.com/gotopoker", "ВКонтакте")).toBe("https://vk.com/gotopoker");
    expect(sanitizeLink("", "Telegram")).toBe("");
    expect(() => sanitizeLink("javascript:alert(1)", "Telegram")).toThrow("https://");
    expect(() => sanitizeLink("@gotopoker", "Telegram")).toThrow("ссылка целиком");
    expect(() => sanitizeLink("просто текст", "Telegram")).toThrow("не похоже на ссылку");
  });

  it("слишком длинный текст — понятная ошибка", () => {
    expect(() => sanitizeAbout({ address: "я".repeat(201) })).toThrow("Адрес — не длиннее 200");
  });

  it("подписи", () => {
    expect(formatSiteDate(Date.UTC(2026, 10, 12, 18, 0))).toBe("12 ноября 2026");
    expect([1, 2, 5, 11, 21, 24].map(playersWord)).toEqual(["1 игрок", "2 игрока", "5 игроков", "11 игроков", "21 игрок", "24 игрока"]);
  });
});
