// Участники текущего турнира: запись, «пришёл», re-entry, аддоны, вылеты с нокаутами, отмена.
// Всё вызывается внутри транзакции записи (WriteHook в store.ts) и правит счётчики табло в Db.

import type { DatabaseSync } from "node:sqlite";
import { applyAction, boardView } from "../clock";
import { phoneTail } from "../players";
import { MAX_SEATS, MAX_TABLES } from "../seating";
import {
  checkAction,
  computeResults,
  formatPlace,
  knockerShares,
  type CheckContext,
  type EventType,
  type JournalEvent,
} from "../results";
import type { Db, Tournament, TournamentMode } from "../types";
import { finalizeResults } from "./history";
import { audit } from "./sqlite";

export type ParticipantStatus = "registered" | "playing" | "busted";

/** Участник для админки */
export type ParticipantView = {
  id: number;
  playerId: number;
  name: string;
  phoneTail: string;
  status: ParticipantStatus;
  entries: number;
  reentries: number;
  addons: number;
  doubleAddons: number;
  ko: number;
  place: number | null;
  placeTo: number | null;
  registeredAt: number;
  arrivedAt: number | null;
  tableNo: number | null;
  seatNo: number | null;
  /** Событие последнего вылета (для отмены) и кто выбил */
  lastBustEventId: number | null;
  knockedOutBy: string[];
  /** Аддон игрока — для отмены в любой момент */
  addonEventId: number | null;
};

export type PlayerAction =
  /** Записать на турнир заранее (ещё не пришёл) */
  | { type: "register"; playerId: number }
  /** Убрать из записавшихся (только если ещё не входил) */
  | { type: "unregister"; participantId: number }
  /** «Пришёл» — первый вход. Можно сразу по игроку из базы, без предварительной записи */
  | { type: "enter"; participantId?: number; playerId?: number; force?: boolean }
  | { type: "reentry"; participantId: number; force?: boolean }
  | { type: "addon"; participantId: number; force?: boolean }
  | { type: "double_addon"; participantId: number; force?: boolean }
  /**
   * Вылет. Один игрок или несколько в одной раздаче (handOrder: 1 — больший стек,
   * одинаковый — равные стеки). knockers: никого (ушёл сам), один или двое (делёж банка, по 0,5).
   */
  | { type: "bust"; busted: { participantId: number; handOrder: number }[]; knockers: number[] }
  /** Отменить действие; вылет в общей раздаче отменяется целиком */
  | { type: "cancel"; eventId: number }
  /** Посадить за стол (1–3) и место (1–10); null — убрать. Без автобалансировки */
  | { type: "seat"; participantId: number; tableNo: number | null; seatNo: number | null }
  /** Завершить турнир. Если в игре несколько (дил) — dealOrder: их порядок по местам */
  | { type: "finish"; dealOrder?: number[] }
  | { type: "setMode"; mode: TournamentMode };

/** Что вернуть админке после действия: сообщение для подсказки и что можно отменить */
export type PlayerActionResult = { message: string; undoEventId: number | null };

/** Ошибка, которую админ может обойти подтверждением («Регистрация закрыта. Всё равно?») */
export class NeedsForceError extends Error {}

type TournamentRowInfo = { id: number; kind: string };

export function currentTournament(db: DatabaseSync): TournamentRowInfo {
  const row = db.prepare("SELECT id, kind FROM tournaments WHERE is_current = 1").get() as TournamentRowInfo | undefined;
  if (!row) throw new Error("Турнир не найден");
  return row;
}

/** Журнал турнира в виде, который понимает results.ts */
export function loadJournal(db: DatabaseSync, tournamentId: number): JournalEvent[] {
  const events = db
    .prepare(
      `SELECT id, participant_id, type, at, hand_id, hand_order, cancelled_at
       FROM events WHERE tournament_id = ? ORDER BY at, id`,
    )
    .all(tournamentId) as {
    id: number;
    participant_id: number;
    type: EventType;
    at: number;
    hand_id: number | null;
    hand_order: number | null;
    cancelled_at: number | null;
  }[];
  const kos = db
    .prepare(
      `SELECT k.bust_event_id, k.knocker_participant_id, k.share FROM knockouts k
       JOIN events e ON e.id = k.bust_event_id WHERE e.tournament_id = ?`,
    )
    .all(tournamentId) as { bust_event_id: number; knocker_participant_id: number; share: number }[];
  return events.map((e) => ({
    id: e.id,
    participantId: e.participant_id,
    type: e.type,
    at: e.at,
    handId: e.hand_id,
    handOrder: e.hand_order,
    cancelled: e.cancelled_at != null,
    knockers: kos
      .filter((k) => k.bust_event_id === e.id)
      .map((k) => ({ participantId: k.knocker_participant_id, share: k.share })),
  }));
}

export function listParticipants(db: DatabaseSync, tournamentId: number, finished = false): ParticipantView[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.player_id, p.registered_at, p.arrived_at, p.table_no, p.seat_no, p.place AS saved_place,
              p.place_to AS saved_place_to, p.ko AS saved_ko, pl.name, pl.phone
       FROM participants p JOIN players pl ON pl.id = p.player_id
       WHERE p.tournament_id = ?`,
    )
    .all(tournamentId) as {
    id: number;
    player_id: number;
    registered_at: number;
    arrived_at: number | null;
    table_no: number | null;
    seat_no: number | null;
    saved_place: number | null;
    saved_place_to: number | null;
    saved_ko: number;
    name: string;
    phone: string;
  }[];
  const journal = loadJournal(db, tournamentId);
  const res = computeResults(journal, { finished });
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const list = rows.map((r): ParticipantView => {
    const x = res.participants.get(r.id);
    const bust = x?.lastBustId != null ? journal.find((e) => e.id === x.lastBustId) : undefined;
    return {
      id: r.id,
      playerId: r.player_id,
      name: r.name,
      phoneTail: phoneTail(r.phone),
      status: x?.status ?? "registered",
      entries: x?.entries ?? 0,
      reentries: x?.reentries ?? 0,
      addons: x?.addons ?? 0,
      doubleAddons: x?.doubleAddons ?? 0,
      // после завершения — сохранённые итоги (в них учтён дил и исправления)
      ko: finished && r.saved_place != null ? r.saved_ko : (x?.ko ?? 0),
      place: finished && r.saved_place != null ? r.saved_place : (x?.place ?? null),
      placeTo: finished && r.saved_place != null ? r.saved_place_to : (x?.placeTo ?? null),
      registeredAt: r.registered_at,
      arrivedAt: r.arrived_at,
      tableNo: r.table_no,
      seatNo: r.seat_no,
      lastBustEventId: x?.lastBustId ?? null,
      addonEventId: x?.addonEventId ?? null,
      knockedOutBy: (bust?.knockers ?? []).map((k) => names.get(k.participantId) ?? "?"),
    };
  });
  const rank = { playing: 0, registered: 1, busted: 2 } as const;
  if (finished) return list.sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999) || a.name.localeCompare(b.name, "ru"));
  return list.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.place ?? 0) - (b.place ?? 0) ||
      a.name.localeCompare(b.name, "ru"),
  );
}

/** Что сейчас разрешено по часам турнира */
function context(t: Tournament, kind: string, now: number, force?: boolean) {
  const view = boardView(t, now);
  const finished = t.status === "finished";
  return {
    // первый вход: до старта — всегда, после — пока открыты ребаи (поздняя регистрация)
    entryOpen: !finished && (t.status === "idle" || view.rebuyOpen),
    reentryOpen: !finished && view.rebuyOpen,
    addonOpen: !finished && view.addonOpen,
    isFinal: kind !== "regular",
    levelNo: view.levelNumber,
    force: !!force,
  };
}

function participantName(db: DatabaseSync) {
  const stmt = db.prepare("SELECT pl.name FROM participants p JOIN players pl ON pl.id = p.player_id WHERE p.id = ?");
  return (id: number) => (stmt.get(id) as { name: string } | undefined)?.name ?? "Игрок";
}

function participantOf(db: DatabaseSync, tournamentId: number, participantId: number) {
  const row = db.prepare("SELECT id, player_id FROM participants WHERE id = ? AND tournament_id = ?").get(participantId, tournamentId) as
    | { id: number; player_id: number }
    | undefined;
  if (!row) throw new Error("Участник не найден");
  return row;
}

/** Ошибка проверки → обычная или «можно подтвердить» */
function fail(message: string | null, canForce: boolean) {
  if (!message) return;
  if (canForce && (message === "Регистрация закрыта" || message === "Аддоны закрыты")) throw new NeedsForceError(message);
  throw new Error(message);
}

/**
 * Выполнить действие с участником. Вызывать внутри транзакции записи (WriteHook):
 * пишет в participants/events и обновляет счётчики табло в `next`.
 */
export function applyPlayerAction(db: DatabaseSync, next: Db, action: PlayerAction, now = Date.now()): PlayerActionResult {
  const t = next.tournament;
  const cur = currentTournament(db);
  const ctx = context(t, cur.kind, now, "force" in action ? action.force : false);
  const name = participantName(db);
  const journal = () => loadJournal(db, cur.id);
  const check = (a: Parameters<typeof checkAction>[1], c: Partial<CheckContext>) =>
    checkAction(journal(), a, { reentryOpen: true, addonOpen: true, isFinal: ctx.isFinal, force: ctx.force, ...c }, name);
  const addEvent = (participantId: number, type: EventType, hand?: { id: number; order: number }) =>
    Number(
      db
        .prepare(
          "INSERT INTO events (tournament_id, participant_id, type, at, level_no, hand_id, hand_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(cur.id, participantId, type, now, ctx.levelNo, hand?.id ?? null, hand?.order ?? null).lastInsertRowid,
    );
  let message = "";
  let undoEventId: number | null = null;

  if (t.status === "finished" && action.type !== "setMode") {
    throw new Error("Турнир завершён. Исправить итоги можно в «Истории»");
  }

  switch (action.type) {
    case "register": {
      const player = db.prepare("SELECT id FROM players WHERE id = ? AND archived_at IS NULL").get(action.playerId);
      if (!player) throw new Error("Игрок не найден");
      const exists = db.prepare("SELECT id FROM participants WHERE tournament_id = ? AND player_id = ?").get(cur.id, action.playerId);
      if (exists) throw new Error("Игрок уже записан на этот турнир");
      const pid = Number(
        db
          .prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at) VALUES (?, ?, 'registered', ?)")
          .run(cur.id, action.playerId, now).lastInsertRowid,
      );
      message = `${name(pid)} записан(а)`;
      break;
    }
    case "unregister": {
      const p = participantOf(db, cur.id, action.participantId);
      const used = db.prepare("SELECT 1 FROM events WHERE participant_id = ? AND cancelled_at IS NULL LIMIT 1").get(p.id);
      if (used) throw new Error(`${name(p.id)} уже в турнире — убрать из записи нельзя`);
      message = `${name(p.id)} убран(а) из записи`;
      db.prepare("DELETE FROM participants WHERE id = ?").run(p.id);
      break;
    }
    case "enter": {
      let participantId = action.participantId;
      if (participantId == null) {
        if (action.playerId == null) throw new Error("Не выбран игрок");
        const found = db.prepare("SELECT id FROM participants WHERE tournament_id = ? AND player_id = ?").get(cur.id, action.playerId) as
          | { id: number }
          | undefined;
        if (found) participantId = found.id;
        else {
          const player = db.prepare("SELECT id FROM players WHERE id = ? AND archived_at IS NULL").get(action.playerId);
          if (!player) throw new Error("Игрок не найден");
          participantId = Number(
            db
              .prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at) VALUES (?, ?, 'registered', ?)")
              .run(cur.id, action.playerId, now).lastInsertRowid,
          );
        }
      }
      const p = participantOf(db, cur.id, participantId);
      fail(check({ type: "entry", participantId: p.id }, { reentryOpen: ctx.entryOpen }), true);
      undoEventId = addEvent(p.id, "entry");
      message = `${name(p.id)} в игре`;
      db.prepare("UPDATE participants SET arrived_at = COALESCE(arrived_at, ?) WHERE id = ?").run(now, p.id);
      db.prepare("UPDATE players SET first_visit_at = COALESCE(first_visit_at, ?) WHERE id = ?").run(now, p.player_id);
      break;
    }
    case "reentry": {
      const p = participantOf(db, cur.id, action.participantId);
      fail(check({ type: "reentry", participantId: p.id }, { reentryOpen: ctx.reentryOpen }), true);
      undoEventId = addEvent(p.id, "reentry");
      message = `${name(p.id)} — re-entry`;
      break;
    }
    case "addon":
    case "double_addon": {
      const p = participantOf(db, cur.id, action.participantId);
      fail(check({ type: action.type, participantId: p.id }, { addonOpen: ctx.addonOpen }), true);
      undoEventId = addEvent(p.id, action.type);
      message = `${name(p.id)} — ${action.type === "addon" ? "аддон" : "двойной аддон"}`;
      break;
    }
    case "bust": {
      const busted = Array.isArray(action.busted) ? action.busted : [];
      const knockers = Array.isArray(action.knockers) ? action.knockers.map(Number) : [];
      for (const b of busted) participantOf(db, cur.id, b.participantId);
      for (const k of knockers) participantOf(db, cur.id, k);
      fail(check({ type: "bust", busted, knockers }, {}), false);
      // несколько вылетевших в одной раздаче — общий номер раздачи
      const hand =
        busted.length > 1
          ? ((db.prepare("SELECT MAX(hand_id) AS m FROM events WHERE tournament_id = ?").get(cur.id) as { m: number | null }).m ?? 0) + 1
          : null;
      const shares = knockerShares(knockers);
      const ko = db.prepare("INSERT INTO knockouts (bust_event_id, knocker_participant_id, share) VALUES (?, ?, ?)");
      for (const b of busted) {
        const order = Math.max(1, Math.round(Number(b.handOrder) || 1));
        const id = addEvent(b.participantId, "bust", hand != null ? { id: hand, order } : undefined);
        for (const k of shares) ko.run(id, k.participantId, k.share);
        undoEventId ??= id;
      }
      const res = computeResults(journal());
      const who = busted.map((b) => `${name(b.participantId)} — ${formatPlace(res.participants.get(b.participantId)!)} место`);
      message = `${who.join(", ")}${knockers.length ? `, KO: ${knockers.map(name).join(" и ")}` : ""}`;
      break;
    }
    case "cancel": {
      const e = db
        .prepare("SELECT id, participant_id, type, hand_id FROM events WHERE id = ? AND tournament_id = ? AND cancelled_at IS NULL")
        .get(action.eventId, cur.id) as { id: number; participant_id: number; type: EventType; hand_id: number | null } | undefined;
      if (!e) throw new Error("Это действие уже отменено");
      // вылет в общей раздаче отменяется вместе с остальными вылетевшими в ней
      const group =
        e.type === "bust" && e.hand_id != null
          ? (db
              .prepare("SELECT id FROM events WHERE tournament_id = ? AND hand_id = ? AND cancelled_at IS NULL ORDER BY id DESC")
              .all(cur.id, e.hand_id) as { id: number }[])
          : [{ id: e.id }];
      const mark = db.prepare("UPDATE events SET cancelled_at = ? WHERE id = ?");
      for (const g of group) {
        fail(check({ type: "cancel", eventId: g.id }, {}), false);
        mark.run(now, g.id);
      }
      const what = { entry: "вход", reentry: "re-entry", addon: "аддон", double_addon: "двойной аддон", bust: "вылет" }[e.type];
      message = `Отменено: ${what} — ${name(e.participant_id)}${group.length > 1 ? ` и ещё ${group.length - 1}` : ""}`;
      audit(db, "tournament.cancel", { tournamentId: cur.id, eventIds: group.map((g) => g.id) }, now);
      break;
    }
    case "seat": {
      const p = participantOf(db, cur.id, action.participantId);
      const table = action.tableNo == null ? null : Number(action.tableNo);
      const seat = table == null || action.seatNo == null ? null : Number(action.seatNo);
      if (table != null && !(Number.isInteger(table) && table >= 1 && table <= MAX_TABLES)) throw new Error(`Стол — от 1 до ${MAX_TABLES}`);
      if (seat != null && !(Number.isInteger(seat) && seat >= 1 && seat <= MAX_SEATS)) throw new Error(`Место — от 1 до ${MAX_SEATS}`);
      if (table != null && seat != null) {
        // место занято другим игроком, который сейчас в игре или записан
        const res = computeResults(journal());
        const taken = (
          db
            .prepare("SELECT id FROM participants WHERE tournament_id = ? AND table_no = ? AND seat_no = ? AND id <> ?")
            .all(cur.id, table, seat, p.id) as { id: number }[]
        ).find((x) => res.participants.get(x.id)?.status !== "busted");
        if (taken) throw new Error(`Стол ${table}, место ${seat} уже занято: ${name(taken.id)}`);
      }
      db.prepare("UPDATE participants SET table_no = ?, seat_no = ? WHERE id = ?").run(table, seat, p.id);
      message = table == null ? `${name(p.id)} — без стола` : `${name(p.id)} — стол ${table}${seat != null ? `, место ${seat}` : ""}`;
      break;
    }
    case "finish": {
      Object.assign(t, applyAction(t, { type: "finish" }, now, () => undefined));
      finalizeResults(db, cur.id, action.dealOrder, now);
      const winner = db
        .prepare(
          `SELECT pl.name FROM participants p JOIN players pl ON pl.id = p.player_id
           WHERE p.tournament_id = ? AND p.place = 1`,
        )
        .get(cur.id) as { name: string } | undefined;
      message = winner ? `Турнир завершён. Победитель — ${winner.name}` : "Турнир завершён";
      break;
    }
    case "setMode": {
      if (action.mode !== "manual" && action.mode !== "players") throw new Error("Неизвестный режим");
      t.mode = action.mode;
      message = action.mode === "players" ? "Учёт по игрокам" : "Учёт вручную";
      audit(db, "tournament.mode", { tournamentId: cur.id, mode: action.mode }, now);
      break;
    }
    default:
      throw new Error("Неизвестное действие");
  }

  syncTournament(db, next, now);
  return { message, undoEventId };
}

/**
 * Привести кэш статусов участников и счётчики табло в соответствие с журналом.
 * Счётчики меняются только в режиме «по игрокам»; updatedAt — всегда (табло увидит изменения).
 */
export function syncTournament(db: DatabaseSync, next: Db, now = Date.now()) {
  const t = next.tournament;
  const cur = currentTournament(db);
  const res = computeResults(loadJournal(db, cur.id), { finished: t.status === "finished" });
  // у завершённого турнира статусы и итоги уже сохранены (finalizeResults) — их не трогаем
  if (t.status !== "finished") {
    const upd = db.prepare("UPDATE participants SET status = ?, entries = ? WHERE id = ?");
    for (const p of db.prepare("SELECT id FROM participants WHERE tournament_id = ?").all(cur.id) as { id: number }[]) {
      const r = res.participants.get(p.id);
      upd.run(r?.status ?? "registered", r?.entries ?? 0, p.id);
    }
  }
  if (t.mode === "players") Object.assign(t, res.counters);
  t.updatedAt = Math.max(now, t.updatedAt + 1);
}

/**
 * Начать турнир заново (кнопка «Сбросить турнир»): журнал входов/вылетов очищается,
 * все участники снова «записались».
 */
export function resetParticipants(db: DatabaseSync, next: Db, now = Date.now()) {
  const cur = currentTournament(db);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM events WHERE tournament_id = ?").get(cur.id) as { n: number }).n;
  if (n > 0) {
    db.prepare("DELETE FROM events WHERE tournament_id = ?").run(cur.id);
    db.prepare(
      "UPDATE participants SET status = 'registered', arrived_at = NULL, entries = 0, ko = 0, place = NULL, place_to = NULL WHERE tournament_id = ?",
    ).run(cur.id);
    audit(db, "tournament.reset", { tournamentId: cur.id, events: n }, now);
  }
  syncTournament(db, next, now);
}

/**
 * Загружается новая структура (новый турнир). Если в текущем уже кто-то играл или шло время —
 * он уходит в историю, а новый турнир пишется отдельной строкой (writeState создаст её сам).
 */
export function archiveCurrentIfUsed(db: DatabaseSync, now = Date.now()) {
  const row = db
    .prepare(
      `SELECT t.id, t.status, t.entries,
              (SELECT COUNT(*) FROM participants p WHERE p.tournament_id = t.id) AS participants
       FROM tournaments t WHERE t.is_current = 1`,
    )
    .get() as { id: number; status: string; entries: number; participants: number } | undefined;
  if (!row) return false;
  if (row.status === "idle" && row.entries === 0 && row.participants === 0) return false;
  db.prepare("UPDATE tournaments SET is_current = 0 WHERE id = ?").run(row.id);
  audit(db, "tournament.archive", { tournamentId: row.id }, now);
  return true;
}
