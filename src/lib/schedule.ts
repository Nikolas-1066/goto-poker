// Расписание будущих турниров (docs/SITE.md, шаг 2) — чистые функции, общие для сервера и админки.
// Дата и время — как на часах в клубе (Воронеж, московское время): дата «2026-11-20», время «19:00».
// Так расписание не зависит от часового пояса сервера.
// «Постоянные дни» (шаблоны): каждую неделю в такой-то день — программа сама ставит турниры на 2 недели вперёд.

import { applyAction } from "./clock";
import type { Preset, Tournament } from "./types";

export const CLUB_TZ = "Europe/Moscow";
/** На сколько дней вперёд ставятся турниры по постоянным дням (сегодня + 13 дней) */
export const SCHEDULE_DAYS_AHEAD = 14;

export type ScheduleStatus = "planned" | "cancelled" | "started";

export type ScheduleItem = {
  id: number;
  date: string;
  time: string;
  name: string;
  presetId: string;
  /** Лимит мест (null — без лимита) */
  seatLimit: number | null;
  note: string;
  status: ScheduleStatus;
  /** Поставлен по постоянному дню */
  templateId: number | null;
  /** Турнир, открытый из этой строки */
  tournamentId: number | null;
};

export type ScheduleTemplate = {
  id: number;
  /** 1 — понедельник … 7 — воскресенье */
  weekday: number;
  time: string;
  name: string;
  presetId: string;
  seatLimit: number | null;
  note: string;
};

export type ItemInput = Pick<ScheduleItem, "date" | "time" | "name" | "presetId" | "seatLimit" | "note">;
export type TemplateInput = Omit<ScheduleTemplate, "id">;

export const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const EVERY = ["Каждый понедельник", "Каждый вторник", "Каждую среду", "Каждый четверг", "Каждую пятницу", "Каждую субботу", "Каждое воскресенье"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// ---------- Даты ----------

/** Сегодняшняя дата в клубе: «2026-11-20» */
export function clubToday(now: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: CLUB_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Который час в клубе: «19:05» */
export function clubTime(now: number): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: CLUB_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

const utc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Настоящая ли это дата вида «2026-11-20» */
export function isDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(utc(date)).toISOString().slice(0, 10) === date;
}

export function isTime(time: unknown): time is string {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** День недели: 1 — понедельник … 7 — воскресенье */
export function weekdayOf(date: string): number {
  return new Date(utc(date)).getUTCDay() || 7;
}

/** Даты постоянного дня на ближайшие `days` дней, считая сегодня */
export function templateDates(weekday: number, today: string, days = SCHEDULE_DAYS_AHEAD): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    if (weekdayOf(d) === weekday) out.push(d);
  }
  return out;
}

/** Турнир уже начался по расписанию? (запись игроков через сайт и бота — до старта) */
export function hasStarted(item: Pick<ScheduleItem, "date" | "time">, now: number): boolean {
  const today = clubToday(now);
  return item.date < today || (item.date === today && item.time <= clubTime(now));
}

// ---------- Подписи ----------

/** «пт, 20 ноября» */
export function formatDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS_SHORT[weekdayOf(date) - 1]}, ${d} ${MONTHS[m - 1]}`;
}

/** «Сегодня», «Завтра» или пусто */
export function dayHint(date: string, today: string): string {
  return date === today ? "Сегодня" : date === addDays(today, 1) ? "Завтра" : "";
}

/** «Каждую пятницу в 19:00» */
export function templateLabel(t: Pick<ScheduleTemplate, "weekday" | "time">): string {
  return `${EVERY[t.weekday - 1]} в ${t.time}`;
}

// ---------- Проверка ввода ----------

function common(p: Record<string, unknown>) {
  if (!isTime(p.time)) throw new Error("Время — в виде 19:00");
  const name = String(p.name ?? "").trim();
  if (!name) throw new Error("Впишите название турнира");
  if (name.length > 60) throw new Error("Название — не длиннее 60 символов");
  const presetId = String(p.presetId ?? "");
  if (!presetId) throw new Error("Выберите структуру турнира");
  let seatLimit: number | null = null;
  if (p.seatLimit !== null && p.seatLimit !== undefined && p.seatLimit !== "") {
    seatLimit = Number(p.seatLimit);
    if (!Number.isInteger(seatLimit) || seatLimit < 2 || seatLimit > 300) throw new Error("Лимит мест — от 2 до 300 (или пусто — без лимита)");
  }
  const note = String(p.note ?? "").trim();
  if (note.length > 300) throw new Error("Примечание — не длиннее 300 символов");
  return { time: p.time, name, presetId, seatLimit, note };
}

/** Турнир в расписании. `today` — прошедшую дату поставить нельзя. Бросает Error с понятным текстом. */
export function sanitizeItem(input: unknown, today: string): ItemInput {
  const p = (input ?? {}) as Record<string, unknown>;
  if (!isDate(p.date)) throw new Error("Выберите дату турнира");
  if (p.date < today) throw new Error("Эта дата уже прошла");
  if (p.date > addDays(today, 366)) throw new Error("Дата — не дальше года вперёд");
  return { date: p.date, ...common(p) };
}

/** Постоянный день. Бросает Error с понятным текстом. */
export function sanitizeTemplate(input: unknown): TemplateInput {
  const p = (input ?? {}) as Record<string, unknown>;
  const weekday = Number(p.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("Выберите день недели");
  return { weekday, ...common(p) };
}

/** По порядку: дата, время, потом номер */
export function sortSchedule<T extends Pick<ScheduleItem, "id" | "date" | "time">>(items: T[]): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id - b.id);
}

// ---------- Открытие турнира ----------

/**
 * Турнир из расписания становится текущим: его структура, его название, учёт «По игрокам».
 * Комбинация дня и бегущая строка остаются (как при загрузке структуры).
 */
export function openedTournament(
  t: Tournament,
  item: Pick<ScheduleItem, "name" | "presetId">,
  now: number,
  findPreset: (id: string) => Preset | undefined,
): Tournament {
  if (!findPreset(item.presetId)) throw new Error("Структура этого турнира удалена — выберите другую в расписании");
  return { ...applyAction(t, { type: "loadPreset", presetId: item.presetId }, now, findPreset), name: item.name, mode: "players" };
}
