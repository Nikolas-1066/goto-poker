"use client";

// Telegram-бот в админке (docs/SITE.md, шаг 5): состояние бота, время напоминания, анонс (только владелец),
// кнопки «Отправить итоги игрокам» и «Отправить финалистам», роль в боте в карточке игрока.

import { useCallback, useEffect, useState } from "react";
import { Button, Card, ConfirmButton, Field, inputClass } from "./ui";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.ownerRequired ? "Это может только владелец: войдите с паролем владельца в разделе «Статистика»" : (d.error ?? "Не получилось"));
  return d;
}
const message = (err: unknown) => (err instanceof Error ? err.message : "Не получилось");

type Status = { bot: string | null; token: boolean; error: string | null; reminder: string; linked: number; waiting: number; failed: number };

/** Карточка бота: работает ли, сколько игроков подключили, время напоминания, анонс */
export function TelegramCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reminder, setReminder] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(() => {
    fetch("/api/telegram", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => {
        if (!d) return;
        setStatus(d);
        setReminder(d.reminder);
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function run(body: Record<string, unknown>, done: (d: Record<string, unknown>) => string) {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      setFlash(done(await post(body)));
      load();
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  if (!status) return null;
  return (
    <Card title="Telegram-бот">
      <div className="text-sm">
        {status.bot ? (
          <span className="text-emerald-300">
            Работает: <b>@{status.bot}</b>
          </span>
        ) : status.token ? (
          <span className="text-amber-200">Токен задан, но бот не запустился{status.error ? `: ${status.error}` : ""}</span>
        ) : (
          <span className="text-slate-400">Не подключён: в файле .env.local нет строки TELEGRAM_BOT_TOKEN</span>
        )}
        {status.bot && status.error && <div className="mt-1 text-amber-200">{status.error}</div>}
        <div className="mt-1 text-slate-400">
          Подключили Telegram: {status.linked}
          {status.waiting > 0 && ` · ждут отправки: ${status.waiting}`}
          {status.failed > 0 && ` · не доставлено: ${status.failed}`}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-white/[0.07] pt-3">
        <Field label="Напоминание в день турнира — во сколько">
          <input className={inputClass} type="time" value={reminder} onChange={(e) => setReminder(e.target.value)} />
        </Field>
        <Button disabled={busy || reminder === status.reminder} onClick={() => run({ action: "reminder", time: reminder }, () => "Время напоминания сохранено")}>
          Сохранить
        </Button>
      </div>

      <div className="mt-4 border-t border-white/[0.07] pt-3">
        <div className="mb-1 text-sm text-slate-300">Анонс всем, кто подключил бота (только владелец)</div>
        <textarea className={`${inputClass} min-h-24`} maxLength={3500} value={text} onChange={(e) => setText(e.target.value)} placeholder="В субботу большой турнир — запись уже открыта!" />
        <div className="mt-2 flex">
          <ConfirmButton
            variant="primary"
            disabled={busy || !text.trim()}
            question={`Отправить анонс ${status.linked} игрокам? Отменить отправку будет нельзя.`}
            yes="Отправить"
            onConfirm={() =>
              run({ action: "announce", text }, (d) => {
                setText("");
                return `Анонс отправляется: ${d.to} получателей`;
              })
            }
          >
            Отправить анонс
          </ConfirmButton>
        </div>
      </div>
      {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
      {flash && <div className="mt-2 text-sm text-emerald-300">{flash}</div>}
    </Card>
  );
}

/** Кнопка с результатом: «Отправить итоги игрокам» (после завершения турнира) и «Отправить финалистам» */
export function TelegramSend({ kind, tournamentId }: { kind: "results" | "finalists"; tournamentId?: number }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    try {
      const d = await post(kind === "results" ? { action: "results", tournamentId } : { action: "finalists" });
      setNote({
        ok: true,
        text:
          kind === "results"
            ? d.linked === 0
              ? "Никто из участников ещё не подключил Telegram — отправлять некому"
              : d.sent === 0
                ? `Итоги уже отправлены (${d.linked} из ${d.players} участников с Telegram)`
                : `Итоги отправляются: ${d.sent} из ${d.players} участников (у остальных Telegram не подключён)`
            : d.sent === 0
              ? "Этот текст финалистам уже отправлен (или у них не подключён Telegram)"
              : `Отправляется финалистам: ${d.sent} из ${d.finalists}`,
      });
    } catch (err) {
      setNote({ ok: false, text: message(err) });
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button disabled={busy} onClick={send}>
        {kind === "results" ? "✈️ Отправить итоги игрокам в Telegram" : "✈️ Отправить финалистам в Telegram"}
      </Button>
      {note && <span className={`text-sm ${note.ok ? "text-emerald-300" : "text-red-300"}`}>{note.text}</span>}
    </span>
  );
}

/** Роль в боте (карточка игрока): кому бот пишет о заявках и присылает итоги турнира. Меняет только владелец. */
export function TelegramRole({ playerId }: { playerId: number }) {
  const [state, setState] = useState<{ linked: boolean; role: "admin" | "owner" | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/telegram?player=${playerId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {});
  }, [playerId]);

  if (!state) return null;
  if (!state.linked) return <div className="mt-3 text-sm text-slate-500">Telegram не подключён.</div>;
  return (
    <div className="mt-3 text-sm">
      <div className="text-emerald-300">Telegram подключён</div>
      <label className="mt-2 block text-slate-300">
        Служебные сообщения от бота
        <select
          className={`${inputClass} mt-1`}
          value={state.role ?? ""}
          onChange={async (e) => {
            setError("");
            try {
              setState(await post({ action: "role", playerId, role: e.target.value || null }));
            } catch (err) {
              setError(message(err));
            }
          }}
        >
          <option value="">Не получает (обычный игрок)</option>
          <option value="admin">Админ: заявки на вход и итоги турнира (ники, места, нокауты)</option>
          <option value="owner">Владелец: то же и полный отчёт с кассой</option>
        </select>
      </label>
      {error && <div className="mt-1 text-red-300">{error}</div>}
    </div>
  );
}
