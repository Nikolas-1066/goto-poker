// Игроки в базе SQLite (таблица players).

import type { DatabaseSync } from "node:sqlite";
import { formatPhone, validatePlayer, type Player } from "../players";
import { audit } from "./sqlite";

type PlayerRow = {
  id: number;
  name: string;
  phone: string;
  note: string;
  first_visit_at: number | null;
  elo: number;
  created_at: number;
  updated_at: number;
};

const fromRow = (r: PlayerRow): Player => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  note: r.note,
  firstVisitAt: r.first_visit_at,
  elo: r.elo,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Все игроки (без архивных). Для клуба это сотни строк — поиск делаем в памяти. */
export function listPlayers(db: DatabaseSync): Player[] {
  return (db.prepare("SELECT * FROM players WHERE archived_at IS NULL ORDER BY name").all() as PlayerRow[]).map(fromRow);
}

export function getPlayer(db: DatabaseSync, id: number): Player | null {
  const row = db.prepare("SELECT * FROM players WHERE id = ? AND archived_at IS NULL").get(id) as PlayerRow | undefined;
  return row ? fromRow(row) : null;
}

function phoneTaken(db: DatabaseSync, phone: string, exceptId?: number) {
  const row = db.prepare("SELECT id, name FROM players WHERE phone = ? AND id IS NOT ?").get(phone, exceptId ?? null) as
    | { id: number; name: string }
    | undefined;
  if (row) throw new Error(`Телефон ${formatPhone(phone)} уже записан у игрока «${row.name}»`);
}

export function createPlayer(db: DatabaseSync, input: unknown, now = Date.now()): Player {
  const p = validatePlayer(input);
  phoneTaken(db, p.phone);
  const id = Number(
    db
      .prepare("INSERT INTO players (name, phone, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(p.name, p.phone, p.note, now, now).lastInsertRowid,
  );
  audit(db, "player.create", { id, name: p.name }, now);
  return getPlayer(db, id)!;
}

export function updatePlayer(db: DatabaseSync, id: number, input: unknown, now = Date.now()): Player {
  const old = getPlayer(db, id);
  if (!old) throw new Error("Игрок не найден");
  const p = validatePlayer(input);
  phoneTaken(db, p.phone, id);
  db.prepare("UPDATE players SET name = ?, phone = ?, note = ?, updated_at = ? WHERE id = ?").run(p.name, p.phone, p.note, now, id);
  const changed = (["name", "phone", "note"] as const).filter((k) => old[k] !== p[k]);
  if (changed.length) audit(db, "player.update", { id, changed, before: Object.fromEntries(changed.map((k) => [k, old[k]])) }, now);
  return getPlayer(db, id)!;
}
