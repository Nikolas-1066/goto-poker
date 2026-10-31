// Пароль владельца: открывает «Статистику» и изменение правил рейтинга (обычным админам — нет).
// Хранится в settings (ключ 'owner') как соль + scrypt-хэш. Задаётся в админке при первом входе.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { audit } from "./sqlite";

type OwnerRecord = { salt: string; hash: string };

const hashOf = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function record(db: DatabaseSync): OwnerRecord | null {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'owner'").get() as { value_json: string } | undefined;
  if (!row) return null;
  const r = JSON.parse(row.value_json) as Partial<OwnerRecord>;
  return r.salt && r.hash ? { salt: r.salt, hash: r.hash } : null;
}

export const hasOwnerPassword = (db: DatabaseSync) => record(db) != null;

/** Задать (или сменить) пароль владельца. Бросает Error с понятным текстом. */
export function setOwnerPassword(db: DatabaseSync, password: string, now = Date.now()) {
  if (typeof password !== "string" || password.trim().length < 4) throw new Error("Пароль — минимум 4 символа");
  const salt = randomBytes(16).toString("hex");
  const value = JSON.stringify({ salt, hash: hashOf(password, salt) });
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('owner', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(value);
  audit(db, "owner.password", {}, now);
}

export function checkOwnerPassword(db: DatabaseSync, password: string) {
  const r = record(db);
  return !!r && typeof password === "string" && safeEqual(hashOf(password, r.salt), r.hash);
}

/** Метка для cookie: меняется вместе с паролем — после смены или сброса все входы владельца закрываются */
export function ownerToken(db: DatabaseSync) {
  const r = record(db);
  return r ? createHmac("sha256", r.hash).update("goto-poker-owner-v1").digest("hex") : null;
}

export function isOwnerToken(db: DatabaseSync, token: string | undefined) {
  const t = ownerToken(db);
  return !!t && !!token && safeEqual(token, t);
}

/** Забыли пароль — сбросить (файл-сброс на ноутбуке, см. README) */
export function resetOwnerPassword(db: DatabaseSync, now = Date.now()) {
  db.prepare("DELETE FROM settings WHERE key = 'owner'").run();
  audit(db, "owner.reset", {}, now);
}
