// Тексты Telegram-бота (docs/SITE.md, шаг 5) — чистые функции: что бот пишет игрокам, админам и владельцу.

import { finalZoneText, type FinalZone } from "../account";
import { formatKo, type TournamentReport } from "../report";
import { formatDay } from "../schedule";
import type { MySignup } from "../signup";

/**
 * Кнопка под сообщением: подпись и команда, которая придёт боту при нажатии.
 * app — кнопка открывает мини-приложение (data — страница сайта, например "/schedule"); без адреса сайта не показывается.
 */
export type TgButton = { text: string; data: string; app?: boolean };

/** Кнопка «Открыть приложение» — сайт клуба внутри Telegram */
export const appButton = (path = "/profile"): TgButton[] => [{ text: "📱 Открыть приложение клуба", data: path, app: true }];
/** Сообщение бота: текст, кнопки под ним (ряды), нижняя клавиатура (menu / contact / none — не менять) */
export type TgMessage = { chatId: number; text: string; buttons?: TgButton[][]; keyboard?: "menu" | "contact" };

export const MENU = { schedule: "📅 Расписание", mine: "📝 Мои записи", rating: "🏆 Мой рейтинг" };

export const whenText = (it: { date: string; time: string }) => `${formatDay(it.date)}, ${it.time}`;

export const HELLO =
  "Это бот клуба «ГОТО ПОКЕР». Здесь расписание турниров, запись и ваш рейтинг.\n\nЧтобы начать, нажмите кнопку «Поделиться номером» внизу — так мы найдём вас в базе клуба.";

export const linkedText = (name: string) => `Готово, ${name}! Telegram подключён. Теперь сюда будут приходить напоминания о турнирах, а записаться можно кнопками ниже.`;

export const pendingText = (name: string) =>
  `${name}, вашего номера пока нет в базе клуба — заявка отправлена администратору. Записываться на турниры уже можно, а рейтинг и статистика появятся после подтверждения.`;

export const NOT_YOUR_CONTACT = "Нужен именно ваш номер: нажмите кнопку «Поделиться номером» внизу, а не пересылайте чужой контакт.";

export const signedText = (s: Pick<MySignup, "name" | "date" | "time" | "guests" | "state" | "queue">) =>
  s.state === "going"
    ? `✅ Вы записаны: ${s.name}, ${whenText(s)}${s.guests ? `. С вами гостей: ${s.guests}` : ""}.`
    : `⏳ Мест нет — вы в листе ожидания, номер ${s.queue}: ${s.name}, ${whenText(s)}. Освободится место — пройдёте автоматически, я напишу.`;

export const cancelledText = (name: string, when: string) => `Запись отменена: ${name}, ${when}.`;

export const promotedText = (s: { name: string; date: string; time: string }) => `🎉 Освободилось место — вы записаны: ${s.name}, ${whenText(s)}.`;

export const reminderText = (s: { name: string; time: string; guests: number }) =>
  `Напоминание: сегодня в ${s.time} — ${s.name}. Вы записаны${s.guests ? ` (гостей с вами: ${s.guests})` : ""}. Приходите за 15–20 минут до начала.`;

export const askComingText = (name: string) => `Турнир «${name}» уже идёт, а вас ещё нет. Вы придёте?`;
export const COMING_OK = "Отлично, ждём вас! Регистрация открыта, пока не закрылись ребаи.";
export const removedText = (name: string) => `Регистрация на «${name}» закрыта — ваша запись снята. Ждём вас на следующих турнирах!`;

/** Мой рейтинг: зона финала месяца и общие цифры */
export function ratingText(name: string, month: { label: string; zone: FinalZone } | null, stats: { tournaments: number; wins: number; ko: number; points: number }) {
  const lines = [`🏆 ${name}`];
  if (month) lines.push("", month.label, finalZoneText(month.zone), ...(month.zone.state === "none" ? [] : [`Очков в этом месяце: ${month.zone.points}`]));
  lines.push("", `За всё время: турниров ${stats.tournaments}, побед ${stats.wins}, нокаутов ${formatKo(stats.ko)}, очков ${stats.points}`);
  return lines.join("\n");
}

const placeText = (p: { place: number | null; placeTo: number | null }) => (p.place == null ? "—" : p.placeTo ? `${p.place}–${p.placeTo}` : String(p.place));

/** Итоги турнира одному участнику: место, очки, нокауты, место в рейтинге */
/** achievements — новые достижения за этот турнир строкой («🎩 Хет-трик, 🥇 Первая победа»), пусто — нет */
export function resultText(r: TournamentReport, me: { place: number | null; placeTo: number | null; ko: number; points: number | null }, name: string, achievements = "") {
  const lines = [`🏁 ${r.tournament.name} — итоги`, `Ваше место: ${placeText(me)} из ${r.tournament.players}`];
  if (me.points != null) lines.push(`Очки: +${me.points}`);
  if (me.ko) lines.push(`Нокауты: ${formatKo(me.ko)}`);
  const row = r.rating?.participants.find((p) => p.name === name);
  if (row && r.rating) lines.push(`Рейтинг (${r.rating.periodName}): ${row.before ?? "—"} → ${row.after} место, всего ${row.points} оч.`);
  if (achievements) lines.push("", `🏆 Новые достижения: ${achievements}`);
  return lines.join("\n");
}

/** Итоги турнира админам: ники, места и нокауты — без кассы */
export function staffReportText(r: TournamentReport) {
  const lines = [`🏁 Турнир завершён: ${r.tournament.name}`, `Игроков ${r.tournament.players}, входов ${r.tournament.entries}`, ""];
  for (const p of r.places) lines.push(`${placeText(p)}. ${p.name}${p.ko ? ` — KO ${formatKo(p.ko)}` : ""}`);
  return lines.join("\n");
}

export const requestText = (name: string, phone: string, known: boolean, from: "site" | "bot") =>
  `🆕 Заявка на вход (${from === "bot" ? "из бота" : "с сайта"}): ${name}, ${phone}. ${known ? "Телефон есть в базе." : "Новый человек — такого телефона в базе нет."} Подтвердить — в админке, «Игроки».`;

export const finalistText = (periods: string[], message: string, achievements = "") =>
  `★ Поздравляем — вы в финале: ${periods.join(", ")}!${message ? `\n\n${message}` : "\n\nДату и время финала сообщит клуб."}${achievements ? `\n\n🏆 Новые достижения: ${achievements}` : ""}`;

/** Telegram не принимает сообщения длиннее 4096 символов */
export const clip = (text: string, max = 4000) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
