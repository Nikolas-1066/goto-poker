// «Вставить список» в базе: проверить список (кто есть, кто похож, кто новый) и записать всех разом —
// в текущий турнир (карточка «Игроки») или на турнир из расписания. Разбор текста — src/lib/importList.ts.

import type { DatabaseSync } from "node:sqlite";
import { matchLine, parseList, type ListLine, type ListMatch } from "../importList";
import { phoneTail } from "../players";
import type { Db } from "../types";
import { createPlayer, listPlayers } from "./players";
import { getItem } from "./schedule";
import { listSignups, signUp, syncSignups } from "./signups";
import { applyPlayerAction, currentTournament } from "./tournament";

export type ImportTarget = { kind: "tournament" } | { kind: "schedule"; id: number };

export type ImportOption = { id: number; name: string; tail: string; already: boolean };

export type ImportRow = ListLine & {
  match: ListMatch;
  /** Найденный игрок и похожие — с хвостом телефона, чтобы отличить тёзок */
  options: ImportOption[];
};

/** Что записать: игрок из базы или новый (ник + телефон) */
export type ImportItem = { playerId: number } | { name: string; phone: string };

export function parseTarget(v: unknown): ImportTarget {
  const t = (v ?? {}) as { kind?: unknown; id?: unknown };
  if (t.kind === "tournament") return { kind: "tournament" };
  if (t.kind === "schedule" && Number.isInteger(Number(t.id))) return { kind: "schedule", id: Number(t.id) };
  throw new Error("Не выбрано, куда записывать");
}

/** Кто уже записан туда, куда вставляем */
function alreadyIn(db: DatabaseSync, target: ImportTarget): Set<number> {
  if (target.kind === "tournament") {
    const rows = db.prepare("SELECT player_id FROM participants WHERE tournament_id = ?").all(currentTournament(db).id) as { player_id: number }[];
    return new Set(rows.map((r) => r.player_id));
  }
  const item = getItem(db, target.id);
  return new Set(listSignups(db, item).flatMap((s) => (s.playerId != null ? [s.playerId] : [])));
}

/** Проверить список: ничего не меняет */
export function checkList(db: DatabaseSync, text: string, target: ImportTarget): ImportRow[] {
  const players = listPlayers(db);
  const byId = new Map(players.map((p) => [p.id, p]));
  const already = alreadyIn(db, target);
  const option = (id: number): ImportOption => {
    const p = byId.get(id)!;
    return { id, name: p.name, tail: phoneTail(p.phone), already: already.has(id) };
  };
  return parseList(text).map((row) => {
    const match = matchLine(row, players);
    const ids = match.kind === "found" ? [match.playerId] : match.kind === "choose" ? match.candidates : [];
    return { ...row, match, options: ids.map(option) };
  });
}

/**
 * Записать всех. Новые игроки заводятся в базе (нужен телефон). Кто уже записан — пропускается.
 * Вызывается внутри updateDb: ошибка с новым игроком (например, телефон занят) откатывает всё.
 */
export function applyList(db: DatabaseSync, next: Db, target: ImportTarget, items: unknown, now = Date.now()) {
  if (!Array.isArray(items) || !items.length) throw new Error("Список пуст");
  if (items.length > 200) throw new Error("Слишком длинный список");
  if (target.kind === "schedule") {
    const item = getItem(db, target.id);
    if (item.status === "cancelled") throw new Error("Этот турнир отменён");
  }
  const already = alreadyIn(db, target);
  let added = 0;
  let created = 0;
  const skipped: string[] = [];
  for (const raw of items as ImportItem[]) {
    let playerId: number;
    if (raw && typeof raw === "object" && "playerId" in raw) {
      playerId = Number(raw.playerId);
    } else {
      const r = (raw ?? {}) as { name?: unknown; phone?: unknown };
      try {
        playerId = createPlayer(db, { name: r.name, phone: r.phone }, now).id;
      } catch (err) {
        throw new Error(`«${String(r.name ?? "")}»: ${err instanceof Error ? err.message : "не получилось добавить"}`);
      }
      created += 1;
    }
    if (already.has(playerId)) continue;
    already.add(playerId);
    try {
      if (target.kind === "tournament") applyPlayerAction(db, next, { type: "register", playerId }, now);
      else signUp(db, target.id, { playerId }, {}, now);
      added += 1;
    } catch (err) {
      const name = (db.prepare("SELECT name FROM players WHERE id = ?").get(playerId) as { name: string } | undefined)?.name ?? "?";
      skipped.push(`${name} — ${err instanceof Error ? err.message : "ошибка"}`);
    }
  }
  // турнир из расписания уже открыт — записанные сразу попадают в него
  if (target.kind === "schedule") syncSignups(db, next, target.id, now);
  return { added, created, skipped };
}
