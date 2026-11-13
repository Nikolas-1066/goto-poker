"use client";

// Кто вошёл на сайт: общий на всю страницу ответ /api/account (шапка и личный кабинет видят одно и то же).

import { useEffect, useSyncExternalStore } from "react";
import type { AccountMe } from "@/lib/account";

let me: AccountMe | null = null;
let asked = false;
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export function setMe(next: AccountMe) {
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
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: AccountMe) => setMe(d))
      .catch(() => setMe({ status: "none" }));
  }, []);
  return value;
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
