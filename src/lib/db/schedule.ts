// Расписание будущих турниров в базе (docs/SITE.md, шаг 2): постоянные дни и сами турниры.
// Правила и проверки ввода — чистые функции в src/lib/schedule.ts.

import type { DatabaseSync } from "node:sqlite";
import {
  sanitizeItem,
  sanitizeTemplate,
  sortSchedule,
  templateDates,
  type ScheduleItem,
  type ScheduleStatus,
  type ScheduleTemplate,
} from "../schedule";
import { audit } from "./sqlite";

type ItemRow = {
  id: number;
  date: string;
  time: string;
  name: string;
  preset_id: string;
  seat_limit: number | null;
  note: string;
  status: ScheduleStatus;
  template_id: number | null;
  tournament_id: number | null;
};

const toItem = (r: ItemRow): ScheduleItem => ({
  id: r.id,
  date: r.date,
  time: r.time,
  name: r.name,
  presetId: r.preset_id,
  seatLimit: r.seat_limit,
  note: r.note,
  status: r.status,
  templateId: r.template_id,
  tournamentId: r.tournament_id,
});

const ITEM_COLUMNS = "id, date, time, name, preset_id, seat_limit, note, status, template_id, tournament_id";

function requirePreset(db: DatabaseSync, presetId: string) {
  if (!db.prepare("SELECT 1 FROM presets WHERE id = ?").get(presetId)) throw new Error("Структура турнира не найдена — выберите другую");
}

export function getItem(db: DatabaseSync, id: number): ScheduleItem {
  const row = db.prepare(`SELECT ${ITEM_COLUMNS} FROM schedule WHERE id = ?`).get(id) as ItemRow | undefined;
  if (!row) throw new Error("Турнир в расписании не найден");
  return toItem(row);
}

// ---------- Постоянные дни ----------

export function listTemplates(db: DatabaseSync): ScheduleTemplate[] {
  return (
    db.prepare("SELECT id, weekday, time, name, preset_id, seat_limit, note FROM schedule_templates ORDER BY weekday, time, id").all() as {
      id: number;
      weekday: number;
      time: string;
      name: string;
      preset_id: string;
      seat_limit: number | null;
      note: string;
    }[]
  ).map((r) => ({ id: r.id, weekday: r.weekday, time: r.time, name: r.name, presetId: r.preset_id, seatLimit: r.seat_limit, note: r.note }));
}

/**
 * Поставить турниры по постоянным дням на ближайшие 2 недели. Что уже стоит (в том числе отменённое) —
 * не трогает: у одного постоянного дня на одну дату — одна строка.
 */
export function ensureSchedule(db: DatabaseSync, today: string, now = Date.now()): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO schedule (date, time, name, preset_id, seat_limit, note, template_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  for (const t of listTemplates(db)) {
    for (const date of templateDates(t.weekday, today)) {
      added += Number(insert.run(date, t.time, t.name, t.presetId, t.seatLimit, t.note, t.id, now, now).changes);
    }
  }
  return added;
}

export function addTemplate(db: DatabaseSync, input: unknown, today: string, now = Date.now()): ScheduleTemplate {
  const t = sanitizeTemplate(input);
  requirePreset(db, t.presetId);
  const id = Number(
    db
      .prepare("INSERT INTO schedule_templates (weekday, time, name, preset_id, seat_limit, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(t.weekday, t.time, t.name, t.presetId, t.seatLimit, t.note, now, now).lastInsertRowid,
  );
  audit(db, "schedule.template.add", { id, ...t }, now);
  ensureSchedule(db, today, now);
  return { id, ...t };
}

/**
 * Поправить постоянный день. Его будущие турниры, которые не правили вручную и не открывали, меняются вместе с ним;
 * сменили день недели — они убираются и ставятся заново на новый день.
 */
export function updateTemplate(db: DatabaseSync, id: number, input: unknown, today: string, now = Date.now()): ScheduleTemplate {
  const before = listTemplates(db).find((x) => x.id === id);
  if (!before) throw new Error("Постоянный день не найден");
  const t = sanitizeTemplate(input);
  requirePreset(db, t.presetId);
  db.prepare("UPDATE schedule_templates SET weekday = ?, time = ?, name = ?, preset_id = ?, seat_limit = ?, note = ?, updated_at = ? WHERE id = ?").run(
    t.weekday,
    t.time,
    t.name,
    t.presetId,
    t.seatLimit,
    t.note,
    now,
    id,
  );
  if (t.weekday !== before.weekday) {
    db.prepare("DELETE FROM schedule WHERE template_id = ? AND date >= ? AND status IN ('planned', 'cancelled')").run(id, today);
  } else {
    db.prepare(
      `UPDATE schedule SET time = ?, name = ?, preset_id = ?, seat_limit = ?, note = ?, updated_at = ?
       WHERE template_id = ? AND date >= ? AND status = 'planned' AND edited = 0`,
    ).run(t.time, t.name, t.presetId, t.seatLimit, t.note, now, id, today);
  }
  audit(db, "schedule.template.update", { id, before, after: t }, now);
  ensureSchedule(db, today, now);
  return { id, ...t };
}

/** Убрать постоянный день и его будущие турниры (кроме уже открытых) */
export function deleteTemplate(db: DatabaseSync, id: number, today: string, now = Date.now()) {
  const before = listTemplates(db).find((x) => x.id === id);
  if (!before) throw new Error("Постоянный день не найден");
  db.prepare("DELETE FROM schedule WHERE template_id = ? AND date >= ? AND status IN ('planned', 'cancelled')").run(id, today);
  db.prepare("DELETE FROM schedule_templates WHERE id = ?").run(id);
  audit(db, "schedule.template.delete", { id, before }, now);
}

// ---------- Турниры в расписании ----------

/** Расписание с сегодняшнего дня (вместе с отменёнными и уже открытыми) */
export function listSchedule(db: DatabaseSync, today: string): ScheduleItem[] {
  return sortSchedule((db.prepare(`SELECT ${ITEM_COLUMNS} FROM schedule WHERE date >= ?`).all(today) as ItemRow[]).map(toItem));
}

export function addItem(db: DatabaseSync, input: unknown, today: string, now = Date.now()): ScheduleItem {
  const it = sanitizeItem(input, today);
  requirePreset(db, it.presetId);
  const id = Number(
    db
      .prepare("INSERT INTO schedule (date, time, name, preset_id, seat_limit, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(it.date, it.time, it.name, it.presetId, it.seatLimit, it.note, now, now).lastInsertRowid,
  );
  audit(db, "schedule.add", { id, ...it }, now);
  return getItem(db, id);
}

/** Поправить турнир в расписании (пока его не открыли). Турнир постоянного дня после правки живёт сам по себе. */
export function updateItem(db: DatabaseSync, id: number, input: unknown, today: string, now = Date.now()): ScheduleItem {
  const before = getItem(db, id);
  if (before.status === "started") throw new Error("Турнир уже открыт — правьте его в «Управлении»");
  const it = sanitizeItem(input, today);
  requirePreset(db, it.presetId);
  if (before.templateId != null && it.date !== before.date) {
    const clash = db.prepare("SELECT 1 FROM schedule WHERE template_id = ? AND date = ? AND id <> ?").get(before.templateId, it.date, id);
    if (clash) throw new Error("На эту дату турнир этого постоянного дня уже стоит");
  }
  db.prepare("UPDATE schedule SET date = ?, time = ?, name = ?, preset_id = ?, seat_limit = ?, note = ?, edited = 1, updated_at = ? WHERE id = ?").run(
    it.date,
    it.time,
    it.name,
    it.presetId,
    it.seatLimit,
    it.note,
    now,
    id,
  );
  audit(db, "schedule.update", { id, before, after: it }, now);
  return getItem(db, id);
}

/** Отменить турнир (он остаётся в списке зачёркнутым и не ставится заново) или вернуть отменённый */
export function setCancelled(db: DatabaseSync, id: number, cancelled: boolean, now = Date.now()): ScheduleItem {
  const before = getItem(db, id);
  if (before.status === "started") throw new Error("Турнир уже открыт — отменить его в расписании нельзя");
  db.prepare("UPDATE schedule SET status = ?, updated_at = ? WHERE id = ?").run(cancelled ? "cancelled" : "planned", now, id);
  audit(db, cancelled ? "schedule.cancel" : "schedule.restore", { id }, now);
  return getItem(db, id);
}

/**
 * Турнир из расписания открывают (он становится текущим на табло): проверить, что его можно открыть и что
 * текущий турнир не идёт, и пометить строку открытой. Вызывается в одной транзакции с записью нового турнира.
 */
export function markOpened(db: DatabaseSync, id: number, now = Date.now()): ScheduleItem {
  const item = getItem(db, id);
  if (item.status === "started") throw new Error("Этот турнир уже открыт");
  if (item.status === "cancelled") throw new Error("Турнир отменён — сначала верните его в расписание");
  const cur = db
    .prepare(
      `SELECT t.status,
              (SELECT COUNT(*) FROM events e WHERE e.tournament_id = t.id) AS events
       FROM tournaments t WHERE t.is_current = 1`,
    )
    .get() as { status: string; events: number } | undefined;
  if (cur && cur.status !== "idle" && cur.status !== "finished") throw new Error("Текущий турнир ещё идёт — сначала нажмите «Завершить»");
  if (cur && cur.status === "idle" && cur.events > 0) {
    throw new Error("В текущем турнире уже отмечены игроки — завершите или сбросьте его, потом открывайте новый");
  }
  db.prepare("UPDATE schedule SET status = 'started', updated_at = ? WHERE id = ?").run(now, id);
  audit(db, "schedule.open", { id, name: item.name, date: item.date }, now);
  return item;
}

/** Привязать открытую строку расписания к текущему турниру (после того как он записан в базу) */
export function linkOpened(db: DatabaseSync, id: number) {
  db.prepare("UPDATE schedule SET tournament_id = (SELECT id FROM tournaments WHERE is_current = 1) WHERE id = ? AND status = 'started'").run(id);
}
