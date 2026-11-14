"use client";

// Кто вошёл на сайт: общий на всю страницу ответ /api/account (шапка и личный кабинет видят одно и то же).

import { useEffect, useSyncExternalStore } from "react";
import type { AccountMe } from "@/lib/account";
import { telegramInitData, telegramWebApp } from "./telegramApp";

let me: AccountMe | null = null;
/** Открыто в Telegram, но Telegram ещё не привязан к профилю — нужно поделиться номером */
let needLink = false;
let asked = false;
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export function setMe(next: AccountMe & { needLink?: boolean }) {
  needLink = !!next.needLink;
  me = next;
  subs.forEach((fn) => fn());
}

/** null — ещё грузится */
export function useMe(): AccountMe | null {
  const value = useSyncExternalStore(
    subscribe,
    () => me,
    () => null,
  );
  useEffect(() => {
    if (asked) return;
    asked = true;
    loadMe();
  }, []);
  return value;
}

/** Внутри Telegram ещё не привязан номер (показать «Поделиться номером») */
export const tgNeedLink = () => needLink;

/** Узнать, кто вошёл. Внутри Telegram — сначала войти по его данным (без пароля). */
export async function loadMe() {
  const initData = telegramInitData();
  try {
    if (initData) {
      void telegramWebApp();
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "telegram", initData }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.status !== "none") return setMe(d);
        // Telegram не привязан, но игрок мог уже войти паролем — тогда остаётся вошедшим
        const cur = (await (await fetch("/api/account", { cache: "no-store" })).json()) as AccountMe;
        return setMe(cur.status === "none" ? { ...cur, needLink: true } : cur);
      }
    }
    setMe((await (await fetch("/api/account", { cache: "no-store" })).json()) as AccountMe);
  } catch {
    setMe({ status: "none" });
  }
}

/** Действие игрока: POST /api/account. Возвращает текст ошибки или "" */
export async function accountAction(body: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch("/api/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) return d.error ?? "Не получилось";
    setMe(d as AccountMe);
    return "";
  } catch {
    return "Нет связи с сервером";
  }
}
