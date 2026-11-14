"use client";

// Личный кабинет игрока (docs/SITE.md, шаг 3): вход и заявка, а после подтверждения — фото, ник, пароль и всё про финал.

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { finalProgress, PASSWORD_MIN, type AccountMe } from "@/lib/account";
import type { SitePlayer } from "@/lib/site";
import { Avatar, fileToJpeg, refreshPhotos } from "./Avatar";
import { PlayerStats } from "./PlayerStats";
import { MySignupsPanel } from "./Signup";
import { GOLD, Muted, OUTLINE, PageTitle, Panel, SiteShell, useSite } from "./SiteShell";
import { closeApp, requestPhone } from "./telegramApp";
import { accountAction, loadMe, tgNeedLink, useMe } from "./useMe";

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
      {me?.status === "none" && (tgNeedLink() ? <TelegramLinkFirst /> : <SignIn />)}
      {me?.status === "pending" && <Pending me={me} />}
      {me?.status === "active" && <Profile me={me} />}
    </SiteShell>
  );
}

// ---------- Мини-приложение: Telegram ещё не привязан ----------

function TelegramLinkFirst() {
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle");

  async function share() {
    setState("waiting");
    if (!(await requestPhone())) return setState("failed");
    // номер уходит боту, бот привязывает его за пару секунд — пробуем войти снова
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      await loadMe();
      if (!tgNeedLink()) return;
    }
    setState("failed");
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle>Вход по Telegram</PageTitle>
      <Panel>
        <p className="text-slate-200">Чтобы войти, поделитесь номером телефона — так мы найдём вас в базе клуба. Пароль не нужен.</p>
        <button type="button" disabled={state === "waiting"} onClick={share} className={`mt-4 w-full rounded-xl px-5 py-3 ${GOLD} disabled:opacity-60`}>
          {state === "waiting" ? "Секунду…" : "📱 Поделиться номером"}
        </button>
        {state === "failed" && (
          <p className="mt-3 text-sm text-amber-200">
            Не получилось. Закройте приложение и нажмите в чате с ботом кнопку «Поделиться номером» внизу — потом откройте приложение снова.
          </p>
        )}
        <button type="button" onClick={() => closeApp()} className={`mt-3 w-full rounded-xl px-5 py-2.5 text-sm ${OUTLINE}`}>
          Вернуться в чат с ботом
        </button>
      </Panel>
    </div>
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
        <p className="mt-2 text-sm text-slate-300">Записываться на турниры можно уже сейчас — в «Расписании».</p>
        <div className="mt-2">
          <TelegramLink linked={me.telegram} />
        </div>
        <Logout className="mt-4" />
      </Panel>
    </div>
  );
}

/** «Подключить Telegram»: ссылка в бота с одноразовым кодом — привязка без ввода номера */
function TelegramLink({ linked }: { linked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [off, setOff] = useState(false);

  async function post(action: "link" | "unlink") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await res.json();
      if (!res.ok) setError(d.error ?? "Не получилось");
      else if (action === "link") window.location.assign(d.url);
      else setOff(true);
    } catch {
      setError("Нет связи с сервером");
    }
    setBusy(false);
  }

  if (error) return <span className="text-sm text-red-300">{error}</span>;
  if (linked && !off) {
    return (
      <span className="text-sm text-emerald-300">
        Telegram подключён{" "}
        <button type="button" disabled={busy} onClick={() => post("unlink")} className="text-slate-500 underline hover:text-slate-300">
          отключить
        </button>
      </span>
    );
  }
  return (
    <button type="button" disabled={busy} onClick={() => post("link")} className="text-sm font-semibold text-sky-300 hover:text-sky-200 disabled:opacity-50">
      Подключить Telegram — напоминания и запись в боте
    </button>
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
      <ProfileHead me={me} />

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

      <FinalPath zones={me.zones} />
      <MySignupsPanel />


      <h2 className="mb-4 text-2xl font-black tracking-tight sm:text-3xl">Моя статистика</h2>
      <MyStats playerId={me.playerId} name={me.name} />
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

/** Путь в финал месяца: полоса — сколько очков набрано из тех, что нужны для зоны финала */
function FinalPath({ zones }: { zones: Extract<AccountMe, { status: "active" }>["zones"] }) {
  const month = zones[0];
  if (!month) return null;
  const { zone } = month;
  const bar = finalProgress(zone);
  const inZone = zone.state === "in";
  return (
    <Panel title={`Путь в финал · ${month.label.replace(/^[^·]+· /, "")}`} className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className={`text-lg font-bold sm:text-xl ${inZone ? "text-emerald-300" : ""}`}>
          {zone.state === "none" ? "Вы ещё не играли в этом месяце" : inZone ? `Вы в зоне финала — ${zone.rank} место` : `Сейчас ${zone.rank} место`}
        </div>
        {bar && (
          <div className="tabular-nums text-slate-400">
            <b className="text-2xl font-black text-amber-200">{bar.have.toLocaleString("ru-RU")}</b>
            {!inZone && <> из {bar.need.toLocaleString("ru-RU")}</>} оч.
          </div>
        )}
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuenow={bar?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`h-full rounded-full ${inZone ? "bg-gradient-to-r from-emerald-400 to-emerald-300" : "bg-gradient-to-r from-amber-400 to-amber-200"}`}
          style={{ width: `${bar?.percent ?? 0}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-slate-400">
        {zone.state === "none" && "Сыграйте турнир — и появитесь в рейтинге месяца."}
        {zone.state === "in" && `В финал выходят первые ${zone.zone}. Держите место до конца месяца.`}
        {zone.state === "out" &&
          (zone.gap > 0
            ? `В финал выходят первые ${zone.zone}. Чтобы войти в их число сейчас, нужно набрать ещё минимум ${zone.gap} оч.`
            : `В финал выходят первые ${zone.zone}. У вас столько же очков, сколько у ${zone.zone}-го места, — осталось его обойти.`)}
      </p>
    </Panel>
  );
}

const ICON = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:border-amber-300/50 hover:text-amber-200";
const LINK = "text-sm text-slate-400 hover:text-amber-200 disabled:opacity-50";

const Pencil = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M13.5 3.5l3 3L7 16l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const Camera = () => (
  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7h3l1.5-2h5L14 7h3v9H3V7z" />
    <circle cx="10" cy="11.5" r="2.7" />
  </svg>
);

/** Шапка кабинета: фото (нажатие — заменить), ник с карандашом, смена пароля, выход */
function ProfileHead({ me }: { me: Extract<AccountMe, { status: "active" }> }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nick, setNick] = useState<string | null>(null); // не null — ник правят
  const [passOpen, setPassOpen] = useState(false);

  async function run(body: () => Promise<Record<string, unknown>>, after?: () => void) {
    setBusy(true);
    try {
      const err = await accountAction(await body());
      setError(err);
      if (!err) after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
    }
    setBusy(false);
  }

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-4">
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) run(async () => ({ action: "photo", data: await fileToJpeg(picked) }), refreshPhotos);
          }}
        />
        <button type="button" disabled={busy} onClick={() => file.current?.click()} className="relative shrink-0" title={me.photo ? "Заменить фото" : "Загрузить фото"}>
          <Avatar id={me.playerId} name={me.name} version={me.photo} className="h-20 w-20 border-2 border-amber-300/70 text-4xl text-amber-200 sm:h-24 sm:w-24" />
          <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/60 bg-[#0b131c] text-amber-200">
            <Camera />
          </span>
        </button>

        <div className="min-w-0 flex-1">
          {nick == null ? (
            <div className="flex items-center gap-2">
              <h1 className="truncate text-3xl font-black tracking-tight sm:text-4xl">{me.name}</h1>
              <button type="button" onClick={() => setNick(me.name)} className={ICON} title="Изменить ник" aria-label="Изменить ник">
                <Pencil />
              </button>
            </div>
          ) : (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => ({ action: "rename", name: nick }), () => setNick(null));
              }}
            >
              <input className={`${INPUT} max-w-xs`} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={60} autoFocus required aria-label="Ник" />
              <button type="submit" disabled={busy || nick.trim() === me.name} className={`rounded-xl px-4 py-2 text-sm ${GOLD} disabled:opacity-50`}>
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => {
                  setNick(null);
                  setError("");
                }}
                className={`rounded-xl px-4 py-2 text-sm ${OUTLINE}`}
              >
                Отмена
              </button>
            </form>
          )}
          <p className="mt-1 text-sm text-slate-400">{me.phone} · телефон виден только вам и клубу</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            <button type="button" onClick={() => setPassOpen(!passOpen)} className={LINK}>
              Сменить пароль
            </button>
            {me.photo && (
              <button type="button" disabled={busy} onClick={() => run(async () => ({ action: "removePhoto" }), refreshPhotos)} className={LINK}>
                Убрать фото
              </button>
            )}
            <TelegramLink linked={me.telegram} />
          </div>
        </div>
        <Logout />
      </div>
      <ErrorLine text={error} />
      {passOpen && (
        <div className="mt-4 max-w-md">
          <PasswordPanel onClose={() => setPassOpen(false)} />
        </div>
      )}
    </div>
  );
}

function PasswordPanel({ onClose }: { onClose: () => void }) {
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
    <Panel title="Смена пароля">
      <form onSubmit={submit} className="space-y-3">
        <Label text="Текущий пароль">
          <input className={INPUT} type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} required />
        </Label>
        <Label text={`Новый пароль (от ${PASSWORD_MIN} символов)`}>
          <input className={INPUT} type="password" autoComplete="new-password" minLength={PASSWORD_MIN} value={next} onChange={(e) => setNext(e.target.value)} required />
        </Label>
        <ErrorLine text={error} />
        {done && <div className="text-sm text-emerald-300">Пароль изменён. На других устройствах нужно войти заново.</div>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className={`rounded-xl px-4 py-2 text-sm ${GOLD} disabled:opacity-60`}>
            Сменить пароль
          </button>
          <button type="button" onClick={onClose} className={`rounded-xl px-4 py-2 text-sm ${OUTLINE}`}>
            {done ? "Закрыть" : "Отмена"}
          </button>
        </div>
        <p className="text-xs text-slate-500">Забыли текущий пароль? Его сбросит администратор клуба.</p>
      </form>
    </Panel>
  );
}
