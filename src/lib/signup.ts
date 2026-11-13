// Запись игроков на будущие турниры (docs/SITE.md, шаг 4) — чистые функции и типы.
// Гости: +1…+3, ник каждого — по желанию. Лимит мест и лист ожидания: очередь строгая, по времени записи.

import { hasStarted, type ScheduleItem } from "./schedule";

export const MAX_GUESTS = 3;
export const GUEST_NAME_MAX = 40;

export type SignupState = "going" | "waiting";

/** Запись, как её видят все на сайте: имя, сколько гостей (ники гостей — только в админке) */
export type SiteSignup = { playerId: number | null; name: string; guests: number };

export type SiteSignups = {
  going: SiteSignup[];
  waiting: SiteSignup[];
  /** Сколько мест занято (с гостями) и сколько свободно (null — лимита нет) */
  seats: number;
  free: number | null;
  /** Запись открыта (до времени начала по расписанию) */
  open: boolean;
};

/** Моя запись — для кнопки на карточке турнира и блока «Мои записи» в кабинете */
export type MySignup = {
  scheduleId: number;
  date: string;
  time: string;
  name: string;
  guests: number;
  guestNames: string[];
  state: SignupState;
  /** Место в листе ожидания (1 — первый); 0 — записан */
  queue: number;
  /** Турнир уже открыт в клубе */
  started: boolean;
};

/** Гости из формы: число 0…3 и ники (по желанию, не больше числа гостей). Бросает Error с понятным текстом. */
export function sanitizeGuests(input: unknown): { guests: number; guestNames: string[] } {
  const p = (input ?? {}) as { guests?: unknown; guestNames?: unknown };
  const guests = Number(p.guests ?? 0);
  if (!Number.isInteger(guests) || guests < 0 || guests > MAX_GUESTS) throw new Error(`Гостей — от 0 до ${MAX_GUESTS}`);
  const guestNames = (Array.isArray(p.guestNames) ? p.guestNames : [])
    .slice(0, guests)
    .map((n) => String(n ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (guestNames.some((n) => n.length > GUEST_NAME_MAX)) throw new Error(`Ник гостя — не длиннее ${GUEST_NAME_MAX} символов`);
  return { guests, guestNames };
}

/**
 * Кто записан, а кто в листе ожидания. Очередь строгая: записи идут по порядку, пока помещаются целиком (игрок
 * с гостями — одна запись); первая, которая не поместилась, и все после неё — ждут. Кто-то отменил — очередь
 * сдвигается сама. Без лимита — все записаны.
 */
export function splitQueue<T extends { guests: number }>(rows: T[], limit: number | null): { going: T[]; waiting: T[]; seats: number; free: number | null } {
  const going: T[] = [];
  const waiting: T[] = [];
  let seats = 0;
  for (const r of rows) {
    const size = 1 + r.guests;
    if (waiting.length === 0 && (limit == null || seats + size <= limit)) {
      going.push(r);
      seats += size;
    } else waiting.push(r);
  }
  return { going, waiting, seats, free: limit == null ? null : Math.max(0, limit - seats) };
}

/** Можно ли ещё записаться: турнир не отменён и по расписанию ещё не начался */
export function signupOpen(item: Pick<ScheduleItem, "date" | "time" | "status">, now: number): boolean {
  return item.status !== "cancelled" && !hasStarted(item, now);
}

/** «Саша +2» */
export const signupLabel = (s: { name: string; guests: number }) => (s.guests > 0 ? `${s.name} +${s.guests}` : s.name);

/** «1 место», «3 места», «12 мест» */
export function seatsWord(n: number): string {
  const d = n % 10;
  const h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? "место" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "места" : "мест"}`;
}
