// Разговор с игроком в Telegram-боте (docs/SITE.md, шаг 5): что пришло от Telegram → что ответить.
// Работает с базой, но сам в Telegram не ходит: возвращает список сообщений, отправляет их runner.ts.
// Вызывается внутри updateDb (как запись на сайте): запись и открытый турнир меняются одной транзакцией.

import type { DatabaseSync } from "node:sqlite";
import { finalZone } from "../account";
import { type Account } from "../db/accounts";
import { openPeriod, PERIOD_LABEL, standingsOf } from "../db/periods";
import { playerCard } from "../db/playercard";
import { listSchedule } from "../db/schedule";
import { cancelSignup, mySignups, signUp, syncSignups, unsyncSignup } from "../db/signups";
import { accountByTelegram, displayName, linkByCode, linkByPhone } from "../db/telegram";
import { clubToday, sortSchedule } from "../schedule";
import { MAX_GUESTS, signupOpen } from "../signup";
import type { Db } from "../types";
import { appButton, cancelledText, COMING_OK, HELLO, linkedText, MENU, NOT_YOUR_CONTACT, pendingText, ratingText, signedText, whenText, type TgButton, type TgMessage } from "./texts";

/** То немногое из сообщения Telegram, что нужно боту */
export type TgUpdate = {
  update_id: number;
  message?: {
    chat: { id: number; type?: string };
    from?: { id: number; first_name?: string; last_name?: string };
    text?: string;
    contact?: { phone_number: string; user_id?: number };
  };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number } } };
};

/** Ответ бота: сообщения и, для нажатой кнопки, короткая подпись «принято» */
export type BotReply = { messages: TgMessage[]; callback?: { id: string; text?: string } };

const UPCOMING = 8;

function scheduleMessage(db: DatabaseSync, chatId: number, account: Account, now: number): TgMessage {
  const items = sortSchedule(listSchedule(db, clubToday(now)))
    .filter((it) => it.status !== "cancelled" && signupOpen(it, now))
    .slice(0, UPCOMING);
  if (!items.length) return { chatId, text: "Ближайших турниров пока нет — загляните позже.", keyboard: "menu" };
  const mine = new Map(mySignups(db, account, now).map((s) => [s.scheduleId, s]));
  const lines = ["📅 Ближайшие турниры", ""];
  const buttons: TgButton[][] = [];
  for (const it of items) {
    const my = mine.get(it.id);
    lines.push(`• ${whenText(it)} — ${it.name}${my ? (my.state === "going" ? " ✅ вы записаны" : " ⏳ вы в листе ожидания") : ""}`);
    if (!my) buttons.push([{ text: `Записаться: ${whenText(it)}`, data: `s:${it.id}` }]);
  }
  lines.push("", buttons.length ? "Нажмите кнопку, чтобы записаться." : "Вы записаны на все ближайшие турниры.");
  return { chatId, text: lines.join("\n"), buttons, keyboard: "menu" };
}

function mineMessage(db: DatabaseSync, chatId: number, account: Account, now: number): TgMessage {
  const list = mySignups(db, account, now);
  if (!list.length) return { chatId, text: "Вы пока никуда не записаны. Нажмите «Расписание», чтобы выбрать турнир.", keyboard: "menu" };
  const lines = ["📝 Ваши записи", ""];
  for (const s of list) {
    lines.push(`• ${whenText(s)} — ${s.name}: ${s.state === "going" ? "записаны" : `лист ожидания, номер ${s.queue}`}${s.guests ? `, гостей ${s.guests}` : ""}`);
  }
  return { chatId, text: lines.join("\n"), buttons: list.map((s) => [{ text: `Отменить: ${whenText(s)}`, data: `c:${s.scheduleId}` }]), keyboard: "menu" };
}

function ratingMessage(db: DatabaseSync, chatId: number, account: Account): TgMessage {
  const card = account.playerId != null ? playerCard(db, account.playerId) : null;
  if (!card) return { chatId, text: "Рейтинг появится, когда администратор подтвердит вашу заявку.", keyboard: "menu" };
  const month = openPeriod(db, "month");
  const zone = month ? { label: `${PERIOD_LABEL.month} · ${month.name}`, zone: finalZone(standingsOf(db, month), card.player.id, month.finalistsN) } : null;
  return { chatId, text: ratingText(card.player.name, zone, card.stats), keyboard: "menu" };
}

/** Обработать одно сообщение или нажатие кнопки. Ошибки с понятным текстом уходят игроку ответом. */
export function handleUpdate(db: DatabaseSync, next: Db, update: TgUpdate, now = Date.now()): BotReply {
  const cb = update.callback_query;
  const msg = update.message;
  const chatId = cb?.message?.chat.id ?? msg?.chat.id;
  const fromId = cb?.from.id ?? msg?.from?.id;
  if (chatId == null || fromId == null) return { messages: [] };
  // бот работает только в личной переписке — в группах молчит
  if (msg?.chat.type && msg.chat.type !== "private") return { messages: [] };
  const say = (text: string, extra: Partial<TgMessage> = {}): BotReply => ({ messages: [{ chatId, text, ...extra }], ...(cb ? { callback: { id: cb.id } } : {}) });

  try {
    // ---- привязка: ссылка из кабинета или «Поделиться номером» ----
    const start = /^\/start(?:\s+(\S+))?/.exec(msg?.text ?? "");
    if (start?.[1]) {
      const linked = linkByCode(db, start[1], fromId, now);
      if (linked) return { messages: [{ chatId, text: linkedText(displayName(db, linked)), keyboard: "menu" }, { chatId, text: "Всё то же самое — в приложении клуба:", buttons: [appButton()] }] };
    }
    if (msg?.contact) {
      if (msg.contact.user_id !== fromId) return say(NOT_YOUR_CONTACT, { keyboard: "contact" });
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
      const { account, created } = linkByPhone(db, fromId, msg.contact.phone_number, name, now);
      const first: TgMessage = { chatId, text: created ? pendingText(account.name) : linkedText(displayName(db, account)), keyboard: "menu" };
      return { messages: [first, { chatId, text: "Всё то же самое — в приложении клуба:", buttons: [appButton()] }] };
    }

    const account = accountByTelegram(db, fromId);
    if (!account) return say(HELLO, { keyboard: "contact" });

    // ---- кнопки под сообщениями ----
    if (cb) {
      const [cmd, arg, arg2] = (cb.data ?? "").split(":");
      const scheduleId = Number(arg);
      if (cmd === "s") {
        // выбрать число гостей
        const row = Array.from({ length: MAX_GUESTS + 1 }, (_, n) => ({ text: n === 0 ? "Я один" : `+${n}`, data: `g:${scheduleId}:${n}` }));
        return say("Сколько гостей придёт с вами?", { buttons: [row] });
      }
      if (cmd === "g") {
        signUp(db, scheduleId, { account }, { guests: Number(arg2) }, now);
        syncSignups(db, next, scheduleId, now);
        const my = mySignups(db, account, now).find((s) => s.scheduleId === scheduleId);
        return say(my ? signedText(my) : "Вы записаны.", { keyboard: "menu" });
      }
      if (cmd === "c") {
        const my = mySignups(db, account, now).find((s) => s.scheduleId === scheduleId);
        const c = cancelSignup(db, { scheduleId, account }, now);
        unsyncSignup(db, next, c.scheduleId, c.playerId, true, now);
        syncSignups(db, next, scheduleId, now);
        return say(my ? cancelledText(my.name, whenText(my)) : "Запись отменена.", { keyboard: "menu" });
      }
      if (cmd === "come") return say(COMING_OK);
      return say("Эта кнопка устарела — откройте «Расписание» заново.", { keyboard: "menu" });
    }

    // ---- нижнее меню ----
    const text = (msg?.text ?? "").trim();
    if (text === MENU.schedule || text === "/schedule") return { messages: [scheduleMessage(db, chatId, account, now)] };
    if (text === MENU.mine || text === "/my") return { messages: [mineMessage(db, chatId, account, now)] };
    if (text === MENU.rating || text === "/rating") return { messages: [ratingMessage(db, chatId, account)] };
    return say(`${displayName(db, account)}, выберите, что нужно, кнопками внизу: расписание и запись, ваши записи или рейтинг.`, { keyboard: "menu" });
  } catch (err) {
    // ошибка правила («запись уже закрыта» и т.п.) — понятным текстом; изменения этого сообщения откатит вызывающий
    throw new BotError(chatId, err instanceof Error ? err.message : "Что-то пошло не так, попробуйте ещё раз", cb?.id);
  }
}

/** Ошибка с текстом для игрока: транзакция откатывается, а игроку уходит объяснение */
export class BotError extends Error {
  constructor(
    public chatId: number,
    message: string,
    public callbackId?: string,
  ) {
    super(message);
  }
}
