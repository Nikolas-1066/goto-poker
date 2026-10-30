// Рейтинг для табло (docs/RATING.md, раздел 7). Табло открыто без пароля, поэтому здесь
// только имена, очки, места и нокауты — без телефонов и прочих данных игроков.

import type { DatabaseSync } from "node:sqlite";
import { placesPreview, type TournamentKind } from "../rating/points";
import { formatPlace } from "../results";
import { openPeriod, standingsOf } from "./periods";
import { currentRules } from "./rules";
import { getSettings } from "./settings";
import { currentTournament, listParticipants } from "./tournament";

export type BoardRow = { name: string; value: string };

export type BoardRating = {
  /** Сколько секунд показывать каждый экран */
  seconds: number;
  month: { title: string; rows: BoardRow[] } | null;
  all: { rows: BoardRow[] } | null;
  players: { playing: number; total: number; finished: boolean; rows: (BoardRow & { out: boolean })[] } | null;
  preview: { field: number; final: boolean; rows: BoardRow[] } | null;
};

const fmtKo = (ko: number) => (ko ? `KO ${String(ko).replace(".", ",")}` : "");

export function boardRating(db: DatabaseSync, now = Date.now()): BoardRating {
  const settings = getSettings(db);
  const top = settings.boardTop;

  const monthPeriod = openPeriod(db, "month");
  const monthTable = monthPeriod ? standingsOf(db, monthPeriod) : [];
  const allTable = standingsOf(db, "all");

  const cur = currentTournament(db);
  const status = (db.prepare("SELECT status FROM tournaments WHERE id = ?").get(cur.id) as { status: string }).status;
  const people = listParticipants(db, cur.id, status === "finished").filter((p) => p.status !== "registered");
  const playing = people.filter((p) => p.status === "playing");

  const rules = currentRules(db, now).rules;
  const kind = cur.kind as TournamentKind;

  return {
    seconds: settings.boardSeconds,
    month:
      monthPeriod && monthTable.length
        ? { title: monthPeriod.name, rows: monthTable.slice(0, top).map((s) => ({ name: s.name, value: String(s.points) })) }
        : null,
    all: allTable.length ? { rows: allTable.slice(0, top).map((s) => ({ name: s.name, value: String(s.points) })) } : null,
    players: people.length
      ? {
          playing: playing.length,
          total: people.length,
          finished: status === "finished",
          // завершённый турнир — итоги по местам; идущий — сначала кто в игре (по нокаутам), потом вылетевшие
          rows: status === "finished"
            ? [...people]
                .sort((a, b) => (a.place ?? 999) - (b.place ?? 999))
                .map((p) => ({ name: p.place != null ? `${formatPlace(p)}. ${p.name}` : p.name, value: fmtKo(p.ko), out: false }))
            : [
            ...[...playing].sort((a, b) => b.ko - a.ko || a.name.localeCompare(b.name, "ru")).map((p) => ({ name: p.name, value: fmtKo(p.ko), out: false })),
            ...people
              .filter((p) => p.status !== "playing")
              .sort((a, b) => (a.place ?? 999) - (b.place ?? 999))
              .map((p) => ({ name: `${formatPlace(p)}. ${p.name}`, value: fmtKo(p.ko), out: true })),
          ],
        }
      : null,
    preview: people.length
      ? {
          field: people.length,
          final: kind !== "regular",
          rows: placesPreview(people.length, kind, rules).map((r) => ({
            name: r.from === r.to ? `${r.from} место` : `${r.from}–${r.to} места`,
            value: String(r.points),
          })),
        }
      : null,
  };
}
