import { describe, expect, it } from "vitest";
import { editDistance, matchLine, nameKey, parseList } from "./importList";

const players = [
  { id: 1, name: "FALKROOM", phone: "+79000000001" },
  { id: 2, name: "Глесо", phone: "+79000000002" },
  { id: 3, name: "Ghost", phone: "+79000000003" },
  { id: 4, name: "Матвей Р.", phone: "+79000000004" },
  { id: 5, name: "Коля", phone: "+79000000005" },
  { id: 6, name: "Саша", phone: "+79000000006" },
  { id: 7, name: "Саша", phone: "+79000000007" },
  { id: 8, name: "Mad Hag", phone: "+79000000008" },
];

describe("разбор вставленного списка", () => {
  it("столбец из Google-таблицы: ники, у новичка — телефон через табуляцию", () => {
    const rows = parseList("FALKROOM\nГЛЕСО\t\nMadHag\t89001234567\n\n  Матвей  Репин \nNMK\n");
    expect(rows.map((r) => r.name)).toEqual(["FALKROOM", "ГЛЕСО", "MadHag", "Матвей Репин", "NMK"]);
    expect(rows[2]).toEqual({ line: 3, name: "MadHag", phone: "+79001234567", badPhone: "" });
    expect(rows[3].line).toBe(5);
  });

  it("телефон в конце строки без табуляции и в другом столбце", () => {
    expect(parseList("Матвей Репин 8 900 123-45-67")[0]).toMatchObject({ name: "Матвей Репин", phone: "+79001234567" });
    expect(parseList("+7 900 123 45 67\tЛенин")[0]).toMatchObject({ name: "Ленин", phone: "+79001234567" });
  });

  it("цифры, не похожие на телефон, показываются как ошибка", () => {
    expect(parseList("Ленин\t12345")[0]).toMatchObject({ name: "Ленин", phone: null, badPhone: "12345" });
  });

  it("заголовок «Ник» и повторы пропускаются, телефон из повтора не теряется", () => {
    const rows = parseList("Ник\tТелефон\nGhost\nghost\t89001234567\nNMK");
    expect(rows.map((r) => r.name)).toEqual(["Ghost", "NMK"]);
    expect(rows[0].phone).toBe("+79001234567");
  });

  it("пустой текст — пустой список; слишком длинный — ошибка", () => {
    expect(parseList("  \n\t\n")).toEqual([]);
    expect(() => parseList(Array.from({ length: 201 }, (_, i) => `Игрок ${i}`).join("\n"))).toThrow("не больше 200");
  });
});

describe("поиск игрока по строке", () => {
  it("ник совпал без учёта регистра, «ё» и пробелов", () => {
    expect(nameKey("Mad Hag")).toBe(nameKey("madhag"));
    expect(matchLine({ name: "ГЛЕСО", phone: null }, players)).toEqual({ kind: "found", playerId: 2, by: "name" });
    expect(matchLine({ name: "MadHag", phone: null }, players)).toEqual({ kind: "found", playerId: 8, by: "name" });
  });

  it("телефон важнее ника", () => {
    expect(matchLine({ name: "Новый ник", phone: "+79000000003" }, players)).toEqual({ kind: "found", playerId: 3, by: "phone" });
  });

  it("два игрока с одинаковым ником — выбирает админ", () => {
    expect(matchLine({ name: "саша", phone: null }, players)).toEqual({ kind: "choose", candidates: [6, 7] });
  });

  it("похожие ники: опечатка, латиница/кириллица, начало ника, первое слово", () => {
    expect(matchLine({ name: "FALKRОOM", phone: null }, players)).toMatchObject({ kind: "choose", candidates: [1] }); // русская «О»
    expect(matchLine({ name: "Гост", phone: null }, players)).toMatchObject({ kind: "choose", candidates: [3] });
    expect(matchLine({ name: "Колян", phone: null }, players)).toMatchObject({ kind: "choose", candidates: [5] });
    expect(matchLine({ name: "Матвей Репин", phone: null }, players)).toMatchObject({ kind: "choose", candidates: [4] });
  });

  it("никого похожего — новый игрок", () => {
    expect(matchLine({ name: "Ленин", phone: null }, players)).toEqual({ kind: "new" });
    expect(matchLine({ name: "NMK", phone: "+79001112233" }, players)).toEqual({ kind: "new" });
  });

  it("расстояние между словами", () => {
    expect(editDistance("kolya", "kolyan")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });
});
