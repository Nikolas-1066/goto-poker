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

export function isAdmin(req: NextRequest) {
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
