// Вход игрока на сайт и профиль (docs/SITE.md, шаг 3) — чистые функции и типы, общие для сервера и браузера.
// Логин — телефон. Заявку подтверждает админ; до этого чужой профиль занять нельзя.

import { cleanName, NAME_MAX, normalizePhone } from "./players";

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 100;
/** Фото игрока: квадрат такой стороны (уменьшается в браузере), JPEG не больше PHOTO_MAX_BYTES */
export const PHOTO_SIZE = 320;
export const PHOTO_MAX_BYTES = 200_000;
export const FINALIST_MESSAGE_MAX = 1000;

export function validatePassword(password: unknown): string {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) throw new Error(`Пароль — минимум ${PASSWORD_MIN} символов`);
  if (password.length > PASSWORD_MAX) throw new Error(`Пароль — не длиннее ${PASSWORD_MAX} символов`);
  return password;
}

export function validateNick(name: unknown): string {
  const n = cleanName(String(name ?? ""));
  if (!n) throw new Error("Укажите имя или ник");
  if (n.length > NAME_MAX) throw new Error(`Имя слишком длинное (до ${NAME_MAX} символов)`);
  return n;
}

export function validatePhone(phone: unknown): string {
  const raw = String(phone ?? "").trim();
  if (!raw) throw new Error("Укажите телефон");
  const p = normalizePhone(raw);
  if (!p) throw new Error("Телефон не похож на настоящий. Пример: +7 900 123-45-67");
  return p;
}

/** Заявка на вход: имя, телефон, пароль. Бросает Error с понятным текстом. */
export function validateRegistration(input: unknown): { name: string; phone: string; password: string } {
  const p = (input ?? {}) as Record<string, unknown>;
  return { name: validateNick(p.name), phone: validatePhone(p.phone), password: validatePassword(p.password) };
}

/** Это картинка JPEG? (по первым байтам — что бы ни было написано в имени файла) */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 100 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// ---------- Финал в личном кабинете ----------

export type FinalZone =
  /** Ещё не играл в этом периоде */
  | { state: "none" }
  /** В зоне финала: место rank, в финал выходит zone человек */
  | { state: "in"; rank: number; zone: number; points: number }
  /** Пока вне зоны: gap — сколько очков до последнего проходящего места (0 — очков поровну, нужно обойти) */
  | { state: "out"; rank: number; zone: number; points: number; gap: number };

/** Где игрок относительно зоны финала идущего периода */
export function finalZone(rows: { playerId: number; rank: number; points: number }[], playerId: number, zone: number): FinalZone {
  const me = rows.find((r) => r.playerId === playerId);
  if (!me) return { state: "none" };
  if (zone <= 0 || me.rank <= zone) return { state: "in", rank: me.rank, zone, points: me.points };
  const edge = rows.find((r) => r.rank === zone);
  return { state: "out", rank: me.rank, zone, points: me.points, gap: Math.max(0, (edge?.points ?? me.points) - me.points) };
}

/** «Вы в зоне финала: 4 место, проходят 9» / «До зоны финала — 35 очков» */
export function finalZoneText(z: FinalZone): string {
  if (z.state === "none") return "Сыграйте турнир — и попадёте в рейтинг этого периода.";
  if (z.state === "in") return `Вы в зоне финала: ${z.rank} место, в финал выходят ${z.zone}.`;
  return z.gap > 0
    ? `Сейчас ${z.rank} место, в финал выходят ${z.zone}. До зоны финала — ${z.gap} оч.`
    : `Сейчас ${z.rank} место, в финал выходят ${z.zone}. Очков столько же, сколько у ${z.zone}-го места — нужно его обойти.`;
}

/** Полоса прогресса: сколько очков есть и сколько нужно, чтобы войти в зону финала. null — рисовать нечего */
export function finalProgress(z: FinalZone): { have: number; need: number; percent: number } | null {
  if (z.state === "none") return null;
  const need = z.state === "in" ? z.points : z.points + z.gap;
  // очков поровну с проходящим местом — почти полная полоса: остался один шаг
  const percent = z.state === "in" ? 100 : need > 0 ? Math.min(z.gap > 0 ? 97 : 99, Math.round((z.points / need) * 100)) : 0;
  return { have: z.points, need, percent };
}

// ---------- Что видит вошедший игрок ----------

export type AccountMe =
  | { status: "none" }
  /** Заявка отправлена, админ ещё не подтвердил */
  | { status: "pending"; name: string; phone: string; telegram: boolean }
  | {
      status: "active";
      playerId: number;
      name: string;
      phone: string;
      /** Подключён ли Telegram-бот */
      telegram: boolean;
      /** Версия фото (время загрузки) или null — фото нет */
      photo: number | null;
      /** Идущий месяц: где игрок относительно зоны финала (пусто — месяц не идёт) */
      zones: { label: string; zone: FinalZone }[];
      /** Закрытые периоды, финал которых ещё не сыгран и куда игрок прошёл */
      finalistOf: string[];
      /** Сообщение клуба финалистам (пишет админ) */
      finalistMessage: string;
    };

/** Заявка в админке */
export type AccountRequest = {
  id: number;
  name: string;
  phone: string;
  createdAt: number;
  /** Игрок из базы клуба с таким же телефоном */
  match: { playerId: number; name: string } | null;
};
