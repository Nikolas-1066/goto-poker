// База SQLite (встроенный в Node модуль node:sqlite — без нативных зависимостей).
// Здесь: открытие базы, миграции, перенос старого goto-poker.json и чтение/запись
// состояния в том же виде (Db), с которым уже работают табло и админка.

import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { emptyTournament } from "../clock";
import { defaultPresets, sanitizePrices, withPresetDefaults } from "../presets";
import type { Db, Preset, Step, Tournament } from "../types";
import { MIGRATIONS } from "./schema";

// fs берём «из Node» во время работы: иначе сборщик Next.js видит работу с файлами
// по неизвестному пути и тащит в пакет весь проект (data/, dist/ и т.д.).
const fs = process.getBuiltinModule("node:fs");

export const DB_FILE_NAME = "goto-poker.db";
export const LEGACY_JSON_NAME = "goto-poker.json";

/** Открыть (или создать) файл базы и довести схему до последней версии. */
export function openDatabase(file: string): DatabaseSync {
  // Модуль берём «из Node» во время работы, чтобы сборщик Next.js его не трогал.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(file);
  try {
    // WAL + FULL: запись переживает внезапное выключение ноутбука и STOP.bat
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

export function schemaVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

export function migrate(db: DatabaseSync) {
  const current = schemaVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `База создана более новой версией программы (схема ${current}, эта программа знает до ${MIGRATIONS.length}). Обновите программу.`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Выполнить всё внутри одной транзакции: либо всё записалось, либо ничего. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DatabaseSync, key: string, value: string) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function audit(db: DatabaseSync, action: string, details: unknown, at = Date.now()) {
  db.prepare("INSERT INTO audit_log (at, action, details_json) VALUES (?, ?, ?)").run(at, action, JSON.stringify(details ?? {}));
}

// ---------- Состояние табло/админки (Db) ----------

export function freshDb(): Db {
  return { version: 1, presets: defaultPresets(), tournament: emptyTournament() };
}

/** Привести содержимое старого goto-poker.json к текущему виду (как раньше делал store.ts). */
export function normalizeLegacy(parsed: unknown): Db {
  const p = (parsed ?? {}) as Partial<Db>;
  const t: Tournament = { ...emptyTournament(), ...(p.tournament ?? {}) };
  if (t.structure) t.structure = withPresetDefaults(t.structure);
  return {
    version: 1,
    presets: Array.isArray(p.presets) ? p.presets.map((x) => withPresetDefaults(x)) : [],
    tournament: t,
  };
}

type PresetRow = {
  id: string;
  name: string;
  description: string | null;
  starting_stack: number;
  rebuy_stack: number;
  addon_stack: number;
  double_addon_stack: number;
  rebuy_until_level: number;
  addon_until_level: number;
  steps_json: string;
  prices_json: string;
  updated_at: number;
};

type TournamentRow = {
  name: string;
  mode: Tournament["mode"];
  preset_id: string | null;
  structure_json: string | null;
  status: Tournament["status"];
  step_index: number;
  step_ends_at: number | null;
  remaining_ms: number;
  elapsed_base_ms: number;
  run_started_at: number | null;
  entries: number;
  players_left: number;
  rebuys: number;
  addons: number;
  double_addons: number;
  burned_chips: number;
  updated_at: number;
};

type BoardRow = { combination: string; ticker: string; ticker_on: number };

function presetFromRow(r: PresetRow): Preset {
  return {
    id: r.id,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    startingStack: r.starting_stack,
    rebuyStack: r.rebuy_stack,
    addonStack: r.addon_stack,
    doubleAddonStack: r.double_addon_stack,
    rebuyUntilLevel: r.rebuy_until_level,
    addonUntilLevel: r.addon_until_level,
    prices: sanitizePrices(JSON.parse(r.prices_json || "{}")),
    steps: JSON.parse(r.steps_json) as Step[],
    updatedAt: r.updated_at,
  };
}

/** Прочитать всё, что нужно табло и админке. */
export function loadState(db: DatabaseSync): Db {
  const presets = (db.prepare("SELECT * FROM presets ORDER BY sort_order, rowid").all() as PresetRow[]).map(presetFromRow);
  const row = db.prepare("SELECT * FROM tournaments WHERE is_current = 1").get() as TournamentRow | undefined;
  const board = (db.prepare("SELECT * FROM board WHERE id = 1").get() as BoardRow | undefined) ?? {
    combination: "",
    ticker: "",
    ticker_on: 0,
  };
  const base = emptyTournament();
  const tournament: Tournament = row
    ? {
        name: row.name,
        presetId: row.preset_id,
        structure: row.structure_json ? withPresetDefaults(JSON.parse(row.structure_json)) : null,
        mode: row.mode,
        status: row.status,
        stepIndex: row.step_index,
        stepEndsAt: row.step_ends_at,
        remainingMs: row.remaining_ms,
        elapsedBaseMs: row.elapsed_base_ms,
        runStartedAt: row.run_started_at,
        entries: row.entries,
        playersLeft: row.players_left,
        rebuys: row.rebuys,
        addons: row.addons,
        doubleAddons: row.double_addons,
        burnedChips: row.burned_chips ?? 0,
        combination: board.combination,
        ticker: board.ticker,
        tickerOn: board.ticker_on === 1,
        updatedAt: row.updated_at,
      }
    : { ...base, combination: board.combination, ticker: board.ticker, tickerOn: board.ticker_on === 1 };
  return { version: 1, presets, tournament };
}

/**
 * Записать изменения между `prev` и `next` (prev = null — записать всё).
 * Транзакцию открывает вызывающий код.
 */
export function writeState(db: DatabaseSync, prev: Db | null, next: Db) {
  const prevPresets = new Map((prev?.presets ?? []).map((p, i) => [p.id, { p, i }]));
  const nextIds = new Set(next.presets.map((p) => p.id));

  const del = db.prepare("DELETE FROM presets WHERE id = ?");
  for (const id of prevPresets.keys()) if (!nextIds.has(id)) del.run(id);

  const upsert = db.prepare(`
    INSERT INTO presets (id, name, description, starting_stack, rebuy_stack, addon_stack, double_addon_stack,
                         rebuy_until_level, addon_until_level, prices_json, steps_json, sort_order, updated_at)
    VALUES (:id, :name, :description, :starting_stack, :rebuy_stack, :addon_stack, :double_addon_stack,
            :rebuy_until_level, :addon_until_level, :prices_json, :steps_json, :sort_order, :updated_at)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, description = excluded.description, starting_stack = excluded.starting_stack,
      rebuy_stack = excluded.rebuy_stack, addon_stack = excluded.addon_stack,
      double_addon_stack = excluded.double_addon_stack, rebuy_until_level = excluded.rebuy_until_level,
      addon_until_level = excluded.addon_until_level, prices_json = excluded.prices_json,
      steps_json = excluded.steps_json,
      sort_order = excluded.sort_order, updated_at = excluded.updated_at`);
  next.presets.forEach((p, i) => {
    const old = prevPresets.get(p.id);
    if (old && old.i === i && JSON.stringify(old.p) === JSON.stringify(p)) return;
    upsert.run({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      starting_stack: p.startingStack,
      rebuy_stack: p.rebuyStack,
      addon_stack: p.addonStack,
      double_addon_stack: p.doubleAddonStack,
      rebuy_until_level: p.rebuyUntilLevel,
      addon_until_level: p.addonUntilLevel,
      prices_json: JSON.stringify(p.prices ?? {}),
      steps_json: JSON.stringify(p.steps),
      sort_order: i,
      updated_at: p.updatedAt,
    });
  });

  const t = next.tournament;
  if (prev && JSON.stringify(prev.tournament) === JSON.stringify(t)) return;

  const values = {
    name: t.name,
    preset_id: t.presetId,
    structure_json: t.structure ? JSON.stringify(t.structure) : null,
    mode: t.mode === "players" ? "players" : "manual",
    status: t.status,
    step_index: t.stepIndex,
    step_ends_at: t.stepEndsAt,
    remaining_ms: t.remainingMs,
    elapsed_base_ms: t.elapsedBaseMs,
    run_started_at: t.runStartedAt,
    entries: t.entries,
    players_left: t.playersLeft,
    rebuys: t.rebuys,
    addons: t.addons,
    double_addons: t.doubleAddons ?? 0,
    burned_chips: t.burnedChips ?? 0,
    updated_at: t.updatedAt,
  };
  const updated = db
    .prepare(`
      UPDATE tournaments SET
        name = :name, preset_id = :preset_id, structure_json = :structure_json, mode = :mode, status = :status,
        step_index = :step_index, step_ends_at = :step_ends_at, remaining_ms = :remaining_ms,
        elapsed_base_ms = :elapsed_base_ms, run_started_at = :run_started_at,
        entries = :entries, players_left = :players_left, rebuys = :rebuys, addons = :addons,
        double_addons = :double_addons, burned_chips = :burned_chips, updated_at = :updated_at,
        started_at  = CASE WHEN :status = 'idle' THEN NULL ELSE COALESCE(started_at, :updated_at) END,
        finished_at = CASE WHEN :status = 'finished' THEN COALESCE(finished_at, :updated_at) ELSE NULL END
      WHERE is_current = 1`)
    .run(values);
  if (updated.changes === 0) {
    db.prepare(`
      INSERT INTO tournaments (name, preset_id, structure_json, mode, status, step_index, step_ends_at, remaining_ms,
                               elapsed_base_ms, run_started_at, entries, players_left, rebuys, addons, double_addons, burned_chips,
                               is_current, created_at, updated_at, started_at, finished_at)
      VALUES (:name, :preset_id, :structure_json, :mode, :status, :step_index, :step_ends_at, :remaining_ms,
              :elapsed_base_ms, :run_started_at, :entries, :players_left, :rebuys, :addons, :double_addons, :burned_chips,
              1, :updated_at, :updated_at,
              CASE WHEN :status = 'idle' THEN NULL ELSE :updated_at END,
              CASE WHEN :status = 'finished' THEN :updated_at ELSE NULL END)`).run(values);
  }

  db.prepare(`
    INSERT INTO board (id, combination, ticker, ticker_on) VALUES (1, :combination, :ticker, :ticker_on)
    ON CONFLICT (id) DO UPDATE SET combination = excluded.combination, ticker = excluded.ticker, ticker_on = excluded.ticker_on`).run({
    combination: t.combination,
    ticker: t.ticker,
    ticker_on: t.tickerOn ? 1 : 0,
  });
}

// ---------- Первый запуск: создание базы и перенос goto-poker.json ----------

/** 2026-10-29_18-30-05 по местному времени — понятно человеку и безопасно для имени файла в Windows. */
export function stamp(now: number) {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export type OpenedStore = {
  db: DatabaseSync;
  state: Db;
  /** Что произошло при первом запуске (для журнала сервера); null — база уже была */
  initialized: "new" | "json" | "json-broken" | null;
};

/**
 * Открыть базу в папке данных. При самом первом запуске перенести старый goto-poker.json
 * (пресеты, текущий турнир, табло). Сам JSON не удаляется: копия — в backups/,
 * исходник переименовывается в goto-poker.json.migrated.
 */
export function openStore(dataDir: string, now = Date.now()): OpenedStore {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, DB_FILE_NAME));
  try {
    if (getMeta(db, "initialized_at")) return { db, state: loadState(db), initialized: null };

    const jsonFile = path.join(dataDir, LEGACY_JSON_NAME);
    let source: "new" | "json" | "json-broken" = "new";
    let state = freshDb();
    if (fs.existsSync(jsonFile)) {
      try {
        state = normalizeLegacy(JSON.parse(fs.readFileSync(jsonFile, "utf8")));
        source = "json";
      } catch (err) {
        // Повреждённый файл: откладываем в сторону, чтобы ничего не потерять, и начинаем с пресетов по умолчанию.
        fs.renameSync(jsonFile, `${jsonFile}.broken-${stamp(now)}`);
        console.error("[store] goto-poker.json повреждён, отложен в сторону; создана новая база", err);
        source = "json-broken";
      }
    }

    transaction(db, () => {
      writeState(db, null, state);
      setMeta(db, "initialized_at", String(now));
      setMeta(db, "initial_source", source);
      audit(db, "init", { source, presets: state.presets.length }, now);
    });

    if (source === "json") {
      try {
        const backups = path.join(dataDir, "backups");
        fs.mkdirSync(backups, { recursive: true });
        fs.copyFileSync(jsonFile, path.join(backups, `goto-poker-before-sqlite-${stamp(now)}.json`));
        fs.renameSync(jsonFile, `${jsonFile}.migrated`);
      } catch (err) {
        // Данные уже в базе; JSON просто останется рядом и больше не читается.
        console.error("[store] не удалось переименовать goto-poker.json после переноса", err);
      }
    }
    return { db, state: loadState(db), initialized: source };
  } catch (err) {
    db.close();
    throw err;
  }
}
