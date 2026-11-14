import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLoginWidget, verifyWebAppData } from "./auth";

const TOKEN = "123456:TEST-token-for-tests-only-not-real";
const NOW = Date.UTC(2026, 10, 14, 12, 0);
const AUTH = String(Math.floor(NOW / 1000) - 60);

const dcs = (f: Record<string, string>) =>
  Object.keys(f)
    .sort()
    .map((k) => `${k}=${f[k]}`)
    .join("\n");

/** Подписать initData так, как это делает Telegram */
function webApp(fields: Record<string, string>, token = TOKEN) {
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dcs(fields)).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
function widget(fields: Record<string, string>, token = TOKEN) {
  const secret = createHash("sha256").update(token).digest();
  return { ...fields, hash: createHmac("sha256", secret).update(dcs(fields)).digest("hex") };
}

describe("мини-приложение: initData", () => {
  const fields = { auth_date: AUTH, query_id: "AAE", user: JSON.stringify({ id: 4242, first_name: "Саша" }) };
  it("настоящая подпись — узнаём пользователя", () => {
    expect(verifyWebAppData(webApp(fields), TOKEN, NOW)).toEqual({ telegramId: 4242, firstName: "Саша" });
  });
  it("подделка, чужой бот, устаревшие данные, мусор — нет", () => {
    const forged = webApp(fields).replace("4242", "1");
    expect(verifyWebAppData(forged, TOKEN, NOW)).toBeNull();
    expect(verifyWebAppData(webApp(fields, "999:other-bot-token"), TOKEN, NOW)).toBeNull();
    expect(verifyWebAppData(webApp(fields), TOKEN, NOW + 2 * 86_400_000)).toBeNull();
    expect(verifyWebAppData("", TOKEN, NOW)).toBeNull();
    expect(verifyWebAppData("hash=abc", TOKEN, NOW)).toBeNull();
    expect(verifyWebAppData(webApp(fields), "", NOW)).toBeNull();
  });
});

describe("«Войти через Telegram» на сайте", () => {
  const fields = { id: "4242", first_name: "Саша", username: "sasha", auth_date: AUTH };
  it("настоящая подпись — узнаём пользователя", () => {
    expect(verifyLoginWidget(widget(fields), TOKEN, NOW)).toEqual({ telegramId: 4242 });
  });
  it("подделка и устаревшие данные — нет", () => {
    expect(verifyLoginWidget({ ...widget(fields), id: "1" }, TOKEN, NOW)).toBeNull();
    expect(verifyLoginWidget(widget(fields), TOKEN, NOW + 2 * 86_400_000)).toBeNull();
    // подпись мини-приложения кнопке входа не подходит, и наоборот
    expect(verifyLoginWidget(Object.fromEntries(new URLSearchParams(webApp(fields))), TOKEN, NOW)).toBeNull();
    expect(verifyWebAppData(new URLSearchParams(widget(fields)).toString(), TOKEN, NOW)).toBeNull();
  });
});
