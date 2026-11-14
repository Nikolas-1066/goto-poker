// Запуск бота вместе с сайтом (docs/SITE.md, шаг 5): сам ходит в Telegram за сообщениями (long polling —
// ни домен, ни https не нужны), отправляет очередь сообщений и раз в полминуты выполняет фоновые задачи.
// Токен — в переменной TELEGRAM_BOT_TOKEN (файл .env.local). Без токена работают только фоновые задачи турнира.

import { getOffset, markFailed, markSent, pendingOutbox, setOffset } from "../db/telegram";
import { botTick } from "../db/telegramJobs";
import { hasDatabase, updateDb, withDatabase } from "../store";
import { BotError, handleUpdate, type BotReply, type TgUpdate } from "./bot";
import { MENU, type TgMessage } from "./texts";

type BotGlobal = { started: boolean; username: string | null; lastError: string | null };
const g = globalThis as unknown as { __gotoBot?: BotGlobal };
const bot: BotGlobal = (g.__gotoBot ??= { started: false, username: null, lastError: null });

/** Имя бота (@…) — для ссылки «Подключить Telegram»; null — бот не запущен */
export const botUsername = () => bot.username;
export const botLastError = () => bot.lastError;

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ApiResult<T> = { ok: true; result: T } | { ok: false; error_code?: number; description?: string };

async function call<T>(method: string, body: unknown, timeoutMs = 20_000): Promise<ApiResult<T>> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await res.json()) as ApiResult<T>;
}

const MENU_KEYBOARD = { keyboard: [[{ text: MENU.schedule }], [{ text: MENU.mine }, { text: MENU.rating }]], resize_keyboard: true };
const CONTACT_KEYBOARD = { keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };

/** Отправить одно сообщение. Кнопки под сообщением и нижняя клавиатура вместе не бывают — кнопки главнее. */
function send(m: Pick<TgMessage, "chatId" | "text" | "buttons" | "keyboard">) {
  const reply_markup = m.buttons?.length
    ? { inline_keyboard: m.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }
    : m.keyboard === "menu"
      ? MENU_KEYBOARD
      : m.keyboard === "contact"
        ? CONTACT_KEYBOARD
        : undefined;
  return call("sendMessage", { chat_id: m.chatId, text: m.text, ...(reply_markup ? { reply_markup } : {}) });
}

/** Отправить то, что накопилось в очереди */
async function flush() {
  const list = await withDatabase((db) => pendingOutbox(db));
  for (const m of list) {
    try {
      const res = await send({ chatId: m.chatId, text: m.text, buttons: m.buttons ?? undefined });
      // 403 — игрок остановил бота, 400 — чата нет: повторять бессмысленно
      await withDatabase((db) => (res.ok ? markSent(db, m.id) : markFailed(db, m.id, res.description ?? "ошибка", res.error_code === 403 || res.error_code === 400)));
      if (!res.ok && res.error_code === 429) await sleep(3000);
    } catch (err) {
      await withDatabase((db) => markFailed(db, m.id, err instanceof Error ? err.message : "нет связи"));
      return; // связи нет — остальное в следующий раз
    }
    await sleep(40); // не чаще ~25 сообщений в секунду
  }
}

async function handle(update: TgUpdate) {
  let reply: BotReply | undefined;
  try {
    // как запись на сайте: изменение записи и открытого турнира — одной транзакцией
    await updateDb(
      (db) => db.tournament,
      (sqlite, next) => {
        reply = handleUpdate(sqlite, next, update);
      },
    );
  } catch (err) {
    if (err instanceof BotError) reply = { messages: [{ chatId: err.chatId, text: err.message }], ...(err.callbackId ? { callback: { id: err.callbackId } } : {}) };
    else console.error("[bot] ошибка обработки сообщения", err);
  }
  if (!reply) return;
  if (reply.callback) await call("answerCallbackQuery", { callback_query_id: reply.callback.id }).catch(() => {});
  for (const m of reply.messages) await send(m).catch(() => {});
}

async function poll() {
  for (;;) {
    try {
      const offset = await withDatabase((db) => getOffset(db));
      const res = await call<TgUpdate[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 35_000);
      if (!res.ok) {
        // 409 — с этим токеном уже работает другая копия программы
        bot.lastError = res.error_code === 409 ? "С этим токеном уже запущена другая копия программы" : (res.description ?? "ошибка Telegram");
        await sleep(res.error_code === 409 ? 30_000 : 5000);
        continue;
      }
      bot.lastError = null;
      for (const u of res.result) {
        await handle(u);
        await withDatabase((db) => setOffset(db, u.update_id + 1));
      }
      if (res.result.length) await flush().catch(() => {});
    } catch {
      bot.lastError = "Нет связи с Telegram";
      await sleep(5000);
    }
  }
}

async function tick() {
  try {
    if (!(await hasDatabase())) return;
    await updateDb(
      (db) => db.tournament,
      (sqlite, next) => botTick(sqlite, next),
    );
    if (token()) await flush();
  } catch (err) {
    console.error("[bot] фоновая задача не выполнилась", err);
  }
}

/** Запустить один раз на процесс сервера (src/instrumentation.ts) */
export function startBot() {
  if (bot.started) return;
  bot.started = true;
  const timer = setInterval(tick, 30_000);
  timer.unref?.();
  if (token()) connect();
}

/** Узнать имя бота и начать читать сообщения; нет связи — повторить через минуту */
function connect() {
  call<{ username: string }>("getMe", {})
    .then((me) => {
      if (!me.ok) {
        bot.lastError = "Токен бота не подошёл — проверьте .env.local";
        console.error("[bot] токен не подошёл:", me.description);
        return;
      }
      bot.username = me.result.username;
      bot.lastError = null;
      console.log(`[bot] Telegram-бот @${me.result.username} запущен`);
      void poll();
    })
    .catch(() => {
      bot.lastError = "Нет связи с Telegram";
      setTimeout(connect, 60_000).unref?.();
    });
}
