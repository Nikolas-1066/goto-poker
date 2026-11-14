// Простая защита админки паролем из переменной окружения ADMIN_PASSWORD.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const AUTH_COOKIE = "goto_admin";

function password() {
  const p = process.env.ADMIN_PASSWORD;
  if (p) return p;
  if (process.env.NODE_ENV === "production") {
    console.warn("[auth] ADMIN_PASSWORD не задан — используется пароль по умолчанию «goto». Задайте его в .env!");
  }
  return "goto";
}

export function tokenFor(pass: string) {
  return createHmac("sha256", pass).update("goto-poker-admin-v1").digest("hex");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string) {
  return safeEqual(tokenFor(candidate), tokenFor(password()));
}

/**
 * Сайт открыт из интернета (временный адрес `npm run tunnel` или сервер), а не с этого компьютера или
 * из Wi-Fi клуба: по адресу, с которым пришёл запрос.
 */
export function isPublicRequest(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  if (!name) return false;
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local") || name === "::1") return false;
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(name);
}

/** Пароль по умолчанию «goto» из интернета не принимаем: его знает кто угодно */
export const weakForPublic = (req: NextRequest) => !process.env.ADMIN_PASSWORD && isPublicRequest(req);

export function isAdmin(req: NextRequest) {
  if (weakForPublic(req)) return false;
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  return !!token && safeEqual(token, tokenFor(password()));
}

export function currentToken() {
  return tokenFor(password());
}

export function unauthorized() {
  return Response.json({ error: "Нужно войти в админку" }, { status: 401 });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function isHttps(req: NextRequest) {
  return req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}
