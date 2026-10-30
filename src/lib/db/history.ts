// Итоги турниров: сохранение при завершении (в т.ч. дил), история, исправление итогов.
// Итоги хранятся «снимком» в participants (place, place_to, entries, ko) — по ним будет
// считаться рейтинг (Этап 2). Журнал events остаётся как есть — это история того, что было.

import type { DatabaseSync } from "node:sqlite";
import { tournamentPoints, type TournamentKind } from "../rating/points";
import { computeResults } from "../results";
import type { ByMethod, CashSummary } from "../cash";
import { tournamentCash } from "./cash";
import { recomputeElo } from "./elo";
import { currentRules, rulesById, type RulesVersion } from "./rules";
import { audit } from "./sqlite";
import { loadJournal } from "./tournament";

/**
 * Сохранить итоги завершённого турнира. Если в игре остались несколько (дил),
 * `dealOrder` — их порядок по местам: [1 место, 2 место, ...].
 */
export function finalizeResults(db: DatabaseSync, tournamentId: number, dealOrder?: number[], now = Date.now()) {
  const res = computeResults(loadJournal(db, tournamentId), { finished: true });
  const playing = [...res.participants.values()].filter((r) => r.status === "playing");
  const isDeal = playing.length > 1;

  if (isDeal) {
    const order = (dealOrder ?? []).map(Number);
    const ids = new Set(playing.map((p) => p.participantId));
    if (order.length !== ids.size || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
      throw new Error(
        `В игре ещё ${playing.length} игрока — расставьте их места: карточка «Игроки», кнопка «Завершить с дилом»`,
      );
    }
    order.forEach((id, i) => {
      const r = res.participants.get(id)!;
      r.place = i + 1;
      r.placeTo = null;
    });
  }

  const upd = db.prepare("UPDATE participants SET status = ?, place = ?, place_to = ?, entries = ?, ko = ? WHERE id = ?");
  const rows = db.prepare("SELECT id FROM participants WHERE tournament_id = ?").all(tournamentId) as { id: number }[];
  for (const { id } of rows) {
    const r = res.participants.get(id);
    if (!r || r.status === null) {
      // записался, но не пришёл
      upd.run("no_show", null, null, 0, 0, id);
      continue;
    }
    upd.run(r.status, r.place, r.placeTo, r.entries, r.ko, id);
  }
  // статус «завершён» — сразу (запись часов идёт после), чтобы турнир попал в пересчёт ELO
  db.prepare("UPDATE tournaments SET deal = ?, status = 'finished', finished_at = COALESCE(finished_at, ?) WHERE id = ?").run(
    isDeal ? 1 : 0,
    now,
    tournamentId,
  );
  scoreTournament(db, tournamentId, currentRules(db, now));
  recomputeElo(db, now);
  audit(db, "tournament.finish", { tournamentId, players: res.fieldSize, deal: isDeal ? dealOrder : undefined }, now);
}

// ---------- История ----------

export type HistoryItem = {
  id: number;
  name: string;
  kind: string;
  mode: "manual" | "players";
  status: string;
  isCurrent: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  /** По игрокам — число участников; вручную — счётчик входов */
  players: number;
  winner: string | null;
  deal: boolean;
  /** Касса: собрано и долги (null — денег в турнире не было) */
  cash: { paid: number; debt: number } | null;
};

export function listHistory(db: DatabaseSync): HistoryItem[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.kind, t.mode, t.status, t.is_current, t.started_at, t.finished_at, t.created_at,
              t.entries, t.deal,
              (SELECT COUNT(*) FROM participants p WHERE p.tournament_id = t.id AND p.status <> 'registered' AND p.status <> 'no_show') AS played,
              (SELECT pl.name FROM participants p JOIN players pl ON pl.id = p.player_id
                WHERE p.tournament_id = t.id AND p.place = 1 ORDER BY pl.name LIMIT 1) AS winner
       FROM tournaments t
       WHERE t.status <> 'idle' OR t.entries > 0
          OR EXISTS (SELECT 1 FROM participants p WHERE p.tournament_id = t.id)
       ORDER BY COALESCE(t.started_at, t.created_at) DESC, t.id DESC`,
    )
    .all() as {
    id: number;
    name: string;
    kind: string;
    mode: "manual" | "players";
    status: string;
    is_current: number;
    started_at: number | null;
    finished_at: number | null;
    created_at: number;
    entries: number;
    deal: number;
    played: number;
    winner: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    mode: r.mode,
    status: r.status,
    isCurrent: r.is_current === 1,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    players: r.mode === "players" || r.played > 0 ? r.played : r.entries,
    winner: r.status === "finished" ? r.winner : null,
    deal: r.deal === 1,
    cash: cashBrief(db, r.id),
  }));
}

export type ResultRow = {
  participantId: number;
  playerId: number;
  name: string;
  place: number | null;
  placeTo: number | null;
  entries: number;
  addons: number;
  doubleAddons: number;
  ko: number;
  /** Очки рейтинга; null — не посчитаны (турнир не завершён или место не выставлено) */
  points: number | null;
  /** ELO до и после турнира */
  eloBefore: number | null;
  eloAfter: number | null;
};

/** Коротко о кассе турнира для списка; null — начислений и оплат не было */
function cashBrief(db: DatabaseSync, id: number) {
  const { summary: s } = tournamentCash(db, id);
  return s.charged === 0 && s.paid === 0 && s.free === 0 ? null : { paid: s.paid, debt: s.debt };
}

/** Касса игрока в итогах турнира */
export type CashRow = {
  playerId: number;
  name: string;
  charged: number;
  free: number;
  paid: number;
  byMethod: ByMethod;
  debt: number;
};

export type TournamentDetails = HistoryItem & {
  counters: { entries: number; rebuys: number; addons: number; doubleAddons: number };
  results: ResultRow[];
  /** По какой версии правил посчитаны очки */
  rulesId: number | null;
  /** Касса турнира по игрокам (docs/CASH.md); null — денег в турнире не было */
  cashReport: { summary: CashSummary; players: CashRow[] } | null;
};

export function getTournamentDetails(db: DatabaseSync, id: number): TournamentDetails | null {
  const item = listHistory(db).find((h) => h.id === id);
  if (!item) return null;
  const t = db.prepare("SELECT entries, rebuys, addons, double_addons, rules_id FROM tournaments WHERE id = ?").get(id) as {
    entries: number;
    rebuys: number;
    addons: number;
    double_addons: number;
    rules_id: number | null;
  };
  const res = computeResults(loadJournal(db, id), { finished: item.status === "finished" });
  const rows = db
    .prepare(
      `SELECT p.id, p.player_id, p.status, p.place, p.place_to, p.entries, p.ko, p.points, p.elo_before, p.elo_after, pl.name
       FROM participants p JOIN players pl ON pl.id = p.player_id
       WHERE p.tournament_id = ? AND p.status NOT IN ('registered', 'no_show')`,
    )
    .all(id) as {
    id: number;
    player_id: number;
    status: string;
    place: number | null;
    place_to: number | null;
    entries: number;
    ko: number;
    points: number | null;
    elo_before: number | null;
    elo_after: number | null;
    name: string;
  }[];
  const finished = item.status === "finished";
  const results = rows
    .map((r): ResultRow => {
      const x = res.participants.get(r.id);
      return {
        participantId: r.id,
        playerId: r.player_id,
        name: r.name,
        // у завершённого — сохранённые итоги (дил, исправления), у идущего — текущие
        place: finished ? r.place : (x?.place ?? null),
        placeTo: finished ? r.place_to : (x?.placeTo ?? null),
        entries: finished ? r.entries : (x?.entries ?? 0),
        addons: x?.addons ?? 0,
        doubleAddons: x?.doubleAddons ?? 0,
        ko: finished ? r.ko : (x?.ko ?? 0),
        points: finished ? r.points : null,
        eloBefore: r.elo_before,
        eloAfter: r.elo_after,
      };
    })
    .sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999) || a.name.localeCompare(b.name, "ru"));
  return {
    ...item,
    counters: { entries: t.entries, rebuys: t.rebuys, addons: t.addons, doubleAddons: t.double_addons },
    results,
    rulesId: finished ? t.rules_id : null,
    cashReport: detailsCash(db, id),
  };
}

/** Касса турнира по игрокам: должники сверху, потом по имени */
function detailsCash(db: DatabaseSync, id: number) {
  const { players, summary } = tournamentCash(db, id);
  if (summary.charged === 0 && summary.paid === 0 && summary.free === 0) return null;
  const names = db.prepare("SELECT name FROM players WHERE id = ?");
  const rows = [...players].map(
    ([playerId, c]): CashRow => ({
      playerId,
      name: (names.get(playerId) as { name: string } | undefined)?.name ?? "Игрок",
      charged: c.charged,
      free: c.free,
      paid: c.paid,
      byMethod: c.byMethod,
      debt: c.debt,
    }),
  );
  rows.sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name, "ru"));
  return { summary, players: rows };
}

// ---------- Исправление итогов ----------

export type ResultCorrection = { participantId: number; place: number; ko: number; entries: number };

/**
 * Проверить исправленные места: каждое место — целое от 1 до N; одинаковые места — делёж
 * (например, два «3» означают «3–4», следующее место тогда 5). Бросает Error с понятным текстом.
 */
export function validatePlaces(places: number[]) {
  const n = places.length;
  for (const p of places) {
    if (!Number.isInteger(p) || p < 1 || p > n) throw new Error(`Место должно быть числом от 1 до ${n}`);
  }
  const sorted = [...places].sort((a, b) => a - b);
  for (let i = 0; i < n; ) {
    const p = sorted[i];
    let j = i;
    while (j < n && sorted[j] === p) j++;
    if (p !== i + 1) {
      throw new Error(
        i === 0
          ? "Нет 1 места"
          : `После ${sorted[i - 1]} места должно идти ${i + 1}-е, а не ${p}-е (одинаковые места — делёж, следующее место пропускается)`,
      );
    }
    i = j;
  }
}

/** Сохранить исправленные итоги завершённого турнира (места, KO, входы) с записью в журнал. */
export function correctResults(db: DatabaseSync, tournamentId: number, rows: unknown, now = Date.now()) {
  const t = db.prepare("SELECT status FROM tournaments WHERE id = ?").get(tournamentId) as { status: string } | undefined;
  if (!t) throw new Error("Турнир не найден");
  if (t.status !== "finished") throw new Error("Исправлять можно только итоги завершённого турнира");
  if (!Array.isArray(rows)) throw new Error("Некорректные данные");

  const current = db
    .prepare(
      `SELECT id, place, place_to, entries, ko FROM participants
       WHERE tournament_id = ? AND status NOT IN ('registered', 'no_show')`,
    )
    .all(tournamentId) as { id: number; place: number | null; place_to: number | null; entries: number; ko: number }[];
  const byId = new Map(current.map((c) => [c.id, c]));

  const list: ResultCorrection[] = rows.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return { participantId: Number(r.participantId), place: Number(r.place), ko: Number(r.ko), entries: Number(r.entries) };
  });
  if (list.length !== current.length || list.some((r) => !byId.has(r.participantId)) || new Set(list.map((r) => r.participantId)).size !== list.length) {
    throw new Error("Нужно указать места всех участников турнира");
  }
  validatePlaces(list.map((r) => r.place));
  for (const r of list) {
    if (!Number.isFinite(r.ko) || r.ko < 0 || Math.round(r.ko * 2) !== r.ko * 2) throw new Error("Нокауты — целое число или с половинкой (0,5)");
    if (!Number.isInteger(r.entries) || r.entries < 1) throw new Error("Входов — целое число, не меньше 1");
  }
  const totalKo = list.reduce((s, r) => s + r.ko, 0);
  const totalBusts = list.reduce((s, r) => s + r.entries, 0) - 1;
  if (totalKo > totalBusts) throw new Error(`Нокаутов (${totalKo}) больше, чем вылетов (${totalBusts})`);

  // делёж мест: одинаковое место у нескольких → place_to
  const count = new Map<number, number>();
  for (const r of list) count.set(r.place, (count.get(r.place) ?? 0) + 1);

  const upd = db.prepare("UPDATE participants SET place = ?, place_to = ?, ko = ?, entries = ? WHERE id = ?");
  const changes: unknown[] = [];
  for (const r of list) {
    const n = count.get(r.place)!;
    const placeTo = n > 1 ? r.place + n - 1 : null;
    const old = byId.get(r.participantId)!;
    if (old.place !== r.place || old.place_to !== placeTo || old.ko !== r.ko || old.entries !== r.entries) {
      changes.push({ participantId: r.participantId, before: old, after: { place: r.place, place_to: placeTo, ko: r.ko, entries: r.entries } });
    }
    upd.run(r.place, placeTo, r.ko, r.entries, r.participantId);
  }
  if (changes.length) audit(db, "tournament.correct", { tournamentId, changes }, now);
  // очки — по той же версии правил, по которой турнир уже был посчитан (правила задним числом не меняем)
  const own = db.prepare("SELECT rules_id FROM tournaments WHERE id = ?").get(tournamentId) as { rules_id: number | null };
  scoreTournament(db, tournamentId, (own.rules_id != null && rulesById(db, own.rules_id)) || currentRules(db, now));
  // ELO этого турнира и всех после него
  recomputeElo(db, now);
  return changes.length;
}

// ---------- Очки рейтинга ----------

/**
 * Посчитать очки всех участников завершённого турнира по версии правил и запомнить версию.
 * Поле N — участники, которые входили в турнир (без «записался, но не пришёл»).
 */
export function scoreTournament(db: DatabaseSync, tournamentId: number, version: RulesVersion) {
  const t = db.prepare("SELECT kind FROM tournaments WHERE id = ?").get(tournamentId) as { kind: TournamentKind } | undefined;
  if (!t) throw new Error("Турнир не найден");
  const rows = db
    .prepare(
      `SELECT id, place, place_to, entries, ko FROM participants
       WHERE tournament_id = ? AND status NOT IN ('registered', 'no_show')`,
    )
    .all(tournamentId) as { id: number; place: number | null; place_to: number | null; entries: number; ko: number }[];
  const upd = db.prepare("UPDATE participants SET points = ? WHERE id = ?");
  for (const r of rows) {
    const points =
      r.place == null
        ? null
        : tournamentPoints(
            { place: r.place, placeTo: r.place_to, ko: r.ko, entries: r.entries, fieldSize: rows.length, kind: t.kind },
            version.rules,
          );
    upd.run(points, r.id);
  }
  db.prepare("UPDATE tournaments SET rules_id = ? WHERE id = ?").run(version.id, tournamentId);
}

/** Сколько завершённых турниров посчитано не по текущим правилам (для кнопки «Пересчитать») */
export function outdatedCount(db: DatabaseSync, now = Date.now()) {
  const cur = currentRules(db, now);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tournaments t
       WHERE t.status = 'finished' AND EXISTS (SELECT 1 FROM participants p WHERE p.tournament_id = t.id)
         AND (t.rules_id IS NULL OR t.rules_id <> ?)`,
    )
    .get(cur.id) as { n: number };
  return { currentId: cur.id, outdated: row.n };
}

/** «Пересчитать»: очки всех завершённых турниров по текущим правилам. Возвращает число турниров. */
export function rescoreAll(db: DatabaseSync, now = Date.now()) {
  const cur = currentRules(db, now);
  const ids = db
    .prepare(
      `SELECT t.id FROM tournaments t
       WHERE t.status = 'finished' AND EXISTS (SELECT 1 FROM participants p WHERE p.tournament_id = t.id)
       ORDER BY t.id`,
    )
    .all() as { id: number }[];
  for (const { id } of ids) scoreTournament(db, id, cur);
  recomputeElo(db, now);
  audit(db, "rules.rescore", { rulesId: cur.id, tournaments: ids.length }, now);
  return ids.length;
}
