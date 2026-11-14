"use client";

// Подтверждение «Точно?» окном на самой странице — вместо window.confirm: во встроенных браузерах
// (например, в приложении Claude) окно браузера не показывается и молча отвечает «нет».
// askConfirm(текст) → Promise<boolean>; окно рисует <ConfirmHost />, он стоит в AdminShell.

import { useEffect, useRef, useSyncExternalStore } from "react";

type Ask = { text: string; yes: string; resolve: (ok: boolean) => void };

let current: Ask | null = null;
let hosts = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

/** Спросить подтверждение. yes — подпись кнопки согласия («Да», «Удалить»…) */
export function askConfirm(text: string, yes = "Да"): Promise<boolean> {
  // окна нет на странице (не админка) — по-старому
  if (hosts === 0) return Promise.resolve(window.confirm(text));
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { text, yes, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  const a = current;
  current = null;
  emit();
  a?.resolve(ok);
}

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const yesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
    };
  }, []);

  useEffect(() => {
    if (!ask) return;
    yesRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask]);

  if (!ask) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => answer(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#101923] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="whitespace-pre-line text-base text-slate-100">{ask.text}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => answer(false)} className="min-h-11 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.1]">
            Нет
          </button>
          <button
            ref={yesRef}
            type="button"
            onClick={() => answer(true)}
            className="min-h-11 rounded-lg bg-amber-300 px-3 py-2 text-sm font-bold text-[#080e15] hover:bg-amber-200"
          >
            {ask.yes}
          </button>
        </div>
      </div>
    </div>
  );
}
