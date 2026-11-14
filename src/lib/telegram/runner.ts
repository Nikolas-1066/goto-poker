// Запуск бота вместе с сайтом (docs/SITE.md, шаг 5): сам ходит в Telegram за сообщениями (long polling —
// ни домен, ни https не нужны), отправляет очередь сообщений и раз в полминуты выполняет фоновые задачи.
// Токен — в переменной TELEGRAM_BOT_TOKEN (файл .env.local). Без токена работают только фоновые задачи турнира.

import { getOffset, markFailed, markSent, pendingOutbox, setOffset } from "../db/telegram";
import { botTick } from "../db/telegramJobs";
import { hasDatabase, publicUrl, updateDb, withDatabase } from "../store";
import { BotError, handleUpdate, type BotReply, type TgUpdate } from "./bot";
import { MENU, type TgMessage } from "./texts";

type BotGlobal = { started: boolean; username: string | null; lastError: string | null; menuUrl: string | null | undefined };
const g = globalThis as unknown as { __gotoBot?: BotGlobal };
const bot: BotGlobal = (g.__gotoBot ??= { started: false, username: null, lastError: null, menuUrl: undefined });

/** Адрес мини-приложения, с которым бот сейчас работает (null — адреса нет) */
let appUrl: string | null = null;

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

/** Кнопки под сообщением; кнопки мини-приложения без адреса сайта пропускаются */
function inline(buttons: TgMessage["buttons"]) {
  const rows = (buttons ?? [])
    .map((row) => row.filter((b) => !b.app || appUrl).map((b) => (b.app ? { text: b.text, web_app: { url: `${appUrl}${b.data}` } } : { text: b.text, callback_data: b.data })))
    .filter((row) => row.length);
  return rows.length ? rows : null;
}

/** Отправить одно сообщение. Кнопки под сообщением и нижняя клавиатура вместе не бывают — кнопки главнее. */
async function send(m: Pick<TgMessage, "chatId" | "text" | "buttons" | "keyboard">) {
  const rows = inline(m.buttons);
  // сообщение было только ради кнопки мини-приложения, а адреса нет — не отправляем
  if (m.buttons?.length && !rows && !m.keyboard) return { ok: true as const, result: null };
  const reply_markup = rows
    ? { inline_keyboard: rows }
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

/** Кнопка «Приложение» слева от поля ввода в боте: открывает сайт клуба внутри Telegram (нужен https-адрес) */
async function syncMenuButton() {
  appUrl = await publicUrl();
  if (!bot.username || bot.menuUrl === appUrl) return;
  const menu_button = appUrl ? { type: "web_app", text: "Приложение", web_app: { url: `${appUrl}/profile` } } : { type: "default" };
  const res = await call("setChatMenuButton", { menu_button }).catch(() => null);
  if (res?.ok) {
    bot.menuUrl = appUrl;
    if (appUrl) console.log(`[bot] мини-приложение: ${appUrl}`);
  }
}

async function tick() {
  try {
    if (token()) await syncMenuButton();
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
  // раз в 15 секунд: адрес мини-приложения меняется при каждом запуске npm run tunnel
  const timer = setInterval(tick, 15_000);
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
      void syncMenuButton();
      void poll();
    })
    .catch(() => {
      bot.lastError = "Нет связи с Telegram";
      setTimeout(connect, 60_000).unref?.();
    });
}
