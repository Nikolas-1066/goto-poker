// Правила рейтинга в базе (таблица rating_rules) — с версиями.
// Каждое сохранение — новая версия; турнир помнит, по какой версии посчитан (tournaments.rules_id),
// поэтому смена правил не меняет прошлое, пока владелец сам не нажмёт «Пересчитать».

import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_RULES, sanitizeRules, type RatingRules } from "../rating/points";
import { audit } from "./sqlite";

export type RulesVersion = { id: number; createdAt: number; rules: RatingRules };

function parse(row: { id: number; created_at: number; rules_json: string }): RulesVersion {
  // старая версия могла не знать новых полей — дополняем значениями по умолчанию
  const saved = JSON.parse(row.rules_json) as Partial<RatingRules>;
  return {
    id: row.id,
    createdAt: row.created_at,
    rules: { ...DEFAULT_RULES, ...saved, statusCoef: { ...DEFAULT_RULES.statusCoef, ...saved.statusCoef }, elo: { ...DEFAULT_RULES.elo, ...saved.elo } },
  };
}

/** Правила конкретной версии (по ней посчитан турнир); null — нет такой */
export function rulesById(db: DatabaseSync, id: number): RulesVersion | null {
  const row = db.prepare("SELECT id, created_at, rules_json FROM rating_rules WHERE id = ?").get(id) as
    | { id: number; created_at: number; rules_json: string }
    | undefined;
  return row ? parse(row) : null;
}

/** Текущие правила; при первом обращении записываются правила по умолчанию из RATING.md */
export function currentRules(db: DatabaseSync, now = Date.now()): RulesVersion {
  const row = db.prepare("SELECT id, created_at, rules_json FROM rating_rules ORDER BY id DESC LIMIT 1").get() as
    | { id: number; created_at: number; rules_json: string }
    | undefined;
  if (row) return parse(row);
  const id = Number(
    db.prepare("INSERT INTO rating_rules (created_at, rules_json) VALUES (?, ?)").run(now, JSON.stringify(DEFAULT_RULES)).lastInsertRowid,
  );
  return { id, createdAt: now, rules: structuredClone(DEFAULT_RULES) };
}

/** Сохранить правила новой версией (если что-то поменялось). Бросает Error с понятным текстом. */
export function saveRules(db: DatabaseSync, input: unknown, now = Date.now()): { version: RulesVersion; changed: boolean } {
  const rules = sanitizeRules(input);
  const cur = currentRules(db, now);
  if (JSON.stringify(cur.rules) === JSON.stringify(rules)) return { version: cur, changed: false };
  const id = Number(
    db.prepare("INSERT INTO rating_rules (created_at, rules_json) VALUES (?, ?)").run(now, JSON.stringify(rules)).lastInsertRowid,
  );
  audit(db, "rules.save", { id, before: cur.rules, after: rules }, now);
  return { version: { id, createdAt: now, rules }, changed: true };
}
