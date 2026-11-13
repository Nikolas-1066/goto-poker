import { describe, expect, it } from "vitest";
import { finalProgress, finalZone, finalZoneText, isJpeg, validateRegistration } from "./account";

describe("заявка на вход", () => {
  it("телефон приводится к одному виду, имя чистится", () => {
    expect(validateRegistration({ name: "  Саша   К. ", phone: "8 900 123-45-67", password: "секрет1" })).toEqual({
      name: "Саша К.",
      phone: "+79001234567",
      password: "секрет1",
    });
  });
  it("понятные ошибки", () => {
    expect(() => validateRegistration({ name: "", phone: "89001234567", password: "секрет1" })).toThrow("Укажите имя");
    expect(() => validateRegistration({ name: "Саша", phone: "123", password: "секрет1" })).toThrow("Телефон не похож");
    expect(() => validateRegistration({ name: "Саша", phone: "89001234567", password: "123" })).toThrow("минимум 6");
  });
});

describe("зона финала", () => {
  const rows = [
    { playerId: 1, rank: 1, points: 100 },
    { playerId: 2, rank: 2, points: 80 },
    { playerId: 3, rank: 3, points: 45 },
    { playerId: 4, rank: 4, points: 45 },
  ];
  it("в зоне, вне зоны, не играл", () => {
    expect(finalZone(rows, 2, 2)).toEqual({ state: "in", rank: 2, zone: 2, points: 80 });
    expect(finalZone(rows, 3, 2)).toEqual({ state: "out", rank: 3, zone: 2, points: 45, gap: 35 });
    expect(finalZone(rows, 4, 3)).toEqual({ state: "out", rank: 4, zone: 3, points: 45, gap: 0 });
    expect(finalZone(rows, 9, 2)).toEqual({ state: "none" });
  });
  it("полоса прогресса: сколько есть и сколько нужно", () => {
    expect(finalProgress(finalZone(rows, 3, 2))).toEqual({ have: 45, need: 80, percent: 56 });
    expect(finalProgress(finalZone(rows, 1, 2))).toEqual({ have: 100, need: 100, percent: 100 });
    expect(finalProgress(finalZone(rows, 4, 3))).toEqual({ have: 45, need: 45, percent: 99 });
    expect(finalProgress(finalZone(rows, 9, 2))).toBeNull();
  });
  it("текст", () => {
    expect(finalZoneText(finalZone(rows, 3, 2))).toBe("Сейчас 3 место, в финал выходят 2. До зоны финала — 35 оч.");
    expect(finalZoneText(finalZone(rows, 1, 2))).toBe("Вы в зоне финала: 1 место, в финал выходят 2.");
    expect(finalZoneText(finalZone(rows, 4, 3))).toContain("нужно его обойти");
  });
});

describe("фото", () => {
  it("только JPEG", () => {
    const jpeg = new Uint8Array(200);
    jpeg.set([0xff, 0xd8, 0xff]);
    expect(isJpeg(jpeg)).toBe(true);
    expect(isJpeg(new Uint8Array(200))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });
});
