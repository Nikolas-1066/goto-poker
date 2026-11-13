"use client";

// Вход игроков на сайт в админке (docs/SITE.md, шаг 3): заявки на вход, вход и фото в карточке игрока,
// сообщение финалистам для личного кабинета.

import { useCallback, useEffect, useRef, useState } from "react";
import { FINALIST_MESSAGE_MAX, type AccountRequest } from "@/lib/account";
import { formatPhone, type Player } from "@/lib/players";
import { Avatar, fileToJpeg, refreshPhotos } from "@/components/site/Avatar";
import { Button, Card, inputClass } from "./ui";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? "Не получилось");
  return d;
}
const message = (err: unknown) => (err instanceof Error ? err.message : "Не получилось");
const fmtDate = (ts: number) => new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// ---------- Заявки на вход (страница «Игроки») ----------

/** players — игроки базы, чтобы привязать заявку к другому игроку вручную; onChange — после подтверждения список игроков мог измениться */
export function AccountRequests({ players, onChange }: { players: Player[]; onChange: () => void }) {
  const [requests, setRequests] = useState<AccountRequest[]>([]);
  const [target, setTarget] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    fetch("/api/accounts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => {});
  }, []);

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      const d = await post(body);
      setRequests(d.requests ?? []);
      setFlash(done);
      onChange();
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  if (!requests.length && !flash) return null;
  return (
    <Card title={`Заявки на вход на сайт · ${requests.length}`}>
      <p className="mb-3 text-sm text-slate-400">
        Игрок зарегистрировался на сайте и ждёт подтверждения. Подтверждайте, только если уверены, что это тот самый человек: после этого он сможет менять ник и фото этого
        игрока.
      </p>
      {flash && <div className="mb-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="mb-2 text-sm text-red-300">{error}</div>}
      <div className="divide-y divide-white/[0.07]">
        {requests.map((r) => {
          const picked = target[r.id] ?? "";
          return (
            <div key={r.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-bold">{r.name}</span>
                <span className="text-sm tabular-nums text-slate-400">
                  {formatPhone(r.phone)} · {fmtDate(r.createdAt)}
                </span>
              </div>
              <div className={`mt-1 text-sm ${r.match ? "text-emerald-300" : "text-amber-200"}`}>
                {r.match ? `Телефон совпал с игроком «${r.match.name}»` : "Такого телефона в базе нет — будет создан новый игрок"}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className={`${inputClass} w-auto max-w-full`} value={picked} onChange={(e) => setTarget({ ...target, [r.id]: e.target.value })}>
                  <option value="">{r.match ? `Привязать к «${r.match.name}»` : "Создать нового игрока"}</option>
                  {players
                    .filter((p) => p.id !== r.match?.playerId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        Привязать к «{p.name}» ({formatPhone(p.phone)})
                      </option>
                    ))}
                </select>
                <Button variant="primary" disabled={busy} onClick={() => act({ action: "confirm", id: r.id, playerId: picked || null }, `Заявка «${r.name}» подтверждена`)}>
                  Подтвердить
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => window.confirm(`Отклонить заявку «${r.name}»? Она будет удалена.`) && act({ action: "reject", id: r.id }, `Заявка «${r.name}» отклонена`)}
                >
                  Отклонить
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- Вход и фото в карточке игрока ----------

export function PlayerAccount({ playerId, name }: { playerId: number; name: string }) {
  const [state, setState] = useState<{ account: { phone: string; confirmedAt: number | null } | null; photo: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch(`/api/accounts?player=${playerId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {});
  }, [playerId]);
  useEffect(load, [load]);

  async function act(body: () => Promise<Record<string, unknown>>) {
    setBusy(true);
    setError("");
    try {
      const d = await post({ ...(await body()), playerId });
      if (d.password) setPassword(d.password);
      refreshPhotos();
      load();
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  if (!state) return null;
  return (
    <Card title="Сайт: фото и вход">
      <div className="flex items-center gap-4">
        <Avatar id={playerId} name={name} version={state.photo} className="h-16 w-16 border border-white/15 text-2xl text-amber-200" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) act(async () => ({ action: "photo", data: await fileToJpeg(file) }));
            }}
          />
          <Button disabled={busy} onClick={() => input.current?.click()}>
            {state.photo ? "Заменить фото" : "Загрузить фото"}
          </Button>
          {state.photo && (
            <Button variant="ghost" disabled={busy} onClick={() => act(async () => ({ action: "removePhoto" }))}>
              Убрать фото
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-white/[0.07] pt-3 text-sm">
        {state.account ? (
          <>
            <div className="text-slate-300">
              Вход на сайт есть: логин <span className="tabular-nums">{formatPhone(state.account.phone)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => window.confirm(`Сбросить пароль игрока «${name}»? Старый пароль перестанет работать.`) && act(async () => ({ action: "resetPassword" }))}
              >
                Сбросить пароль
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  window.confirm(`Отключить вход игрока «${name}» на сайт? Сам игрок и его история останутся, зарегистрироваться можно будет заново.`) &&
                  act(async () => ({ action: "removeAccount" }))
                }
              >
                Отключить вход
              </Button>
            </div>
            {password && (
              <div className="mt-3 rounded-lg border border-amber-300/40 bg-amber-300/[0.08] p-3">
                Временный пароль: <b className="text-lg tabular-nums tracking-widest text-amber-200">{password}</b>
                <div className="mt-1 text-xs text-slate-400">Продиктуйте его игроку — он виден только сейчас. После входа игрок сменит пароль в личном кабинете.</div>
              </div>
            )}
          </>
        ) : (
          <div className="text-slate-400">Входа на сайт нет. Игрок регистрируется сам на сайте — заявка появится в разделе «Игроки».</div>
        )}
      </div>
      {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
    </Card>
  );
}

// ---------- Сообщение финалистам (страница «Расписание», рядом с «О клубе») ----------

export function FinalistMessageEditor() {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    fetch("/api/accounts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { finalistMessage: "" }))
      .catch(() => ({ finalistMessage: "" }))
      .then((d) => {
        setSaved(d.finalistMessage ?? "");
        setDraft(d.finalistMessage ?? "");
      });
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      const d = await post({ action: "finalistMessage", text: draft });
      setSaved(d.finalistMessage);
      setDraft(d.finalistMessage);
      setFlash("Сохранено — финалисты увидят это в личном кабинете");
    } catch (err) {
      setError(message(err));
    }
    setBusy(false);
  }

  if (saved == null) return null;
  return (
    <Card title="Сообщение финалистам">
      <p className="mb-2 text-sm text-slate-400">
        Когда месяц закрыт, каждый прошедший в финал видит в личном кабинете на сайте плашку «Вы в финале» и этот текст. Например: дата и время финала, что взять с собой.
        После сыгранного финала плашка пропадает сама.
      </p>
      <textarea
        className={`${inputClass} min-h-28`}
        maxLength={FINALIST_MESSAGE_MAX}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setFlash("");
        }}
        placeholder="Финал месяца — 5 декабря в 18:00. Приходите за 20 минут до начала."
      />
      {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
      {flash && <div className="mt-2 text-sm text-emerald-300">{flash}</div>}
      <Button className="mt-3" variant="primary" disabled={busy || draft === saved} onClick={save}>
        Сохранить
      </Button>
    </Card>
  );
}
