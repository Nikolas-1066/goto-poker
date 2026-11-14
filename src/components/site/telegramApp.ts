"use client";

// Сайт открыт как мини-приложение внутри Telegram (docs/SITE.md, шаг 6). Telegram передаёт подписанные данные
// пользователя в адресе страницы (#tgWebAppData=…); по ним сервер узнаёт игрока — вход без пароля.
// Официальный скрипт Telegram подключается только внутри Telegram: он разворачивает окно на весь экран
// и умеет попросить номер телефона.

type TgWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  requestContact?: (cb?: (ok: boolean) => void) => void;
};
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const KEY = "goto_tg_init";

/** initData из адреса страницы (первое открытие) или из памяти вкладки (переходы внутри приложения) */
export function telegramInitData(): string {
  try {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fromHash = hash.get("tgWebAppData");
    if (fromHash) {
      sessionStorage.setItem(KEY, fromHash);
      return fromHash;
    }
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export const inTelegram = () => telegramInitData() !== "";

let loading: Promise<TgWebApp | null> | null = null;

/** Подключить скрипт Telegram (один раз) и сказать Telegram, что приложение готово */
export function telegramWebApp(): Promise<TgWebApp | null> {
  if (!inTelegram()) return Promise.resolve(null);
  loading ??= new Promise((resolve) => {
    if (window.Telegram?.WebApp) return resolve(window.Telegram.WebApp);
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.async = true;
    s.onload = () => {
      const app = window.Telegram?.WebApp ?? null;
      try {
        app?.ready();
        app?.expand();
      } catch {
        // старая версия Telegram — работаем без этого
      }
      resolve(app);
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

/** Попросить номер телефона (Telegram покажет своё окно; номер уйдёт боту). true — игрок согласился. */
export async function requestPhone(): Promise<boolean> {
  const app = await telegramWebApp();
  if (!app?.requestContact) return false;
  return new Promise((resolve) => {
    try {
      app.requestContact!((ok) => resolve(!!ok));
    } catch {
      resolve(false);
    }
  });
}

export async function closeApp() {
  (await telegramWebApp())?.close();
}
