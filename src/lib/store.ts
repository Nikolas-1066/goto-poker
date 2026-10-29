// Серверное хранилище: база SQLite data/goto-poker.db (см. src/lib/db/).
// При первом запуске туда автоматически переносится старый data/goto-poker.json.
// Резервные копии — в data/backups/ при запуске и при завершении турнира (см. db/backup.ts).
// Если SQLite не запустилась, а перенос ещё не делался — работаем по-старому, на JSON-файле.
// Путь к папке данных можно поменять через DATA_DIR.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { backupDatabase, finishedNow, type BackupReason } from "./db/backup";
import { freshDb, normalizeLegacy, openStore, transaction, writeState } from "./db/sqlite";
import type { Db } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
// Имя файла — строкой прямо здесь: так сборщик понимает путь и не тащит в пакет весь проект.
const JSON_FILE = path.join(DATA_DIR, "goto-poker.json");

type StoreGlobal = {
  db: Db | null;
  sqlite: DatabaseSync | null;
  queue: Promise<unknown>;
};
const g = globalThis as unknown as { __gotoStore?: StoreGlobal };
const store: StoreGlobal = (g.__gotoStore ??= { db: null, sqlite: null, queue: Promise.resolve() });

async function load(): Promise<Db> {
  if (store.db) return store.db;
  try {
    const opened = openStore(DATA_DIR);
    if (opened.initialized === "json") console.log("[store] данные перенесены из goto-poker.json в goto-poker.db");
    store.sqlite = opened.db;
    store.db = opened.state;
    safeBackup("start");
  } catch (err) {
    // Запасной путь — только пока данные ещё не переехали в базу (JSON на месте).
    if (!(await exists(JSON_FILE))) throw err;
    console.error("[store] SQLite не запустилась, работаю на goto-poker.json", err);
    store.db = await loadJson();
  }
  return store.db;
}

async function save(prev: Db, next: Db) {
  if (store.sqlite) {
    const sqlite = store.sqlite;
    transaction(sqlite, () => writeState(sqlite, prev, next));
    if (finishedNow(prev, next)) safeBackup("finish");
  } else {
    await persistJson(next);
  }
}

/** Резервная копия; если не получилась — пишем в журнал, но турнир не останавливаем. */
function safeBackup(reason: BackupReason) {
  if (!store.sqlite) return;
  try {
    backupDatabase(store.sqlite, DATA_DIR, reason);
  } catch (err) {
    console.error(`[store] не удалось сделать резервную копию (${reason})`, err);
  }
}

export async function readDb(): Promise<Db> {
  await store.queue;
  return load();
}

/** Последовательно применить изменение и записать на диск. */
export function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = store.queue.then(async () => {
    const db = await load();
    const draft = structuredClone(db);
    const result = await fn(draft);
    await save(db, draft);
    store.db = draft;
    return result;
  });
  store.queue = run.catch(() => {});
  return run;
}

// ---------- Запасной режим: старый JSON-файл ----------

async function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

async function loadJson(): Promise<Db> {
  try {
    return normalizeLegacy(JSON.parse(await fs.readFile(JSON_FILE, "utf8")));
  } catch (err) {
    // Файл повреждён — сохраняем копию, чтобы ничего не потерять, и начинаем заново.
    await fs.copyFile(JSON_FILE, `${JSON_FILE}.broken-${Date.now()}`).catch(() => {});
    console.error("[store] не удалось прочитать базу, создана новая", err);
    const db = freshDb();
    await persistJson(db);
    return db;
  }
}

async function persistJson(db: Db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${JSON_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, JSON_FILE);
}
