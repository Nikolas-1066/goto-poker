// Серверное хранилище: один JSON-файл на диске (data/goto-poker.json).
// Для одного клуба этого достаточно; путь можно поменять через DATA_DIR.

import { promises as fs } from "node:fs";
import path from "node:path";
import { emptyTournament } from "./clock";
import { defaultPresets, withPresetDefaults } from "./presets";
import type { Db } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "goto-poker.json");

type StoreGlobal = { db: Db | null; queue: Promise<unknown> };
const g = globalThis as unknown as { __gotoStore?: StoreGlobal };
const store: StoreGlobal = (g.__gotoStore ??= { db: null, queue: Promise.resolve() });

function freshDb(): Db {
  return { version: 1, presets: defaultPresets(), tournament: emptyTournament() };
}

async function load(): Promise<Db> {
  if (store.db) return store.db;
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw) as Db;
    const t = { ...emptyTournament(), ...parsed.tournament };
    if (t.structure) t.structure = withPresetDefaults(t.structure);
    store.db = {
      version: 1,
      presets: Array.isArray(parsed.presets) ? parsed.presets.map((p) => withPresetDefaults(p)) : [],
      tournament: t,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // Файл повреждён — сохраняем копию, чтобы ничего не потерять, и начинаем заново.
      await fs.copyFile(DB_FILE, `${DB_FILE}.broken-${Date.now()}`).catch(() => {});
      console.error("[store] не удалось прочитать базу, создана новая", err);
    }
    store.db = freshDb();
    await persist(store.db);
  }
  return store.db;
}

async function persist(db: Db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DB_FILE);
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
    await persist(draft);
    store.db = draft;
    return result;
  });
  store.queue = run.catch(() => {});
  return run;
}
