// Настройки рассадки клуба (таблица settings, ключ «seating»): мест за столом и автопосадка.
// Общие для всех турниров: поменяли в одном — так и останется для следующих.

import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_SEATING, sanitizeSeating, type SeatingSettings } from "../seating";
import { audit } from "./sqlite";

export function getSeating(db: DatabaseSync): SeatingSettings {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'seating'").get() as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_SEATING };
  try {
    return sanitizeSeating(JSON.parse(row.value_json));
  } catch {
    return { ...DEFAULT_SEATING };
  }
}

export function saveSeating(db: DatabaseSync, patch: unknown, now = Date.now()): SeatingSettings {
  const cur = getSeating(db);
  const next = sanitizeSeating(patch, cur);
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('seating', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(next),
  );
  if (JSON.stringify(cur) !== JSON.stringify(next)) audit(db, "seating.save", { before: cur, after: next }, now);
  return next;
}
