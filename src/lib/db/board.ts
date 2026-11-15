// Рейтинг для табло (docs/RATING.md, раздел 7). Табло открыто без пароля, поэтому здесь
// только имена, очки, места и нокауты — без телефонов и прочих данных игроков.

import type { DatabaseSync } from "node:sqlite";
import { placesPreview, type TournamentKind } from "../rating/points";
import { formatPlace } from "../results";
import { openPeriod, standingsOf } from "./periods";
import { currentRules } from "./rules";
import { getSettings } from "./settings";
import { currentTournament, listParticipants, type ParticipantView } from "./tournament";

export type BoardRow = { name: string; value: string };

export type BoardRating = {
  /** Сколько секунд показывать каждый экран */
  seconds: number;
  month: { title: string; rows: BoardRow[] } | null;
  all: { rows: BoardRow[] } | null;
  players: { playing: number; total: number; finished: boolean; rows: (BoardRow & { out: boolean })[] } | null;
  preview: { field: number; final: boolean; rows: BoardRow[] } | null;
  /** Лидеры по фишкам — только по посчитанным стекам (docs/SEATING.md); null — никого не посчитали */
  chipLeaders: { name: string; stack: number; countedAt: number }[] | null;
  /** Вылеты за последние минуты — для заставки «ВЫЛЕТ» на табло (новые табло показывает один раз) */
  busts: BoardBust[];
};

/** Один вылет (или несколько в одной раздаче): кто вылетел, на каком месте, кто выбил */
export type BoardBust = {
  /** Постоянный ключ: по нему табло понимает, что этот вылет уже показан */
  key: string;
  at: number;
  out: { playerId: number; name: string; place: string }[];
  knockers: { playerId: number; name: string }[];
};

/** Сколько времени вылет считается «свежим» (табло, включённое позже, старые не показывает) */
export const BUST_WINDOW_MS = 5 * 60_000;

/** Свежие вылеты текущего турнира: не отменённые, раздача — одной заставкой */
export function recentBusts(db: DatabaseSync, tournamentId: number, people: ParticipantView[], now = Date.now()): BoardBust[] {
  const events = db
    .prepare(
      `SELECT id, participant_id, at, hand_id, hand_order FROM events
       WHERE tournament_id = ? AND type = 'bust' AND cancelled_at IS NULL AND at > ? ORDER BY at, id`,
    )
    .all(tournamentId, now - BUST_WINDOW_MS) as { id: number; participant_id: number; at: number; hand_id: number | null; hand_order: number | null }[];
  if (!events.length) return [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const kos = db.prepare("SELECT knocker_participant_id FROM knockouts WHERE bust_event_id = ? ORDER BY share DESC, knocker_participant_id");
  const groups = new Map<string, BoardBust>();
  for (const e of events) {
    const key = e.hand_id != null ? `h${tournamentId}:${e.hand_id}` : `e${e.id}`;
    const g = groups.get(key) ?? { key, at: e.at, out: [], knockers: [] };
    const p = byId.get(e.participant_id);
    if (p) g.out.push({ playerId: p.playerId, name: p.name, place: p.place != null ? formatPlace(p) : "" });
    for (const k of kos.all(e.id) as { knocker_participant_id: number }[]) {
      const kp = byId.get(k.knocker_participant_id);
      if (kp && !g.knockers.some((x) => x.playerId === kp.playerId)) g.knockers.push({ playerId: kp.playerId, name: kp.name });
    }
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.out.length > 0);
}

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

  const counted = status === "finished" ? [] : playing.filter((p) => p.stack.counted && p.stack.countedAt != null);
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
    busts: status === "finished" ? [] : recentBusts(db, cur.id, people, now),
    chipLeaders: counted.length
      ? [...counted]
          .sort((a, b) => b.stack.value - a.stack.value || a.name.localeCompare(b.name, "ru"))
          .slice(0, 3)
          .map((p) => ({ name: p.name, stack: p.stack.value, countedAt: p.stack.countedAt! }))
      : null,
  };
}
