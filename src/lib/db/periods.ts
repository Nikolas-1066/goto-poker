// Периоды рейтинга (месяц / сезон / год), таблицы и финалисты — docs/RATING.md, раздел 3 и 7а.
//
// Период — промежуток [started_at, closed_at): турнир относится к периоду по времени начала.
// «Закрыть период»: таблица замораживается (period_standings), сразу начинается новый период
// с выбранной даты (по умолчанию — сейчас). Какие турниры идут в какой рейтинг (7а, п. 3):
//   месяц — обычные; сезон — обычные и финалы месяца; год — ещё и финалы сезона;
//   «за всё время» — все.

import type { DatabaseSync } from "node:sqlite";
import { buildStandings, computeFinalists, monthName, seasonName, type FinalistChange, type ScoredResult, type Standing } from "../rating/standings";
import { getSettings, type PeriodKind } from "./settings";
import { audit } from "./sqlite";

export type Period = {
  id: number;
  kind: PeriodKind;
  name: string;
  startedAt: number;
  /** Конец периода (= начало следующего); null — период открыт */
  closedAt: number | null;
  finalistsN: number;
};

export const PERIOD_LABEL: Record<PeriodKind, string> = { month: "Месяц", season: "Сезон", year: "Год" };

/** Виды турниров, которые идут в рейтинг этого вида */
const KINDS: Record<PeriodKind | "all", string[]> = {
  month: ["regular"],
  season: ["regular", "month_final"],
  year: ["regular", "month_final", "season_final"],
  all: ["regular", "month_final", "season_final", "year_final"],
};

type PeriodRow = { id: number; kind: PeriodKind; name: string; started_at: number; closed_at: number | null; finalists_n: number };
const fromRow = (r: PeriodRow): Period => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  startedAt: r.started_at,
  closedAt: r.closed_at,
  finalistsN: r.finalists_n,
});

export function listPeriods(db: DatabaseSync): Period[] {
  return (db.prepare("SELECT * FROM periods ORDER BY started_at DESC, id DESC").all() as PeriodRow[]).map(fromRow);
}

export function getPeriod(db: DatabaseSync, id: number): Period | null {
  const row = db.prepare("SELECT * FROM periods WHERE id = ?").get(id) as PeriodRow | undefined;
  return row ? fromRow(row) : null;
}

export function openPeriod(db: DatabaseSync, kind: PeriodKind): Period | null {
  const row = db.prepare("SELECT * FROM periods WHERE kind = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1").get(kind) as
    | PeriodRow
    | undefined;
  return row ? fromRow(row) : null;
}

/**
 * Название следующего периода при закрытии: месяц закрывают в конце месяца (перед финалом)
 * или в начале следующего — после 15-го числа предлагаем следующий месяц.
 */
export function nextPeriodName(kind: PeriodKind, at: number) {
  if (kind !== "month") return defaultPeriodName(kind, at);
  const d = new Date(at);
  return d.getDate() >= 15 ? monthName(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()) : monthName(at);
}

export function defaultPeriodName(kind: PeriodKind, at: number) {
  const y = new Date(at).getFullYear();
  return kind === "month" ? monthName(at) : kind === "season" ? `${seasonName(at)} ${y}` : String(y);
}

function cleanName(name: unknown, kind: PeriodKind, at: number) {
  const s = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return s || defaultPeriodName(kind, at);
}

function checkKindEnabled(db: DatabaseSync, kind: PeriodKind) {
  const s = getSettings(db);
  if (kind === "season" && !s.seasonEnabled) throw new Error("Сезонный рейтинг выключен в настройках");
  if (kind === "year" && !s.yearEnabled) throw new Error("Годовой рейтинг выключен в настройках");
}

/** Результаты (с очками) турниров, которые идут в рейтинг: период или «за всё время» */
export function scoredResults(db: DatabaseSync, scope: Period | "all"): ScoredResult[] {
  const kinds = KINDS[scope === "all" ? "all" : scope.kind];
  const from = scope === "all" ? 0 : scope.startedAt;
  const to = scope === "all" || scope.closedAt == null ? Number.MAX_SAFE_INTEGER : scope.closedAt;
  const rows = db
    .prepare(
      `SELECT p.player_id, pl.name, t.id AS tid, COALESCE(t.started_at, t.created_at) AS at, p.place, p.points, p.ko
       FROM participants p
       JOIN tournaments t ON t.id = p.tournament_id
       JOIN players pl ON pl.id = p.player_id
       WHERE t.status = 'finished' AND p.points IS NOT NULL AND p.place IS NOT NULL
         AND t.kind IN (${kinds.map(() => "?").join(", ")})
         AND COALESCE(t.started_at, t.created_at) >= ? AND COALESCE(t.started_at, t.created_at) < ?`,
    )
    .all(...kinds, from, to) as { player_id: number; name: string; tid: number; at: number; place: number; points: number; ko: number }[];
  return rows.map((r) => ({ playerId: r.player_id, name: r.name, tournamentId: r.tid, at: r.at, place: r.place, points: r.points, ko: r.ko }));
}

/** Таблица периода: у закрытого — замороженная, у открытого и «за всё время» — живая */
export function standingsOf(db: DatabaseSync, scope: Period | "all"): Standing[] {
  if (scope !== "all" && scope.closedAt != null) {
    return (
      db
        .prepare(
          `SELECT s.player_id, pl.name, s.rank, s.points, s.wins, s.best_place, s.ko, s.tournaments
           FROM period_standings s JOIN players pl ON pl.id = s.player_id
           WHERE s.period_id = ? ORDER BY s.rank`,
        )
        .all(scope.id) as {
        player_id: number;
        name: string;
        rank: number;
        points: number;
        wins: number;
        best_place: number;
        ko: number;
        tournaments: number;
      }[]
    ).map((r) => ({
      rank: r.rank,
      playerId: r.player_id,
      name: r.name,
      points: r.points,
      wins: r.wins,
      bestPlace: r.best_place,
      ko: r.ko,
      tournaments: r.tournaments,
      lastAt: 0,
    }));
  }
  return buildStandings(scoredResults(db, scope));
}

export function finalistChanges(db: DatabaseSync, periodId: number): FinalistChange[] {
  return (
    db.prepare("SELECT id, player_id, action, at, note FROM finalist_changes WHERE period_id = ? ORDER BY at, id").all(periodId) as {
      id: number;
      player_id: number;
      action: "add" | "remove";
      at: number;
      note: string;
    }[]
  ).map((c) => ({ id: c.id, playerId: c.player_id, action: c.action, at: c.at, note: c.note }));
}

export function finalistsOf(db: DatabaseSync, period: Period) {
  return computeFinalists(standingsOf(db, period), period.finalistsN, finalistChanges(db, period.id));
}

// ---------- Действия владельца ----------

/** Начать период (первый или если открытого нет) с выбранной даты — не позже сейчас */
export function startPeriod(db: DatabaseSync, kind: PeriodKind, input: { name?: unknown; startAt?: unknown }, now = Date.now()) {
  if (!(kind in KINDS)) throw new Error("Неизвестный вид периода");
  checkKindEnabled(db, kind);
  if (openPeriod(db, kind)) throw new Error(`${PERIOD_LABEL[kind]}: период уже идёт — сначала закройте его`);
  const startAt = input.startAt == null || input.startAt === "" ? now : Number(input.startAt);
  if (!Number.isFinite(startAt) || startAt > now) throw new Error("Дата начала — не позже сегодняшнего дня");
  const last = db.prepare("SELECT MAX(closed_at) AS m FROM periods WHERE kind = ?").get(kind) as { m: number | null };
  if (last.m != null && startAt < last.m) throw new Error("Новый период не может начинаться раньше конца предыдущего");
  const name = cleanName(input.name, kind, startAt);
  const n = getSettings(db).finalistsN[kind];
  const id = Number(
    db.prepare("INSERT INTO periods (kind, name, started_at, finalists_n) VALUES (?, ?, ?, ?)").run(kind, name, startAt, n).lastInsertRowid,
  );
  audit(db, "period.start", { id, kind, name, startAt }, now);
  return getPeriod(db, id)!;
}

/**
 * «Закрыть период»: заморозить таблицу и сразу начать следующий период с даты nextStart
 * (по умолчанию — сейчас). Финалисты — топ-N замороженной таблицы.
 */
export function closePeriod(db: DatabaseSync, periodId: number, input: { nextName?: unknown; nextStart?: unknown }, now = Date.now()) {
  const p = getPeriod(db, periodId);
  if (!p) throw new Error("Период не найден");
  if (p.closedAt != null) throw new Error("Период уже закрыт");
  const end = input.nextStart == null || input.nextStart === "" ? now : Number(input.nextStart);
  if (!Number.isFinite(end) || end > now) throw new Error("Новый период — не позже сегодняшнего дня");
  if (end <= p.startedAt) throw new Error("Новый период должен начинаться позже начала закрываемого");

  const standings = buildStandings(scoredResults(db, { ...p, closedAt: end }));
  const ins = db.prepare(
    "INSERT INTO period_standings (period_id, player_id, rank, points, wins, best_place, ko, tournaments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const s of standings) ins.run(p.id, s.playerId, s.rank, s.points, s.wins, s.bestPlace, s.ko, s.tournaments);
  db.prepare("UPDATE periods SET closed_at = ? WHERE id = ?").run(end, p.id);

  const name = String(input.nextName ?? "").trim() ? cleanName(input.nextName, p.kind, end) : nextPeriodName(p.kind, end);
  const n = getSettings(db).finalistsN[p.kind];
  const nextId = Number(
    db.prepare("INSERT INTO periods (kind, name, started_at, finalists_n) VALUES (?, ?, ?, ?)").run(p.kind, name, end, n).lastInsertRowid,
  );
  const closed = getPeriod(db, p.id)!;
  audit(
    db,
    "period.close",
    { id: p.id, name: p.name, end, nextId, nextName: name, finalists: finalistsOf(db, closed).finalists.map((f) => f.playerId) },
    now,
  );
  return { closed, next: getPeriod(db, nextId)! };
}

/** Можно ли отменить закрытие: в новом периоде ещё нет турниров и финал по закрытому не создан */
export function reopenBlocker(db: DatabaseSync, periodId: number): string | null {
  const p = getPeriod(db, periodId);
  if (!p) return "Период не найден";
  if (p.closedAt == null) return "Период не закрыт";
  const next = db
    .prepare("SELECT * FROM periods WHERE kind = ? AND started_at >= ? AND id <> ? ORDER BY started_at, id LIMIT 1")
    .get(p.kind, p.closedAt, p.id) as PeriodRow | undefined;
  if (next?.closed_at != null) return "Следующий период тоже уже закрыт";
  const kinds = KINDS[p.kind];
  const played = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tournaments t
       WHERE t.kind IN (${kinds.map(() => "?").join(", ")}) AND COALESCE(t.started_at, t.created_at) >= ?
         AND EXISTS (SELECT 1 FROM participants pp WHERE pp.tournament_id = t.id)`,
    )
    .get(...kinds, p.closedAt) as { n: number };
  if (played.n > 0) return "В новом периоде уже играли турниры";
  const final = db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE final_of_period_id = ?").get(p.id) as { n: number };
  if (final.n > 0) return "По этому периоду уже создан финал";
  return null;
}

/** Отменить закрытие (нажали по ошибке): период снова открыт, начатый за ним — удалён */
export function reopenPeriod(db: DatabaseSync, periodId: number, now = Date.now()) {
  const blocker = reopenBlocker(db, periodId);
  if (blocker) throw new Error(`Отменить закрытие нельзя: ${blocker.toLowerCase()}`);
  const p = getPeriod(db, periodId)!;
  db.prepare("DELETE FROM periods WHERE kind = ? AND closed_at IS NULL AND id <> ? AND started_at >= ?").run(p.kind, p.id, p.closedAt);
  db.prepare("DELETE FROM period_standings WHERE period_id = ?").run(p.id);
  db.prepare("DELETE FROM finalist_changes WHERE period_id = ?").run(p.id);
  db.prepare("UPDATE periods SET closed_at = NULL WHERE id = ?").run(p.id);
  audit(db, "period.reopen", { id: p.id, name: p.name }, now);
  return getPeriod(db, p.id)!;
}

export function renamePeriod(db: DatabaseSync, periodId: number, name: unknown, now = Date.now()) {
  const p = getPeriod(db, periodId);
  if (!p) throw new Error("Период не найден");
  const clean = cleanName(name, p.kind, p.startedAt);
  db.prepare("UPDATE periods SET name = ? WHERE id = ?").run(clean, p.id);
  if (clean !== p.name) audit(db, "period.rename", { id: p.id, before: p.name, after: clean }, now);
}

/** Сколько проходит в финал — менять можно в любой момент, и после закрытия */
export function setFinalistsN(db: DatabaseSync, periodId: number, n: unknown, now = Date.now()) {
  const p = getPeriod(db, periodId);
  if (!p) throw new Error("Период не найден");
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1 || v > 500) throw new Error("Финалистов — целое число от 1 до 500");
  db.prepare("UPDATE periods SET finalists_n = ? WHERE id = ?").run(v, p.id);
  if (v !== p.finalistsN) audit(db, "period.finalists_n", { id: p.id, before: p.finalistsN, after: v }, now);
}

/** Wildcard (add) или отказ (remove) — только для закрытого периода; всё — в журнал */
export function changeFinalist(db: DatabaseSync, periodId: number, playerId: number, action: "add" | "remove", note: unknown, now = Date.now()) {
  const p = getPeriod(db, periodId);
  if (!p) throw new Error("Период не найден");
  if (p.closedAt == null) throw new Error("Список финалистов правится после закрытия периода");
  if (action !== "add" && action !== "remove") throw new Error("Неизвестное действие");
  const player = db.prepare("SELECT id FROM players WHERE id = ?").get(playerId);
  if (!player) throw new Error("Игрок не найден");
  const text = String(note ?? "").trim().slice(0, 200);
  db.prepare("INSERT INTO finalist_changes (period_id, player_id, action, at, note) VALUES (?, ?, ?, ?, ?)").run(p.id, playerId, action, now, text);
  audit(db, `period.finalist_${action}`, { periodId: p.id, playerId, note: text }, now);
}

// ---------- Данные для страницы «Рейтинг» ----------

export type StandingRow = Standing & { elo: number };

function withElo(db: DatabaseSync, list: Standing[]): StandingRow[] {
  const elo = new Map((db.prepare("SELECT id, elo FROM players").all() as { id: number; elo: number }[]).map((p) => [p.id, p.elo]));
  return list.map((s) => ({ ...s, elo: Math.round(elo.get(s.playerId) ?? 0) }));
}

export type PeriodView = {
  period: Period;
  standings: StandingRow[];
  finalists: ReturnType<typeof computeFinalists>["finalists"];
  declined: number[];
  changes: (FinalistChange & { name: string })[];
  reopenBlocker: string | null;
};

export function periodView(db: DatabaseSync, period: Period): PeriodView {
  const standings = standingsOf(db, period);
  const changes = finalistChanges(db, period.id);
  const { finalists, declined } = computeFinalists(standings, period.finalistsN, changes);
  const nameOf = db.prepare("SELECT name FROM players WHERE id = ?");
  return {
    period,
    standings: withElo(db, standings),
    finalists,
    declined,
    changes: changes.map((c) => ({ ...c, name: (nameOf.get(c.playerId) as { name: string } | undefined)?.name ?? "?" })),
    reopenBlocker: period.closedAt != null ? reopenBlocker(db, period.id) : null,
  };
}

export function ratingOverview(db: DatabaseSync, now = Date.now()) {
  const settings = getSettings(db);
  const kinds: PeriodKind[] = ["month", ...(settings.seasonEnabled ? ["season" as const] : []), ...(settings.yearEnabled ? ["year" as const] : [])];
  const open = Object.fromEntries(
    kinds.map((k) => {
      const p = openPeriod(db, k);
      return [k, p ? periodView(db, p) : null];
    }),
  ) as Partial<Record<PeriodKind, PeriodView | null>>;
  const unscored = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tournaments t
       WHERE t.status = 'finished' AND EXISTS (SELECT 1 FROM participants p WHERE p.tournament_id = t.id AND p.place IS NOT NULL AND p.points IS NULL)`,
    )
    .get() as { n: number };
  return {
    settings,
    kinds,
    open,
    all: withElo(db, standingsOf(db, "all")),
    closed: listPeriods(db).filter((p) => p.closedAt != null),
    defaultNames: Object.fromEntries(kinds.map((k) => [k, defaultPeriodName(k, now)])) as Record<PeriodKind, string>,
    nextNames: Object.fromEntries(kinds.map((k) => [k, nextPeriodName(k, now)])) as Record<PeriodKind, string>,
    unscored: unscored.n,
  };
}
