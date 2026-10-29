import { describe, expect, it } from "vitest";
import { cleanName, formatPhone, normalizePhone, phoneTail, searchPlayers, similarByName, validatePlayer } from "./players";

describe("телефон", () => {
  it("понимает разные способы записи российского номера", () => {
    for (const s of ["+7 900 123-45-67", "8 (900) 123-45-67", "89001234567", "79001234567", "9001234567", " +7(900)1234567 "]) {
      expect(normalizePhone(s)).toBe("+79001234567");
    }
  });

  it("иностранный номер — с «+» и кодом страны", () => {
    expect(normalizePhone("+380 67 123 45 67")).toBe("+380671234567");
    expect(normalizePhone("+375 29 123-45-67")).toBe("+375291234567");
  });

  it("не похоже на телефон — null", () => {
    for (const s of ["", "123", "12345", "8900123456", "+7 900 123", "абв", "4001234567", "+123"]) {
      expect(normalizePhone(s)).toBeNull();
    }
  });

  it("красивый вид и хвост для списков", () => {
    expect(formatPhone("+79001234567")).toBe("+7 900 123-45-67");
    expect(formatPhone("+380671234567")).toBe("+380671234567");
    expect(phoneTail("+79001234567")).toBe("··· 45-67");
  });
});

describe("проверка игрока", () => {
  it("лишние пробелы в имени убираются", () => {
    expect(cleanName("  Саша   К. ")).toBe("Саша К.");
    expect(validatePlayer({ name: "  Саша   К. ", phone: "89001234567" })).toEqual({
      name: "Саша К.",
      phone: "+79001234567",
      note: "",
    });
  });

  it("имя и телефон обязательны", () => {
    expect(() => validatePlayer({ name: "  ", phone: "89001234567" })).toThrow("Укажите имя");
    expect(() => validatePlayer({ name: "Саша" })).toThrow("Укажите телефон");
    expect(() => validatePlayer({ name: "Саша", phone: "123" })).toThrow("не похож на настоящий");
    expect(() => validatePlayer(null)).toThrow("Укажите имя");
  });

  it("слишком длинное имя — ошибка, длинная заметка обрезается", () => {
    expect(() => validatePlayer({ name: "Я".repeat(61), phone: "89001234567" })).toThrow("слишком длинное");
    expect(validatePlayer({ name: "Саша", phone: "89001234567", note: "x".repeat(500) }).note).toHaveLength(300);
  });
});

describe("поиск", () => {
  const players = [
    { id: 1, name: "Саша Козлов", phone: "+79001234567" },
    { id: 2, name: "Александр", phone: "+79005554433" },
    { id: 3, name: "Ира", phone: "+79161112233" },
    { id: 4, name: "Артём", phone: "+79267654567" },
    { id: 5, name: "Сергей", phone: "+79031110000" },
  ];
  const names = (q: string) => searchPlayers(players, q).map((p) => p.name);

  it("пустой запрос — все по алфавиту", () => {
    expect(names("")).toEqual(["Александр", "Артём", "Ира", "Саша Козлов", "Сергей"]);
  });

  it("по началу имени, без учёта регистра", () => {
    expect(names("саш")).toEqual(["Саша Козлов"]);
    expect(names("СЕР")).toEqual(["Сергей"]);
  });

  it("по началу любого слова имени: «коз», «са к»", () => {
    expect(names("коз")).toEqual(["Саша Козлов"]);
    expect(names("са к")).toEqual(["Саша Козлов"]);
  });

  it("сначала те, у кого имя начинается с запроса, потом — содержит его", () => {
    expect(names("ал")).toEqual(["Александр"]);
    // «Саша» начинается с «са», а в «Александр» «са» только внутри — он ниже
    expect(names("са")).toEqual(["Саша Козлов", "Александр"]);
    expect(names("сандр")).toEqual(["Александр"]);
  });

  it("«ё» и «е» — одно и то же", () => {
    expect(names("артем")).toEqual(["Артём"]);
  });

  it("по последним цифрам телефона: сначала совпадение в конце номера", () => {
    // у обоих номер кончается на 4567 — по алфавиту
    expect(names("4567")).toEqual(["Артём", "Саша Козлов"]);
    expect(names("45-67")).toEqual(["Артём", "Саша Козлов"]);
    // 654 — внутри номера Артёма, в конце ни у кого
    expect(names("654")).toEqual(["Артём"]);
    expect(names("555")).toEqual(["Александр"]);
    expect(names("12")).toEqual([]); // меньше 3 цифр — не ищем по телефону
  });

  it("похожие имена — по первому слову", () => {
    expect(similarByName(players, "саша").map((p) => p.id)).toEqual([1]);
    expect(similarByName(players, "Саша П.").map((p) => p.id)).toEqual([1]);
    expect(similarByName(players, "Петя")).toEqual([]);
    expect(similarByName(players, "с")).toEqual([]);
  });
});
