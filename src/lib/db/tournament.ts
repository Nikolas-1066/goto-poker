// Участники текущего турнира: запись, «пришёл», re-entry, аддоны, вылеты с нокаутами, отмена.
// Всё вызывается внутри транзакции записи (WriteHook в store.ts) и правит счётчики табло в Db.

import type { DatabaseSync } from "node:sqlite";
import {
  CHARGE_LABEL,
  cashByPlayer,
  formatRub,
  friendBonusAllowed,
  isFreeEntryTime,
  PAY_METHOD_LABEL,
  priceOf,
  type ChargeType,
  type PayMethod,
  type PlayerCash,
} from "../cash";
import { applyAction, boardView } from "../clock";
import { phoneTail } from "../players";
import { hintText, MAX_SEATS, MAX_TABLES, pickSeat, playerStack, seatingHint, type PlayerStack, type Seat } from "../seating";
import {
  checkAction,
  computeResults,
  formatPlace,
  knockerShares,
  type CheckContext,
  type EventType,
  type JournalEvent,
} from "../results";
import type { Db, Prices, Tournament, TournamentMode } from "../types";
import { KIND_LABEL, type TournamentKind } from "../rating/points";
import {
  addPayment,
  cancelPayment,
  debtsByPlayer,
  hasPayments,
  loadCharges,
  loadPayments,
  setEventFree,
  type PlayerDebt,
} from "./cash";
import { finalizeResults } from "./history";
import { finalistsOf, getPeriod } from "./periods";
import { getSeating, saveSeating } from "./seating";
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
  /** Последний вход / re-entry игрока в игре — для отмены мисклика «Пришёл» */
  lastEntryEventId: number | null;
  lastEntryType: "entry" | "reentry" | null;
  /** Очки рейтинга и ELO до/после (после завершения турнира) */
  points: number | null;
  eloBefore: number | null;
  eloAfter: number | null;
  /** Касса игрока в этом турнире (docs/CASH.md) */
  cash: PlayerCash;
  /** Долги игрока с прошлых турниров */
  oldDebts: PlayerDebt[];
  /** Стек в текущем заходе: расчётный или посчитанный (у игроков в игре) */
  stack: PlayerStack;
};

export type PlayerAction =
  /** Записать на турнир заранее (ещё не пришёл) */
  | { type: "register"; playerId: number }
  /** Убрать из записавшихся (только если ещё не входил) */
  | { type: "unregister"; participantId: number }
  /** «Пришёл» — первый вход. Можно сразу по игроку из базы, без предварительной записи */
  | { type: "enter"; participantId?: number; playerId?: number; force?: boolean; pay?: PayMethod }
  | { type: "reentry"; participantId: number; force?: boolean }
  | { type: "addon"; participantId: number; force?: boolean }
  | { type: "double_addon"; participantId: number; force?: boolean }
  /**
   * Вылет. Один игрок или несколько в одной раздаче (handOrder: 1 — больший стек,
   * одинаковый — равные стеки). knockers: никого (ушёл сам), один или двое (делёж банка, по 0,5).
   */
  | {
      type: "bust";
      /** burned — сколько фишек игрок сжёг (ушёл сам, без нокаута); вычитается из среднего стека */
      busted: { participantId: number; handOrder: number; burned?: number }[];
      knockers: number[];
    }
  /** Отменить действие; вылет в общей раздаче отменяется целиком */
  | { type: "cancel"; eventId: number }
  /** Посадить за стол (1–3) и место (1–10); null — убрать */
  | { type: "seat"; participantId: number; tableNo: number | null; seatNo: number | null }
  /** Пересадить нескольких сразу (подсказки «Пересадите» / «Закройте стол») */
  | { type: "seatMany"; moves: { participantId: number; tableNo: number; seatNo: number }[] }
  /** Посадить автоматически (первый стол с местом, случайное свободное место) */
  | { type: "autoSeat"; participantId: number }
  /** Настройки рассадки: мест за столом, автопосадка при «Пришёл» и re-entry */
  | { type: "setSeating"; seatsPerTable?: number; autoSeat?: boolean }
  /** Вписать посчитанный стек (null — убрать, снова расчётный) */
  | { type: "setStack"; participantId: number; stack: number | null }
  /**
   * Сделать турнир финалом закрытого периода (или обычным: periodId = null). Только до старта,
   * пока никто не вошёл. Финалисты записываются автоматически; записать можно только их.
   */
  | { type: "setFinal"; periodId: number | null }
  /** Записать финалистов, которых ещё нет в записи (например, добавили wildcard) */
  | { type: "registerFinalists" }
  /** Завершить турнир. Если в игре несколько (дил) — dealOrder: их порядок по местам */
  | { type: "finish"; dealOrder?: number[] }
  | { type: "setMode"; mode: TournamentMode }
  /** «Приведи друга»: отметить, кто привёл этого новичка (by = null — пришёл сам) */
  | { type: "setBroughtBy"; participantId: number; by: number | null }
  /** Касса: отметить вход / re-entry / аддон бесплатным или снять отметку */
  | { type: "setFree"; eventId: number; free: boolean }
  /**
   * Касса: принять оплату (не больше долга игрока за этот турнир).
   * tournamentId — оплата долга за прошлый турнир
   */
  | { type: "pay"; participantId: number; amount: number; method: PayMethod; tournamentId?: number }
  /** Касса: отменить ошибочную оплату */
  | { type: "cancelPayment"; paymentId: number };

/** Касса работает и после завершения турнира */
const CASH_ACTIONS = new Set<PlayerAction["type"]>(["setFree", "pay", "cancelPayment"]);

/** Что вернуть админке после действия: сообщение для подсказки и что можно отменить */
export type PlayerActionResult = {
  message: string;
  undoEventId: number | null;
  /** Куда посадили (автопосадка) — админка показывает крупно */
  seat?: Seat | null;
};

/** Ошибка, которую админ может обойти подтверждением («Регистрация закрыта. Всё равно?») */
export class NeedsForceError extends Error {}

type TournamentRowInfo = { id: number; kind: string; final_of_period_id: number | null };

export function currentTournament(db: DatabaseSync): TournamentRowInfo {
  const row = db.prepare("SELECT id, kind, final_of_period_id FROM tournaments WHERE is_current = 1").get() as
    | TournamentRowInfo
    | undefined;
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
              p.place_to AS saved_place_to, p.ko AS saved_ko, p.points, p.elo_before, p.elo_after, pl.name, pl.phone,
              p.stack_count, p.stack_count_at
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
    points: number | null;
    elo_before: number | null;
    elo_after: number | null;
    name: string;
    phone: string;
    stack_count: number | null;
    stack_count_at: number | null;
  }[];
  const journal = loadJournal(db, tournamentId);
  const stacks = stacksOf(db, tournamentId);
  const res = computeResults(journal, { finished });
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const cash = cashByPlayer(loadCharges(db, tournamentId), loadPayments(db, tournamentId));
  const debts = debtsByPlayer(db, { exceptTournamentId: tournamentId });
  const list = rows.map((r): ParticipantView => {
    const x = res.participants.get(r.id);
    const bust = x?.lastBustId != null ? journal.find((e) => e.id === x.lastBustId) : undefined;
    const lastIn =
      x?.status === "playing"
        ? [...journal].reverse().find((e) => e.participantId === r.id && !e.cancelled && (e.type === "entry" || e.type === "reentry"))
        : undefined;
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
      lastEntryEventId: lastIn?.id ?? null,
      lastEntryType: lastIn ? (lastIn.type as "entry" | "reentry") : null,
      points: finished ? r.points : null,
      eloBefore: finished ? r.elo_before : null,
      eloAfter: finished ? r.elo_after : null,
      knockedOutBy: (bust?.knockers ?? []).map((k) => names.get(k.participantId) ?? "?"),
      cash: cash.get(r.player_id) ?? {
        charged: 0,
        free: 0,
        paid: 0,
        byMethod: { cash: 0, card: 0, transfer: 0 },
        debt: 0,
        charges: [],
        payments: [],
      },
      oldDebts: debts.get(r.player_id) ?? [],
      stack:
        x?.status === "playing"
          ? playerStack(
              stacks,
              journal
                .filter((e) => e.participantId === r.id && !e.cancelled && e.type !== "bust")
                .map((e) => ({ type: e.type as "entry" | "reentry" | "addon" | "double_addon", at: e.at })),
              r.stack_count != null && r.stack_count_at != null ? { stack: r.stack_count, at: r.stack_count_at } : null,
            )
          : { value: 0, counted: false, countedAt: null },
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

/** Стеки структуры турнира (старт, ребай, аддон, двойной аддон) — для расчётного стека игрока */
function stacksOf(db: DatabaseSync, tournamentId: number) {
  const row = db.prepare("SELECT structure_json FROM tournaments WHERE id = ?").get(tournamentId) as { structure_json: string | null } | undefined;
  const s = row?.structure_json ? (JSON.parse(row.structure_json) as Partial<Record<string, number>>) : {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    startingStack: n(s.startingStack),
    rebuyStack: n(s.rebuyStack),
    addonStack: n(s.addonStack),
    doubleAddonStack: n(s.doubleAddonStack ?? n(s.addonStack) * 2),
  };
}

/** Что сейчас разрешено по часам турнира */
function context(t: Tournament, kind: string, now: number, force?: boolean) {
  const view = boardView(t, now);
  const finished = t.status === "finished";
  return {
    // первый вход: до старта — всегда, после — пока открыты ребаи (поздняя регистрация)
    // + «дозапись» админом в первом уровне после закрытия (view.rebuyLate / addonLate)
    entryOpen: !finished && (t.status === "idle" || view.rebuyOpen || view.rebuyLate),
    reentryOpen: !finished && (view.rebuyOpen || view.rebuyLate),
    addonOpen: !finished && (view.addonOpen || view.addonLate),
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

// ---------- Бонус «приведи друга» ----------

/** Новичок — в других турнирах клуба ещё не играл */
function isNewcomer(db: DatabaseSync, tournamentId: number, playerId: number) {
  return !db
    .prepare(
      `SELECT 1 FROM participants p
       WHERE p.player_id = ? AND p.tournament_id <> ?
         AND (p.place IS NOT NULL OR EXISTS (SELECT 1 FROM events e WHERE e.participant_id = p.id AND e.type = 'entry' AND e.cancelled_at IS NULL))
       LIMIT 1`,
    )
    .get(playerId, tournamentId);
}

/** Сколько новичков привёл участник (считаются только те, кто вошёл в турнир) и сколько бонусов уже использовал */
function friendCounts(db: DatabaseSync, tournamentId: number, participantId: number) {
  const r = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM participants n WHERE n.tournament_id = ?1 AND n.brought_by = ?2
                 AND EXISTS (SELECT 1 FROM events e WHERE e.participant_id = n.id AND e.type = 'entry' AND e.cancelled_at IS NULL)) AS brought,
              (SELECT COUNT(*) FROM events e WHERE e.participant_id = ?2 AND e.bonus = 'friend' AND e.free = 1 AND e.cancelled_at IS NULL) AS used`,
    )
    .get(tournamentId, participantId) as { brought: number; used: number };
  return r;
}

function friendBonusLeft(db: DatabaseSync, tournamentId: number, participantId: number, prices: Prices | undefined) {
  const c = friendCounts(db, tournamentId, participantId);
  return Math.max(0, friendBonusAllowed(prices, c.brought) - c.used);
}

export type FriendInfo = {
  /** Новичок (раньше не играл) — ему можно указать, кто его привёл */
  newcomer: boolean;
  /** Кто привёл (участник турнира) */
  broughtBy: number | null;
  /** Сколько новичков привёл сам, сколько бонусов положено и осталось */
  brought: number;
  allowed: number;
  left: number;
};

/** «Приведи друга» по всем участникам турнира — для админки: { [participantId]: … } */
export function friendInfo(db: DatabaseSync, tournamentId: number, prices: Prices | undefined): Record<number, FriendInfo> {
  const rows = db.prepare("SELECT id, player_id, brought_by FROM participants WHERE tournament_id = ?").all(tournamentId) as {
    id: number;
    player_id: number;
    brought_by: number | null;
  }[];
  return Object.fromEntries(
    rows.map((r) => {
      const c = friendCounts(db, tournamentId, r.id);
      const allowed = friendBonusAllowed(prices, c.brought);
      return [r.id, { newcomer: isNewcomer(db, tournamentId, r.player_id), broughtBy: r.brought_by, brought: c.brought, allowed, left: Math.max(0, allowed - c.used) }];
    }),
  );
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
  // цена запоминается в момент действия: поменяли цены позже — начисленное не меняется
  const addEvent = (participantId: number, type: EventType, hand?: { id: number; order: number }) =>
    Number(
      db
        .prepare(
          "INSERT INTO events (tournament_id, participant_id, type, at, level_no, hand_id, hand_order, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          cur.id,
          participantId,
          type,
          now,
          ctx.levelNo,
          hand?.id ?? null,
          hand?.order ?? null,
          type === "bust" ? 0 : priceOf(t.structure?.prices, type as ChargeType),
        ).lastInsertRowid,
    );
  /** Долг игрока за этот турнир */
  const debtOf = (playerId: number) => cashByPlayer(loadCharges(db, cur.id), loadPayments(db, cur.id)).get(playerId)?.debt ?? 0;
  /** Занятые места: у игроков в игре и записавшихся (кроме вылетевших) */
  const occupied = (exceptIds: number[] = []) => {
    const res = computeResults(journal());
    return (
      db
        .prepare("SELECT id, table_no, seat_no FROM participants WHERE tournament_id = ? AND table_no IS NOT NULL AND seat_no IS NOT NULL")
        .all(cur.id) as { id: number; table_no: number; seat_no: number }[]
    )
      .filter((x) => !exceptIds.includes(x.id) && res.participants.get(x.id)?.status !== "busted")
      .map((x) => ({ id: x.id, tableNo: x.table_no, seatNo: x.seat_no }));
  };
  const setSeat = (participantId: number, s: Seat | null) =>
    db.prepare("UPDATE participants SET table_no = ?, seat_no = ? WHERE id = ?").run(s?.tableNo ?? null, s?.seatNo ?? null, participantId);
  /**
   * Автопосадка при входе: свой стол оставляем, если он ещё свободен (заранее посадили) и fresh = false;
   * re-entry (fresh) — новое случайное место. Без автопосадки: занятое другим место освобождаем.
   */
  const seatOnEntry = (participantId: number, fresh: boolean): Seat | null | undefined => {
    const me = db.prepare("SELECT table_no, seat_no FROM participants WHERE id = ?").get(participantId) as {
      table_no: number | null;
      seat_no: number | null;
    };
    const others = occupied([participantId]);
    const mineFree = me.table_no != null && me.seat_no != null && !others.some((o) => o.tableNo === me.table_no && o.seatNo === me.seat_no);
    const settings = getSeating(db);
    if (!settings.autoSeat) {
      if (me.table_no != null && !mineFree) setSeat(participantId, null);
      return undefined;
    }
    if (mineFree && !fresh) return { tableNo: me.table_no!, seatNo: me.seat_no! };
    const s = pickSeat(others, settings.seatsPerTable);
    setSeat(participantId, s);
    return s;
  };
  /** «· стол 2, место 1» и, если за столами стало неровно, — сколько кого пересадить */
  const seatText = (s: Seat | null | undefined) => {
    if (s === undefined) return "";
    if (!s) return " · свободных мест за столами нет";
    const hint = seatingHint(occupied(), getSeating(db).seatsPerTable);
    return ` · стол ${s.tableNo}, место ${s.seatNo}${hint ? ` · ${hintText(hint)}` : ""}`;
  };
  let message = "";
  let undoEventId: number | null = null;
  let seated: Seat | null | undefined;
  // бонус «приведи друга»: ребай или аддон бесплатно, пока бонусы не израсходованы
  const friendBonus = (participantId: number, type: "reentry" | "addon", eventId: number) => {
    const prices = t.structure?.prices;
    if (prices?.friendBonus !== type || friendBonusLeft(db, cur.id, participantId, prices) <= 0) return "";
    db.prepare("UPDATE events SET free = 1, bonus = 'friend' WHERE id = ?").run(eventId);
    return " · бесплатно: привёл новичка";
  };

  if (t.status === "finished" && action.type !== "setMode" && !CASH_ACTIONS.has(action.type)) {
    throw new Error("Турнир завершён. Исправить итоги можно в «Истории»");
  }

  switch (action.type) {
    case "register": {
      const player = db.prepare("SELECT id FROM players WHERE id = ? AND archived_at IS NULL").get(action.playerId);
      if (!player) throw new Error("Игрок не найден");
      onlyFinalists(db, cur, action.playerId);
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
      if (hasPayments(db, cur.id, p.player_id)) throw new Error(`У ${name(p.id)} есть оплата — сначала отмените её`);
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
      onlyFinalists(db, cur, p.player_id);
      fail(check({ type: "entry", participantId: p.id }, { reentryOpen: ctx.entryOpen }), true);
      undoEventId = addEvent(p.id, "entry");
      message = `${name(p.id)} в игре`;
      // акция: пришёл до заданного времени — первый вход бесплатный (re-entry и аддоны — платно)
      const freeUntil = t.structure?.prices.freeEntryUntil;
      if (freeUntil && isFreeEntryTime(freeUntil, now)) {
        db.prepare("UPDATE events SET free = 1 WHERE id = ?").run(undoEventId);
        message += ` · вход бесплатный (до ${freeUntil})`;
      }
      // «Пришёл + оплатил» — сразу закрыть долг за турнир
      if (action.pay) {
        const debt = debtOf(p.player_id);
        if (debt > 0) {
          addPayment(db, { tournamentId: cur.id, playerId: p.player_id, amount: debt, method: action.pay }, now);
          message += `, оплачено ${formatRub(debt)}`;
        }
      }
      db.prepare("UPDATE participants SET arrived_at = COALESCE(arrived_at, ?) WHERE id = ?").run(now, p.id);
      db.prepare("UPDATE players SET first_visit_at = COALESCE(first_visit_at, ?) WHERE id = ?").run(now, p.player_id);
      seated = seatOnEntry(p.id, false);
      message += seatText(seated);
      break;
    }
    case "reentry": {
      const p = participantOf(db, cur.id, action.participantId);
      fail(check({ type: "reentry", participantId: p.id }, { reentryOpen: ctx.reentryOpen }), true);
      undoEventId = addEvent(p.id, "reentry");
      message = `${name(p.id)} — re-entry`;
      message += friendBonus(p.id, "reentry", undoEventId);
      seated = seatOnEntry(p.id, true);
      message += seatText(seated);
      break;
    }
    case "addon":
    case "double_addon": {
      const p = participantOf(db, cur.id, action.participantId);
      fail(check({ type: action.type, participantId: p.id }, { addonOpen: ctx.addonOpen }), true);
      undoEventId = addEvent(p.id, action.type);
      message = `${name(p.id)} — ${action.type === "addon" ? "аддон" : "двойной аддон"}`;
      if (action.type === "addon") message += friendBonus(p.id, "addon", undoEventId);
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
      const burnedOf = (b: { burned?: unknown }) => Math.min(100_000_000, Math.max(0, Math.round(Number(b.burned) || 0)));
      if (knockers.length && busted.some((b) => burnedOf(b) > 0)) {
        throw new Error("Сжечь стек можно только при вылете без нокаута");
      }
      for (const b of busted) {
        const order = Math.max(1, Math.round(Number(b.handOrder) || 1));
        const id = addEvent(b.participantId, "bust", hand != null ? { id: hand, order } : undefined);
        for (const k of shares) ko.run(id, k.participantId, k.share);
        if (burnedOf(b) > 0) db.prepare("UPDATE events SET burned = ? WHERE id = ?").run(burnedOf(b), id);
        undoEventId ??= id;
      }
      const res = computeResults(journal());
      const who = busted.map(
        (b) =>
          `${name(b.participantId)} — ${formatPlace(res.participants.get(b.participantId)!)} место` +
          (burnedOf(b) > 0 ? `, сжёг стек ${burnedOf(b).toLocaleString("ru-RU")}` : ""),
      );
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
      // отмена «Пришёл + оплатил» — снимается и оплата, принятая этим же нажатием
      let refund = 0;
      if (e.type === "entry") {
        const ev = db.prepare("SELECT e.at, p.player_id FROM events e JOIN participants p ON p.id = e.participant_id WHERE e.id = ?").get(e.id) as {
          at: number;
          player_id: number;
        };
        const paid = db
          .prepare("SELECT id, amount FROM payments WHERE tournament_id = ? AND player_id = ? AND at = ? AND cancelled_at IS NULL")
          .all(cur.id, ev.player_id, ev.at) as { id: number; amount: number }[];
        for (const x of paid) {
          cancelPayment(db, cur.id, x.id, now);
          refund += x.amount;
        }
      }
      // отменили «Пришёл» — место, выданное автопосадкой, освобождается
      if (e.type === "entry" && getSeating(db).autoSeat) setSeat(e.participant_id, null);
      const what = { entry: "вход", reentry: "re-entry", addon: "аддон", double_addon: "двойной аддон", bust: "вылет" }[e.type];
      message = `Отменено: ${what} — ${name(e.participant_id)}${group.length > 1 ? ` и ещё ${group.length - 1}` : ""}`;
      if (refund > 0) message += ` (и оплата ${formatRub(refund)} — верните деньги)`;
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
    case "seatMany": {
      const moves = Array.isArray(action.moves) ? action.moves : [];
      if (!moves.length) throw new Error("Некого пересаживать");
      const ids = moves.map((m) => participantOf(db, cur.id, Number(m.participantId)).id);
      if (new Set(ids).size !== ids.length) throw new Error("Один игрок дважды в пересадке");
      const targets = moves.map((m) => ({ tableNo: Number(m.tableNo), seatNo: Number(m.seatNo) }));
      for (const s of targets) {
        if (!(Number.isInteger(s.tableNo) && s.tableNo >= 1 && s.tableNo <= MAX_TABLES)) throw new Error(`Стол — от 1 до ${MAX_TABLES}`);
        if (!(Number.isInteger(s.seatNo) && s.seatNo >= 1 && s.seatNo <= MAX_SEATS)) throw new Error(`Место — от 1 до ${MAX_SEATS}`);
      }
      // места после пересадки не должны совпадать ни между собой, ни с теми, кто остаётся на месте
      const key = (s: Seat) => `${s.tableNo}/${s.seatNo}`;
      const stay = new Map(occupied(ids).map((o) => [key(o), o.id]));
      const seen = new Set<string>();
      targets.forEach((s) => {
        if (stay.has(key(s))) throw new Error(`Стол ${s.tableNo}, место ${s.seatNo} уже занято: ${name(stay.get(key(s))!)}`);
        if (seen.has(key(s))) throw new Error(`Двое на одно место: стол ${s.tableNo}, место ${s.seatNo}`);
        seen.add(key(s));
      });
      ids.forEach((id, i) => setSeat(id, targets[i]));
      message =
        ids.length === 1
          ? `${name(ids[0])} → стол ${targets[0].tableNo}, место ${targets[0].seatNo}`
          : `Пересажено: ${ids.length} (${ids.map((id, i) => `${name(id)} → ${targets[i].tableNo}/${targets[i].seatNo}`).join(", ")})`;
      audit(db, "tournament.seatMany", { tournamentId: cur.id, moves }, now);
      break;
    }
    case "autoSeat": {
      const p = participantOf(db, cur.id, action.participantId);
      const s = pickSeat(occupied([p.id]), getSeating(db).seatsPerTable);
      if (!s) throw new Error("Свободных мест за столами нет — увеличьте «мест за столом» или посадите вручную");
      setSeat(p.id, s);
      seated = s;
      message = `${name(p.id)}${seatText(s)}`;
      break;
    }
    case "setSeating": {
      const s = saveSeating(db, { seatsPerTable: action.seatsPerTable, autoSeat: action.autoSeat }, now);
      message = `Столы: мест за столом ${s.seatsPerTable} · автопосадка ${s.autoSeat ? "вкл" : "выкл"}`;
      break;
    }
    case "setStack": {
      const p = participantOf(db, cur.id, action.participantId);
      if (action.stack == null) {
        db.prepare("UPDATE participants SET stack_count = NULL, stack_count_at = NULL WHERE id = ?").run(p.id);
        message = `${name(p.id)}: стек снова расчётный`;
        break;
      }
      const stack = Number(action.stack);
      if (!Number.isInteger(stack) || stack < 0 || stack > 1_000_000_000) throw new Error("Стек — целое число фишек");
      db.prepare("UPDATE participants SET stack_count = ?, stack_count_at = ? WHERE id = ?").run(stack, now, p.id);
      message = `${name(p.id)}: стек ${stack.toLocaleString("ru-RU")}`;
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
    case "setFinal": {
      if (t.status !== "idle" || journal().some((e) => !e.cancelled)) {
        throw new Error("Тип турнира меняется до старта, пока никто не вошёл");
      }
      if (action.periodId == null) {
        db.prepare("UPDATE tournaments SET kind = 'regular', final_of_period_id = NULL WHERE id = ?").run(cur.id);
        message = "Обычный турнир";
        audit(db, "tournament.final", { tournamentId: cur.id, periodId: null }, now);
        break;
      }
      const period = getPeriod(db, Number(action.periodId));
      if (!period) throw new Error("Период не найден");
      if (period.closedAt == null) throw new Error(`Период «${period.name}» ещё не закрыт — сначала закройте его в «Рейтинге»`);
      const other = db.prepare("SELECT id FROM tournaments WHERE final_of_period_id = ? AND id <> ?").get(period.id, cur.id);
      if (other) throw new Error(`Финал периода «${period.name}» уже создан`);
      const finalists = new Set(finalistsOf(db, period).finalists.map((f) => f.playerId));
      const strangers = (
        db.prepare("SELECT p.id, p.player_id FROM participants p WHERE p.tournament_id = ?").all(cur.id) as { id: number; player_id: number }[]
      ).filter((p) => !finalists.has(p.player_id));
      if (strangers.length) throw new Error(`Это не финалисты — сначала уберите из записи: ${strangers.map((p) => name(p.id)).join(", ")}`);
      const kind = `${period.kind}_final`;
      db.prepare("UPDATE tournaments SET kind = ?, final_of_period_id = ? WHERE id = ?").run(kind, period.id, cur.id);
      const added = registerMissing(db, cur.id, finalists, now);
      message = `${KIND_LABEL[kind as TournamentKind]} «${period.name}»: записано финалистов — ${added}`;
      audit(db, "tournament.final", { tournamentId: cur.id, periodId: period.id, kind }, now);
      break;
    }
    case "registerFinalists": {
      if (cur.final_of_period_id == null) throw new Error("Это не финальный турнир");
      const period = getPeriod(db, cur.final_of_period_id)!;
      const added = registerMissing(db, cur.id, new Set(finalistsOf(db, period).finalists.map((f) => f.playerId)), now);
      message = added ? `Записано финалистов: ${added}` : "Все финалисты уже записаны";
      break;
    }
    case "setMode": {
      if (action.mode !== "manual" && action.mode !== "players") throw new Error("Неизвестный режим");
      t.mode = action.mode;
      message = action.mode === "players" ? "Учёт по игрокам" : "Учёт вручную";
      audit(db, "tournament.mode", { tournamentId: cur.id, mode: action.mode }, now);
      break;
    }
    case "setBroughtBy": {
      const p = participantOf(db, cur.id, action.participantId);
      if (action.by != null) {
        if (Number(action.by) === p.id) throw new Error("Игрок не может привести сам себя");
        participantOf(db, cur.id, Number(action.by));
        if (!isNewcomer(db, cur.id, p.player_id)) throw new Error(`${name(p.id)} уже играл(а) в клубе — бонус только за новичка`);
      }
      db.prepare("UPDATE participants SET brought_by = ? WHERE id = ?").run(action.by == null ? null : Number(action.by), p.id);
      audit(db, "tournament.broughtBy", { tournamentId: cur.id, participantId: p.id, by: action.by ?? null }, now);
      message = action.by == null ? `${name(p.id)} — пришёл сам` : `${name(p.id)} — привёл(а) ${name(Number(action.by))}`;
      break;
    }
    case "setFree": {
      const e = setEventFree(db, cur.id, Number(action.eventId), !!action.free, now);
      const who = db.prepare("SELECT participant_id FROM events WHERE id = ?").get(e.id) as { participant_id: number };
      message = `${CHARGE_LABEL[e.type]} — ${name(who.participant_id)}: ${action.free ? "бесплатно" : "платно"}`;
      break;
    }
    case "pay": {
      const p = participantOf(db, cur.id, action.participantId);
      const amount = Number(action.amount);
      const old = action.tournamentId != null && Number(action.tournamentId) !== cur.id ? Number(action.tournamentId) : null;
      addPayment(db, { tournamentId: old ?? cur.id, playerId: p.player_id, amount, method: action.method }, now);
      const left = old != null ? (debtsByPlayer(db, { playerId: p.player_id }).get(p.player_id)?.find((d) => d.tournamentId === old)?.debt ?? 0) : debtOf(p.player_id);
      message = `${name(p.id)}: принято ${formatRub(amount)} (${PAY_METHOD_LABEL[action.method].toLowerCase()})${
        old != null ? " — долг с прошлого турнира" : ""
      }${left > 0 ? `, осталось ${formatRub(left)}` : ""}`;
      break;
    }
    case "cancelPayment": {
      const row = cancelPayment(db, cur.id, Number(action.paymentId), now);
      const who = (db.prepare("SELECT name FROM players WHERE id = ?").get(row.player_id) as { name: string } | undefined)?.name ?? "Игрок";
      message = `Оплата отменена: ${who}, ${formatRub(row.amount)}`;
      break;
    }
    default:
      throw new Error("Неизвестное действие");
  }

  syncTournament(db, next, now);
  return { message, undoEventId, ...(seated !== undefined ? { seat: seated } : {}) };
}

/** Финал: записать и посадить можно только финалистов периода */
function onlyFinalists(db: DatabaseSync, cur: TournamentRowInfo, playerId: number) {
  if (cur.final_of_period_id == null) return;
  const period = getPeriod(db, cur.final_of_period_id);
  if (!period) return;
  if (finalistsOf(db, period).finalists.some((f) => f.playerId === playerId)) return;
  const who = (db.prepare("SELECT name FROM players WHERE id = ?").get(playerId) as { name: string } | undefined)?.name ?? "Игрок";
  throw new Error(`${who} не в списке финалистов «${period.name}» (добавить можно как wildcard в «Рейтинг → Архив»)`);
}

/** Записать недостающих финалистов; возвращает, сколько добавлено */
function registerMissing(db: DatabaseSync, tournamentId: number, finalists: Set<number>, now: number) {
  const have = new Set(
    (db.prepare("SELECT player_id FROM participants WHERE tournament_id = ?").all(tournamentId) as { player_id: number }[]).map((p) => p.player_id),
  );
  const ins = db.prepare("INSERT INTO participants (tournament_id, player_id, status, registered_at) VALUES (?, ?, 'registered', ?)");
  let added = 0;
  for (const id of finalists) {
    if (have.has(id)) continue;
    ins.run(tournamentId, id, now);
    added += 1;
  }
  return added;
}

/** Тип текущего турнира и закрытые периоды, по которым можно сделать финал — для админки */
export function finalInfo(db: DatabaseSync) {
  const cur = currentTournament(db);
  const period = cur.final_of_period_id != null ? getPeriod(db, cur.final_of_period_id) : null;
  const taken = new Set(
    (db.prepare("SELECT final_of_period_id AS p FROM tournaments WHERE final_of_period_id IS NOT NULL AND id <> ?").all(cur.id) as { p: number }[]).map(
      (r) => r.p,
    ),
  );
  const options = (
    db.prepare("SELECT id, kind, name FROM periods WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 12").all() as {
      id: number;
      kind: "month" | "season" | "year";
      name: string;
    }[]
  )
    .filter((p) => !taken.has(p.id))
    .map((p) => ({ periodId: p.id, label: `${KIND_LABEL[`${p.kind}_final` as TournamentKind]} «${p.name}»` }));
  return {
    kind: cur.kind as TournamentKind,
    final: period ? { periodId: period.id, label: `${KIND_LABEL[cur.kind as TournamentKind]} «${period.name}»` } : null,
    options,
  };
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
  if (t.mode === "players") {
    Object.assign(t, res.counters);
    // сожжённые фишки — сумма по не отменённым вылетам «сжёг стек»
    t.burnedChips = Number(
      (
        db
          .prepare("SELECT COALESCE(SUM(burned), 0) AS s FROM events WHERE tournament_id = ? AND type = 'bust' AND cancelled_at IS NULL")
          .get(cur.id) as { s: number }
      ).s,
    );
  }
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
