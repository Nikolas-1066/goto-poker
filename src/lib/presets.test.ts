import { describe, expect, it } from "vitest";
import { defaultPresets, niceBlind, sanitizePreset, suggestNextLevel, withPresetDefaults } from "./presets";

describe("пресеты по умолчанию", () => {
  it("три пресета с уровнями и перерывами", () => {
    const list = defaultPresets();
    expect(list.map((p) => p.name)).toEqual(["Стандарт", "Турбо", "Дипстек"]);
    for (const p of list) {
      expect(p.steps.some((s) => s.kind === "level")).toBe(true);
      expect(p.steps.some((s) => s.kind === "break")).toBe(true);
      expect(p.steps.at(-1)?.kind).toBe("level"); // в конце не перерыв
    }
  });

  it("у всех шагов разные id", () => {
    const ids = defaultPresets().flatMap((p) => p.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("красивые блайнды", () => {
  it("округляет к ближайшему привычному значению", () => {
    expect(niceBlind(0)).toBe(0);
    expect(niceBlind(280)).toBe(300);
    expect(niceBlind(1400)).toBe(1500);
    expect(niceBlind(7000)).toBe(6000);
    expect(niceBlind(9500)).toBe(10000);
  });

  it("следующий уровень примерно ×1.4, анте равно ББ, если так было", () => {
    const next = suggestNextLevel({ id: "x", kind: "level", sb: 500, bb: 1000, ante: 1000, minutes: 20 }, 20);
    expect(next.bb).toBe(1500);
    expect(next.sb).toBe(750);
    expect(next.ante).toBe(1500);
  });

  it("первый уровень, если предыдущего нет", () => {
    expect(suggestNextLevel(undefined, 15)).toMatchObject({ sb: 100, bb: 200, minutes: 15 });
  });
});

describe("проверка пресета из админки", () => {
  const base = { name: "  Пятница  ", startingStack: 30000, steps: [{ kind: "level", sb: 100, bb: 200, ante: 0, minutes: 20 }] };

  it("без названия — ошибка", () => {
    expect(() => sanitizePreset({ ...base, name: "   " }, "id")).toThrow("Укажите название");
  });

  it("мусор вместо данных — ошибка", () => {
    expect(() => sanitizePreset(null, "id")).toThrow("Некорректные данные");
  });

  it("убирает пробелы, исправляет отрицательные и дробные числа", () => {
    const p = sanitizePreset({ ...base, rebuyStack: -500, addonStack: "40000.4" }, "id");
    expect(p.name).toBe("Пятница");
    expect(p.rebuyStack).toBe(0);
    expect(p.addonStack).toBe(40000);
  });

  it("длительность шага от 1 до 600 минут", () => {
    const p = sanitizePreset(
      { ...base, steps: [{ kind: "level", minutes: 0 }, { kind: "break", minutes: 5000 }] },
      "id",
    );
    expect(p.steps.map((s) => s.minutes)).toEqual([1, 600]);
  });

  it("подпись перерыва сохраняется, пустая — убирается", () => {
    const p = sanitizePreset(
      { ...base, steps: [{ kind: "break", minutes: 10, note: " Укрупнение " }, { kind: "break", minutes: 10, note: "" }] },
      "id",
    );
    expect(p.steps[0]).toMatchObject({ kind: "break", note: "Укрупнение" });
    expect(p.steps[1]).not.toHaveProperty("note");
  });

  it("больше 200 шагов — ошибка", () => {
    const steps = Array.from({ length: 201 }, () => ({ kind: "level", minutes: 10 }));
    expect(() => sanitizePreset({ ...base, steps }, "id")).toThrow("Слишком много");
  });
});

describe("старые пресеты без новых полей", () => {
  it("двойной аддон = 2 аддона, ребаи и аддоны выключены", () => {
    const p = withPresetDefaults({ name: "Старый", addonStack: 40000 });
    expect(p.doubleAddonStack).toBe(80000);
    expect(p.rebuyUntilLevel).toBe(0);
    expect(p.addonUntilLevel).toBe(0);
  });

  it("уже заданные значения не трогает", () => {
    const p = withPresetDefaults({ addonStack: 40000, doubleAddonStack: 70000, rebuyUntilLevel: 6, addonUntilLevel: 8 });
    expect([p.doubleAddonStack, p.rebuyUntilLevel, p.addonUntilLevel]).toEqual([70000, 6, 8]);
  });
});
