// Настройки клуба для рейтинга и табло (таблица settings, ключ «rating»).

import type { DatabaseSync } from "node:sqlite";
import { audit } from "./sqlite";

export type PeriodKind = "month" | "season" | "year";

export type ClubSettings = {
  /** Сезонный и годовой рейтинги (и их финалы) можно выключить */
  seasonEnabled: boolean;
  yearEnabled: boolean;
  /** Сколько проходит в финал — по умолчанию для новых периодов */
  finalistsN: Record<PeriodKind, number>;
  /** Табло: сколько секунд показывать каждый экран рейтинга и сколько строк в топе */
  boardSeconds: number;
  boardTop: number;
};

export const DEFAULT_SETTINGS: ClubSettings = {
  seasonEnabled: true,
  yearEnabled: true,
  finalistsN: { month: 9, season: 18, year: 27 },
  boardSeconds: 25,
  boardTop: 10,
};

export function getSettings(db: DatabaseSync): ClubSettings {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'rating'").get() as { value_json: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const s = JSON.parse(row.value_json) as Partial<ClubSettings>;
  return { ...DEFAULT_SETTINGS, ...s, finalistsN: { ...DEFAULT_SETTINGS.finalistsN, ...s.finalistsN } };
}

const int = (v: unknown, name: string, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name}: целое число от ${min} до ${max}`);
  return n;
};

/** Сохранить настройки (частично). Бросает Error с понятным текстом. */
export function saveSettings(db: DatabaseSync, patch: unknown, now = Date.now()): ClubSettings {
  const cur = getSettings(db);
  const p = (patch ?? {}) as Partial<Record<keyof ClubSettings, unknown>>;
  const fn = (p.finalistsN ?? {}) as Partial<Record<PeriodKind, unknown>>;
  const next: ClubSettings = {
    seasonEnabled: p.seasonEnabled === undefined ? cur.seasonEnabled : !!p.seasonEnabled,
    yearEnabled: p.yearEnabled === undefined ? cur.yearEnabled : !!p.yearEnabled,
    finalistsN: {
      month: fn.month === undefined ? cur.finalistsN.month : int(fn.month, "Финалистов месяца", 1, 500),
      season: fn.season === undefined ? cur.finalistsN.season : int(fn.season, "Финалистов сезона", 1, 500),
      year: fn.year === undefined ? cur.finalistsN.year : int(fn.year, "Финалистов года", 1, 500),
    },
    boardSeconds: p.boardSeconds === undefined ? cur.boardSeconds : int(p.boardSeconds, "Секунд на экран", 5, 600),
    boardTop: p.boardTop === undefined ? cur.boardTop : int(p.boardTop, "Строк в топе", 3, 30),
  };
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('rating', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(next),
  );
  if (JSON.stringify(cur) !== JSON.stringify(next)) audit(db, "settings.save", { before: cur, after: next }, now);
  return next;
}
