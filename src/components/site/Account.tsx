"use client";

// Личный кабинет игрока (docs/SITE.md, шаг 3): вход и заявка, а после подтверждения — фото, ник, пароль и всё про финал.

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { finalZoneText, PASSWORD_MIN, type AccountMe } from "@/lib/account";
import type { SitePlayer } from "@/lib/site";
import { Avatar, fileToJpeg, refreshPhotos } from "./Avatar";
import { PlayerStats } from "./PlayerStats";
import { GOLD, Muted, OUTLINE, PageTitle, Panel, SiteShell, useSite } from "./SiteShell";
import { accountAction, useMe } from "./useMe";

const INPUT = "w-full rounded-lg border border-white/10 bg-[#0b131c] px-3 py-2.5 text-base text-slate-100 outline-none focus:border-amber-300/60";
const Label = ({ text, children }: { text: string; children: ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{text}</span>
    {children}
  </label>
);
const ErrorLine = ({ text }: { text: string }) => (text ? <div className="text-sm text-red-300">{text}</div> : null);

export function ProfilePage() {
  const me = useMe();
  return (
    <SiteShell>
      {!me && <Muted>Загрузка…</Muted>}
      {me?.status === "none" && <SignIn />}
      {me?.status === "pending" && <Pending me={me} />}
      {me?.status === "active" && <Profile me={me} />}
    </SiteShell>
  );
}

// ---------- Вход и заявка ----------

function SignIn() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await accountAction(mode === "login" ? { action: "login", phone, password } : { action: "register", name, phone, password }));
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle sub={mode === "login" ? "Телефон и пароль, которые вы указали при регистрации." : "Заявку подтвердит администратор клуба — после этого откроется личный кабинет."}>
        {mode === "login" ? "Вход для игроков" : "Регистрация"}
      </PageTitle>
      <Panel>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className={`rounded-lg px-3 py-2 text-sm ${mode === m ? GOLD : "font-semibold text-slate-300 hover:bg-white/[0.06]"}`}
            >
              {m === "login" ? "Вход" : "Регистрация"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <Label text="Имя или ник">
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={60} required />
            </Label>
          )}
          <Label text="Телефон">
            <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 900 123-45-67" required />
          </Label>
          <Label text={mode === "register" ? `Придумайте пароль (от ${PASSWORD_MIN} символов)` : "Пароль"}>
            <input
              className={INPUT}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              minLength={mode === "register" ? PASSWORD_MIN : undefined}
              required
            />
          </Label>
          <ErrorLine text={error} />
          <button type="submit" disabled={busy} className={`w-full rounded-xl px-5 py-3 ${GOLD} disabled:opacity-60`}>
            {busy ? "Секунду…" : mode === "login" ? "Войти" : "Отправить заявку"}
          </button>
        </form>
        {mode === "login" && <p className="mt-3 text-center text-xs text-slate-500">Забыли пароль? Подойдите к администратору клуба — он его сбросит.</p>}
      </Panel>
    </div>
  );
}

function Pending({ me }: { me: Extract<AccountMe, { status: "pending" }> }) {
  return (
    <div className="mx-auto max-w-md">
      <PageTitle>Заявка отправлена</PageTitle>
      <Panel>
        <p className="text-slate-200">
          {me.name}, ваша заявка ждёт подтверждения в клубе. Как только администратор её подтвердит, здесь откроется личный кабинет.
        </p>
        <p className="mt-2 text-sm text-slate-400">Телефон: {me.phone}. Чтобы было быстрее, скажите администратору на ближайшей игре.</p>
        <Logout className="mt-4" />
      </Panel>
    </div>
  );
}

function Logout({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => accountAction({ action: "logout" })} className={`rounded-xl px-4 py-2 text-sm ${OUTLINE} ${className}`}>
      Выйти
    </button>
  );
}

// ---------- Личный кабинет ----------

function Profile({ me }: { me: Extract<AccountMe, { status: "active" }> }) {
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <Avatar id={me.playerId} name={me.name} version={me.photo} className="h-20 w-20 border-2 border-amber-300/70 text-4xl text-amber-200 sm:h-24 sm:w-24" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-3xl font-black tracking-tight sm:text-4xl">{me.name}</h1>
          <p className="text-sm text-slate-400">{me.phone} · телефон виден только вам и клубу</p>
        </div>
        <Logout />
      </div>

      {me.finalistOf.length > 0 && (
        <section className="mb-5 rounded-2xl border border-amber-300/50 bg-gradient-to-b from-amber-300/[0.16] to-transparent p-5 shadow-[0_0_60px_-25px_rgba(252,211,77,0.8)]">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-300">★ Вы в финале</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight">Поздравляем — вы финалист: {me.finalistOf.map((l) => l.replace(/^[^·]+· /, "")).join(", ")}</h2>
          {me.finalistMessage ? (
            <p className="mt-2 whitespace-pre-line text-slate-200">{me.finalistMessage}</p>
          ) : (
            <p className="mt-2 text-slate-300">Дату и время финала сообщит клуб.</p>
          )}
        </section>
      )}

        <Panel title="Путь в финал" className="mb-6">
          {me.zones.length === 0 ? (
            <Muted>Сейчас рейтинг не идёт.</Muted>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {me.zones.map(({ label, zone }) => (
                <div key={label} className={`rounded-xl border p-3 ${zone.state === "in" ? "border-emerald-400/40 bg-emerald-400/[0.07]" : "border-white/[0.08] bg-white/[0.03]"}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-bold">{label}</span>
                    {zone.state !== "none" && <span className="shrink-0 font-bold tabular-nums text-amber-200">{zone.points.toLocaleString("ru-RU")} оч.</span>}
                  </div>
                  <div className={`mt-1 text-sm ${zone.state === "in" ? "text-emerald-200" : "text-slate-300"}`}>{finalZoneText(zone)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>


      <h2 className="mb-4 text-2xl font-black tracking-tight sm:text-3xl">Моя статистика</h2>
      <MyStats playerId={me.playerId} name={me.name} />

      <h2 className="mb-4 mt-8 text-2xl font-black tracking-tight sm:text-3xl">Настройки</h2>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <PhotoPanel me={me} />
        <NickPanel key={me.name} name={me.name} />
        <PasswordPanel />
      </div>
    </>
  );
}

/** Те же цифры и история турниров, что видны всем на странице игрока. name — чтобы после смены ника перечитать. */
function MyStats({ playerId, name }: { playerId: number; name: string }) {
  const { data, error, loading } = useSite<SitePlayer>(`player&id=${playerId}&n=${encodeURIComponent(name)}`);
  if (loading) return <Muted>Загрузка…</Muted>;
  if (!data) return <Muted>{error || "Не удалось загрузить"}</Muted>;
  return <PlayerStats p={data} />;
}

function PhotoPanel({ me }: { me: Extract<AccountMe, { status: "active" }> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(body: () => Promise<Record<string, unknown>>) {
    setBusy(true);
    try {
      setError(await accountAction(await body()));
      refreshPhotos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
    }
    setBusy(false);
  }

  return (
    <Panel title="Фото">
      <div className="flex items-center gap-4">
        <Avatar id={me.playerId} name={me.name} version={me.photo} className="h-16 w-16 border border-white/15 text-2xl text-amber-200" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) run(async () => ({ action: "photo", data: await fileToJpeg(file) }));
            }}
          />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`rounded-xl px-4 py-2 text-sm ${GOLD} disabled:opacity-60`}>
            {busy ? "Секунду…" : me.photo ? "Заменить фото" : "Загрузить фото"}
          </button>
          {me.photo && (
            <button type="button" disabled={busy} onClick={() => run(async () => ({ action: "removePhoto" }))} className={`rounded-xl px-4 py-2 text-sm ${OUTLINE}`}>
              Убрать
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Фото видно всем на сайте: в рейтинге и итогах турниров. Без фото показывается первая буква ника.</p>
      <ErrorLine text={error} />
    </Panel>
  );
}

function NickPanel({ name }: { name: string }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await accountAction({ action: "rename", name: value }));
    setBusy(false);
  }

  return (
    <Panel title="Ник">
      <form onSubmit={submit} className="flex gap-2">
        <input className={INPUT} value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} required />
        <button type="submit" disabled={busy || value.trim() === name} className={`shrink-0 rounded-xl px-4 py-2 text-sm ${GOLD} disabled:opacity-50`}>
          Сохранить
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">Под этим именем вы показаны на сайте и на табло в клубе.</p>
      <ErrorLine text={error} />
    </Panel>
  );
}

function PasswordPanel() {
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDone(false);
    const err = await accountAction({ action: "password", old, password: next });
    setError(err);
    setBusy(false);
    if (!err) {
      setOld("");
      setNext("");
      setDone(true);
    }
  }

  return (
    <Panel title="Пароль">
      <form onSubmit={submit} className="space-y-3">
        <Label text="Текущий пароль">
          <input className={INPUT} type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} required />
        </Label>
        <Label text={`Новый пароль (от ${PASSWORD_MIN} символов)`}>
          <input className={INPUT} type="password" autoComplete="new-password" minLength={PASSWORD_MIN} value={next} onChange={(e) => setNext(e.target.value)} required />
        </Label>
        <ErrorLine text={error} />
        {done && <div className="text-sm text-emerald-300">Пароль изменён. На других устройствах нужно войти заново.</div>}
        <button type="submit" disabled={busy} className={`rounded-xl px-4 py-2 text-sm ${OUTLINE} disabled:opacity-60`}>
          Сменить пароль
        </button>
      </form>
    </Panel>
  );
}
