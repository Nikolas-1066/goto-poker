import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicRequest, weakForPublic } from "./auth";

const req = (host: string, forwarded?: string) =>
  ({ headers: new Headers({ host, ...(forwarded ? { "x-forwarded-host": forwarded } : {}) }) }) as unknown as NextRequest;

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
});

describe("откуда открыт сайт", () => {
  it("этот компьютер и Wi-Fi клуба — не интернет", () => {
    for (const h of ["localhost:3000", "127.0.0.1:3000", "192.168.0.89:3000", "10.0.0.5", "172.20.1.2:3000", "mac.local:3000", "[::1]:3000"]) {
      expect(isPublicRequest(req(h))).toBe(false);
    }
  });
  it("временный адрес и домен — интернет (в том числе через заголовок прокси)", () => {
    expect(isPublicRequest(req("abc-def.trycloudflare.com"))).toBe(true);
    expect(isPublicRequest(req("localhost:3000", "abc-def.trycloudflare.com"))).toBe(true);
    expect(isPublicRequest(req("goto-poker.ru"))).toBe(true);
    expect(isPublicRequest(req("172.32.0.1"))).toBe(true);
  });
  it("пароль по умолчанию из интернета не годится; свой пароль задан — можно", () => {
    expect(weakForPublic(req("x.trycloudflare.com"))).toBe(true);
    expect(weakForPublic(req("localhost:3000"))).toBe(false);
    process.env.ADMIN_PASSWORD = "свой-пароль";
    expect(weakForPublic(req("x.trycloudflare.com"))).toBe(false);
  });
});
