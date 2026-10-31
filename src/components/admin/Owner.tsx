"use client";

// Режим владельца: «Статистика» и изменение правил рейтинга — только с паролем владельца.
// Пароль задаётся здесь же при первом входе (кто первый открыл — тот и задаёт, поэтому сразу после
// обновления это делает владелец). Забыли — файл-сброс на ноутбуке (README-RU.txt).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, inputClass } from "./ui";

type OwnerState = { set: boolean; owner: boolean };

export function useOwner() {
  const [state, setState] = useState<OwnerState | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/owner", { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) return setError(d.error ?? "Ошибка");
    setError("");
    setState(d);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return { state, error, refresh };
}

async function ownerPost(body: unknown) {
  const res = await fetch("/api/owner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? "Ошибка");
}

/** Вход владельца или (если пароль ещё не задан) — придумать пароль */
export function OwnerLogin({ state, note, onDone }: { state: OwnerState; note?: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setup = !state.set;

  async function submit() {
    setError("");
    if (setup && password !== repeat) return setError("Пароли не совпадают");
    setBusy(true);
    try {
      await ownerPost({ action: setup ? "setup" : "login", password });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={setup ? "Пароль владельца" : "Вход владельца"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="text-sm text-slate-400">
          {note ?? "Этот раздел — только для владельца."}{" "}
          {setup
            ? "Пароль владельца ещё не задан — придумайте его (не такой, как у админки). Его будете знать только вы."
            : "Введите пароль владельца."}
        </div>
        <input
          className={inputClass}
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          placeholder={setup ? "Новый пароль владельца" : "Пароль владельца"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {setup && (
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            placeholder="Повторите пароль"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        )}
        {error && <div className="text-sm text-red-300">{error}</div>}
        <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={busy || !password}>
          {setup ? "Задать пароль и войти" : "Войти"}
        </Button>
      </form>
    </Card>
  );
}

/** Строка «Режим владельца» со сменой пароля и выходом */
export function OwnerBar({ onChanged }: { onChanged: () => void }) {
  const [changing, setChanging] = useState(false);
  const [old, setOld] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function change() {
    try {
      await ownerPost({ action: "change", old, password });
      setChanging(false);
      setOld("");
      setPassword("");
      setMessage({ ok: true, text: "Пароль владельца изменён" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-slate-400">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">🔑 Режим владельца</span>
        <Button variant="ghost" onClick={() => setChanging(!changing)}>
          Сменить пароль
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await fetch("/api/owner", { method: "DELETE" });
            onChanged();
          }}
        >
          Выйти
        </Button>
      </div>
      {changing && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={inputClass} type="password" placeholder="Старый пароль" value={old} onChange={(e) => setOld(e.target.value)} />
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            placeholder="Новый пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button variant="primary" disabled={!old || !password} onClick={change}>
            Сохранить
          </Button>
        </div>
      )}
      {message && <div className={`mt-1 text-xs ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</div>}
    </div>
  );
}

/** Показать содержимое только владельцу; остальным — вход владельца */
export function OwnerGate({ children }: { children: (relock: () => void) => ReactNode }) {
  const { state, error, refresh } = useOwner();
  if (error) return <div className="mx-auto max-w-md text-sm text-red-300">{error}</div>;
  if (!state) return <div className="py-20 text-center text-slate-500">Загрузка…</div>;
  if (!state.owner) {
    return (
      <div className="mx-auto max-w-md">
        <OwnerLogin state={state} onDone={refresh} />
      </div>
    );
  }
  return (
    <>
      <div className="mx-auto mb-4 max-w-5xl">
        <OwnerBar onChanged={refresh} />
      </div>
      {children(refresh)}
    </>
  );
}
