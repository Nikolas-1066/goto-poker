// Фоновые задачи бота (docs/SITE.md, шаг 5): напоминание в день турнира, «вы придёте?», снятие не пришедших,
// отчёты админам и владельцу, итоги игрокам, «вы в финале». Каждая задача безопасна для повторного запуска:
// одно и то же сообщение второй раз не ставится (ключ dedupe в очереди).

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { boardView } from "../clock";
import { reportText } from "../report";
import { clubTime, clubToday, hasStarted } from "../schedule";
import { askComingText, finalistText, reminderText, removedText, resultText, staffReportText } from "../telegram/texts";
import type { Db, Tournament } from "../types";
import { getFinalistMessage } from "./accounts";
import { finalistsOf, listPeriods, PERIOD_LABEL, type Period } from "./periods";
import { tournamentReport } from "./report";
import { listSchedule } from "./schedule";
import type { PeriodKind } from "./settings";
import { dropSignupOfTournament, goingChats } from "./signups";
import { chatOfPlayer, enqueue, getReminderTime, staffChats } from "./telegram";
import { applyPlayerAction } from "./tournament";

type Current = { id: number; name: string; status: string; mode: string; finished_at: number | null };
const current = (db: DatabaseSync) => db.prepare("SELECT id, name, status, mode, finished_at FROM tournaments WHERE is_current = 1").get() as Current | undefined;

/** Записавшиеся, которые ещё не пришли: участник турнира и его игрок */
const notArrived = (db: DatabaseSync, tournamentId: number) =>
  db
    .prepare(
      `SELECT p.id, p.player_id FROM participants p
       WHERE p.tournament_id = ? AND NOT EXISTS (SELECT 1 FROM events e WHERE e.participant_id = p.id AND e.cancelled_at IS NULL)`,
    )
    .all(tournamentId) as { id: number; player_id: number }[];

/** Напоминание записанным в день турнира — с заданного времени и до начала */
export function remindToday(db: DatabaseSync, now = Date.now()): number {
  const today = clubToday(now);
  if (clubTime(now) < getReminderTime(db)) return 0;
  let n = 0;
  for (const item of listSchedule(db, today)) {
    if (item.date !== today || item.status === "cancelled" || hasStarted(item, now)) continue;
    for (const g of goingChats(db, item)) {
      if (enqueue(db, g.chat, reminderText({ name: item.name, time: item.time, guests: g.guests }), { dedupe: `remind:${item.id}:${g.chat}` }, now)) n += 1;
    }
  }
  return n;
}

/** Идёт турнир «По игрокам»? Тогда его номер и название. */
function live(db: DatabaseSync, t: Tournament): Current | null {
  const cur = current(db);
  return cur && t.mode === "players" && (t.status === "running" || t.status === "paused") ? cur : null;
}

/** После первого перерыва: записанному, который ещё не пришёл, — вопрос «вы придёте?» */
export function askComing(db: DatabaseSync, t: Tournament, now = Date.now()): number {
  const cur = live(db, t);
  if (!cur) return 0;
  const steps = t.structure?.steps ?? [];
  const firstBreak = steps.findIndex((s) => s.kind === "break");
  if (firstBreak < 0 || boardView(t, now).index <= firstBreak) return 0;
  let n = 0;
  for (const p of notArrived(db, cur.id)) {
    const buttons = [[{ text: "Приду", data: `come:${cur.id}` }], ...scheduleOf(db, cur.id).map((sid) => [{ text: "Отменить запись", data: `c:${sid}` }])];
    if (enqueue(db, chatOfPlayer(db, p.player_id), askComingText(cur.name), { buttons, dedupe: `ask:${cur.id}:${p.player_id}` }, now)) n += 1;
  }
  return n;
}

const scheduleOf = (db: DatabaseSync, tournamentId: number) =>
  (db.prepare("SELECT id FROM schedule WHERE tournament_id = ?").all(tournamentId) as { id: number }[]).map((r) => r.id);

/**
 * Регистрация закрылась (кончился и уровень «дозаписи» после закрытия ребаев): кто записан, но так и не пришёл, —
 * убирается из турнира, его запись снимается, ему уходит сообщение. В турнире без ребаев ничего не делает.
 * Вызывается внутри updateDb. Возвращает, сколько человек снято.
 */
export function dropLate(db: DatabaseSync, next: Db, now = Date.now()): number {
  const t = next.tournament;
  const cur = live(db, t);
  const until = t.structure?.rebuyUntilLevel ?? 0;
  if (!cur || until <= 0) return 0;
  const view = boardView(t, now);
  if (view.rebuyOpen || view.rebuyLate || view.periodLevel <= until) return 0;
  let n = 0;
  for (const p of notArrived(db, cur.id)) {
    try {
      applyPlayerAction(db, next, { type: "unregister", participantId: p.id }, now);
    } catch {
      continue; // например, уже есть оплата — оставляем админу
    }
    dropSignupOfTournament(db, cur.id, p.player_id, now);
    enqueue(db, chatOfPlayer(db, p.player_id), removedText(cur.name), { dedupe: `removed:${cur.id}:${p.player_id}` }, now);
    n += 1;
  }
  return n;
}

/** Турнир завершён (не раньше 12 часов назад): админам — ники, места и нокауты; владельцу — ещё и полный отчёт с кассой */
export function staffReports(db: DatabaseSync, now = Date.now()): number {
  const cur = current(db);
  if (!cur || cur.status !== "finished" || cur.mode !== "players" || cur.finished_at == null || cur.finished_at < now - 12 * 3_600_000) return 0;
  const staff = staffChats(db);
  if (!staff.length) return 0;
  const report = tournamentReport(db, cur.id);
  if (!report || !report.places.length) return 0;
  let n = 0;
  for (const chat of staff) if (enqueue(db, chat, staffReportText(report), { dedupe: `staff:${cur.id}:${chat}` }, now)) n += 1;
  for (const chat of staffChats(db, true)) if (enqueue(db, chat, reportText(report), { dedupe: `owner:${cur.id}:${chat}` }, now)) n += 1;
  return n;
}

/** Кнопка админа «Отправить итоги игрокам»: каждому участнику с Telegram — его место, очки, нокауты, место в рейтинге */
export function sendResults(db: DatabaseSync, tournamentId: number, now = Date.now()): { sent: number; linked: number; players: number } {
  const report = tournamentReport(db, tournamentId);
  const status = (db.prepare("SELECT status FROM tournaments WHERE id = ?").get(tournamentId) as { status: string } | undefined)?.status;
  if (!report || status !== "finished") throw new Error("Итоги можно отправить только по завершённому турниру");
  const rows = db
    .prepare(
      `SELECT p.player_id, pl.name, p.place, p.place_to, p.ko, p.points
       FROM participants p JOIN players pl ON pl.id = p.player_id WHERE p.tournament_id = ? AND p.place IS NOT NULL`,
    )
    .all(tournamentId) as { player_id: number; name: string; place: number; place_to: number | null; ko: number; points: number | null }[];
  let sent = 0;
  let linked = 0;
  for (const r of rows) {
    const chat = chatOfPlayer(db, r.player_id);
    if (chat == null) continue;
    linked += 1;
    const text = resultText(report, { place: r.place, placeTo: r.place_to, ko: r.ko, points: r.points }, r.name);
    if (enqueue(db, chat, text, { dedupe: `result:${tournamentId}:${r.player_id}` }, now)) sent += 1;
  }
  return { sent, linked, players: rows.length };
}

/** Кнопка админа «Отправить финалистам»: прошедшим в финал последнего закрытого периода — поздравление и текст клуба */
export function sendFinalists(db: DatabaseSync, now = Date.now()): { sent: number; finalists: number } {
  const message = getFinalistMessage(db);
  const key = createHash("sha256").update(message).digest("hex").slice(0, 8);
  const played = db.prepare("SELECT 1 FROM tournaments WHERE final_of_period_id = ? AND status = 'finished'");
  const lastClosed = new Map<PeriodKind, Period>();
  for (const p of listPeriods(db)) {
    const cur = lastClosed.get(p.kind);
    if (p.closedAt != null && (!cur || p.closedAt > cur.closedAt!)) lastClosed.set(p.kind, p);
  }
  let sent = 0;
  let finalists = 0;
  for (const p of lastClosed.values()) {
    if (played.get(p.id)) continue;
    for (const f of finalistsOf(db, p).finalists) {
      finalists += 1;
      // текст поменяли — финалист получит новый; тот же самый второй раз не уйдёт
      if (enqueue(db, chatOfPlayer(db, f.playerId), finalistText([`${PERIOD_LABEL[p.kind]} · ${p.name}`], message), { dedupe: `finalist:${p.id}:${f.playerId}:${key}` }, now)) sent += 1;
    }
  }
  if (!finalists) throw new Error("Сейчас нет финалистов: месяц ещё не закрыт или финал уже сыгран");
  return { sent, finalists };
}

/** Все фоновые задачи разом — раз в полминуты, внутри updateDb */
export function botTick(db: DatabaseSync, next: Db, now = Date.now()) {
  remindToday(db, now);
  askComing(db, next.tournament, now);
  dropLate(db, next, now);
  staffReports(db, now);
}
