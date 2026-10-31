// Резервные копии базы в data/backups/: при каждом запуске сервера и при завершении турнира.
// Копия — обычный файл .db, целый и самостоятельный (VACUUM INTO), даже если идёт запись.

import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "../types";
import { stamp } from "./sqlite";

// Как и в sqlite.ts: fs «из Node», чтобы сборщик не тащил в пакет весь проект.
const fs = process.getBuiltinModule("node:fs");

export type BackupReason = "start" | "finish";

/** Сколько копий каждого вида хранить. */
export const KEEP_BACKUPS = 30;

const NAME = /^goto-poker-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:-(\d+))?-(start|finish)\.db$/;

export function backupsDir(dataDir: string) {
  return path.join(dataDir, "backups");
}

/** Сделать копию базы и удалить лишние старые. Возвращает путь к новой копии. */
export function backupDatabase(db: DatabaseSync, dataDir: string, reason: BackupReason, now = Date.now()): string {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `goto-poker-${stamp(now)}-${reason}.db`);
  // две копии в одну секунду — добавляем номер
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `goto-poker-${stamp(now)}-${n}-${reason}.db`);
  db.prepare("VACUUM INTO ?").run(file);
  pruneBackups(dir, KEEP_BACKUPS);
  return file;
}

/** Оставить по `keep` самых новых копий каждого вида. Другие файлы в папке не трогаем. */
export function pruneBackups(dir: string, keep: number) {
  const byReason = new Map<string, { name: string; key: string }[]>();
  for (const name of fs.readdirSync(dir)) {
    const m = NAME.exec(name);
    if (!m) continue;
    const list = byReason.get(m[3]) ?? [];
    // дата и время из имени + номер копии в ту же секунду → порядок по времени
    list.push({ name, key: `${m[1]}#${(m[2] ?? "1").padStart(4, "0")}` });
    byReason.set(m[3], list);
  }
  for (const list of byReason.values()) {
    list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const { name } of list.slice(0, Math.max(0, list.length - keep))) fs.rmSync(path.join(dir, name), { force: true });
  }
}

/** Нужна ли копия после этого изменения: турнир только что завершили. */
export function finishedNow(prev: Db, next: Db) {
  return prev.tournament.status !== "finished" && next.tournament.status === "finished";
}

/**
 * Копия всей базы одним файлом для скачивания (кнопка в «Статистике»). Делается так же, как резервная
 * (VACUUM INTO — целая и самостоятельная), во временный файл, который сразу удаляется.
 * Вызывать вне транзакции.
 */
export function copyForDownload(db: DatabaseSync, dataDir: string, now = Date.now()): Buffer {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `download-${now}-${process.pid}.db`);
  try {
    db.prepare("VACUUM INTO ?").run(file);
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
