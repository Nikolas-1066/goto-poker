"use client";

// Запись на турнир (docs/SITE.md, шаг 4): блок на карточке турнира и «Мои записи» в личном кабинете.

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatDay } from "@/lib/schedule";
import { GUEST_NAME_MAX, MAX_GUESTS, seatsWord, signupLabel, type MySignup, type SiteSignups } from "@/lib/signup";
import { Avatar } from "./Avatar";
import { GOLD, Muted, OUTLINE, Panel, PlayerLink } from "./SiteShell";
import { useMe } from "./useMe";

// ---------- Мои записи: одни на всю страницу ----------

let mine: MySignup[] | null = null;
/** Для кого загружен список: меняется при входе и выходе */
let loadedFor = "";
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};
const setMine = (next: MySignup[]) => {
  mine = next;
  subs.forEach((fn) => fn());
};

function loadMine() {
  fetch("/api/signup", { cache: "no-store" })
    .then((r) => r.json())
    .then((d: { mine?: MySignup[] }) => setMine(d.mine ?? []))
    .catch(() => setMine([]));
}

/** null — ещё грузится */
export function useMySignups(): MySignup[] | null {
  const me = useMe();
  const value = useSyncExternalStore(
    subscribe,
    () => mine,
    () => null,
  );
  const who = me ? `${me.status}:${me.status === "none" ? "" : me.name}` : "";
  useEffect(() => {
    // после входа или выхода список перечитывается
    if (who && loadedFor !== who) {
      loadedFor = who;
      loadMine();
    }
  }, [who]);
  return value;
}

/** Записаться или отменить. Возвращает текст ошибки или "" */
async function signupAction(body: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) return d.error ?? "Не получилось";
    setMine(d.mine ?? []);
    return "";
  } catch {
    return "Нет связи с сервером";
  }
}

const INPUT = "w-full rounded-lg border border-white/10 bg-[#0b131c] px-3 py-2 text-base text-slate-100 outline-none focus:border-amber-300/60 sm:text-sm";

// ---------- Блок записи на карточке турнира ----------

export function SignupBox({ scheduleId, signups, onChange }: { scheduleId: number; signups: SiteSignups; onChange: () => void }) {
  const me = useMe();
  const all = useMySignups();
  const my = all?.find((s) => s.scheduleId === scheduleId) ?? null;
  const [form, setForm] = useState(false);
  const [guests, setGuests] = useState(0);
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    const err = await signupAction({ ...body, scheduleId });
    setError(err);
    setBusy(false);
    if (!err) setForm(false);
    onChange();
  }

  const people = signups.going.length + signups.waiting.length;
  const shown = showAll ? signups.going : signups.going.slice(0, 8);
  const noRoom = signups.free != null && signups.free < 1 + guests && !(my?.state === "going" && signups.free + 1 + my.guests >= 1 + guests);

  return (
    <div className="mt-4 border-t border-white/[0.07] pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-semibold text-slate-200">{people ? `Записалось: ${signups.seats}` : "Пока никто не записался"}</span>
        {signups.free != null && <span className={signups.free > 0 ? "text-emerald-300" : "text-amber-300"}>{signups.free > 0 ? `свободно ${seatsWord(signups.free)}` : "мест нет"}</span>}
      </div>

      {shown.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((s, i) => (
            <span key={`${s.playerId}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] py-0.5 pl-0.5 pr-2.5 text-xs">
              <Avatar id={s.playerId ?? 0} name={s.name} version={s.playerId == null ? null : undefined} className="h-5 w-5 text-[10px] text-slate-300" />
              {s.playerId != null ? <PlayerLink id={s.playerId} name={signupLabel(s)} className="truncate" /> : <span className="truncate">{signupLabel(s)}</span>}
            </span>
          ))}
          {signups.going.length > shown.length && (
            <button type="button" onClick={() => setShowAll(true)} className="rounded-full px-2 py-0.5 text-xs text-slate-400 hover:text-amber-200">
              ещё {signups.going.length - shown.length}
            </button>
          )}
        </div>
      )}
      {signups.waiting.length > 0 && <div className="mt-2 text-xs text-slate-400">Лист ожидания: {signups.waiting.map(signupLabel).join(", ")}</div>}

      {my && !form && (
        <div className={`mt-3 rounded-xl border p-3 text-sm ${my.state === "going" ? "border-emerald-400/40 bg-emerald-400/[0.07]" : "border-amber-300/40 bg-amber-300/[0.07]"}`}>
          <div className="font-bold">
            {my.state === "going" ? "Вы записаны" : `Вы в листе ожидания — ${my.queue}-й в очереди`}
            {my.guests > 0 && ` · с вами ${my.guests} ${my.guests === 1 ? "гость" : "гостя"}`}
          </div>
          {my.state === "waiting" && <div className="mt-0.5 text-xs text-slate-300">Освободится место — вы пройдёте автоматически.</div>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {signups.open && (
              <button
                type="button"
                disabled={busy}
                className="text-sm text-slate-300 hover:text-amber-200"
                onClick={() => {
                  setGuests(my.guests);
                  setNames(my.guestNames);
                  setForm(true);
                }}
              >
                Изменить гостей
              </button>
            )}
            <button type="button" disabled={busy} className="text-sm text-slate-300 hover:text-red-300" onClick={() => run({ action: "cancel" })}>
              Отменить запись
            </button>
          </div>
        </div>
      )}

      {signups.open && me?.status === "none" && (
        <Link href="/profile" className={`mt-3 block rounded-xl px-4 py-2.5 text-center text-sm ${GOLD}`}>
          Войти и записаться
        </Link>
      )}

      {signups.open && me && me.status !== "none" && !my && !form && (
        <button type="button" onClick={() => setForm(true)} className={`mt-3 w-full rounded-xl px-4 py-2.5 text-sm ${GOLD}`}>
          Записаться
        </button>
      )}

      {form && (
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Сколько гостей с вами</div>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {Array.from({ length: MAX_GUESTS + 1 }, (_, n) => (
              <button
                key={n}
                type="button"
                onClick={() => setGuests(n)}
                className={`rounded-lg px-2 py-2 text-sm ${guests === n ? GOLD : "border border-white/10 bg-white/[0.04] font-semibold text-slate-300 hover:bg-white/[0.08]"}`}
              >
                {n === 0 ? "Один" : `+${n}`}
              </button>
            ))}
          </div>
          {guests > 0 && (
            <div className="mt-2 space-y-1.5">
              {Array.from({ length: guests }, (_, i) => (
                <input
                  key={i}
                  className={INPUT}
                  placeholder={`Ник гостя ${i + 1} — по желанию`}
                  maxLength={GUEST_NAME_MAX}
                  value={names[i] ?? ""}
                  onChange={(e) => {
                    const next = [...names];
                    next[i] = e.target.value;
                    setNames(next);
                  }}
                />
              ))}
            </div>
          )}
          {noRoom && <div className="mt-2 text-xs text-amber-300">Свободных мест на всех не хватает — вы встанете в лист ожидания.</div>}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} onClick={() => run({ action: "signup", guests, guestNames: names.slice(0, guests) })} className={`flex-1 rounded-xl px-4 py-2.5 text-sm ${GOLD} disabled:opacity-60`}>
              {busy ? "Секунду…" : my ? "Сохранить" : noRoom ? "В лист ожидания" : "Записаться"}
            </button>
            <button type="button" onClick={() => setForm(false)} className={`rounded-xl px-4 py-2.5 text-sm ${OUTLINE}`}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
    </div>
  );
}

// ---------- «Мои записи» в личном кабинете ----------

export function MySignupsPanel() {
  const list = useMySignups();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Panel title="Мои записи на турниры" className="mb-6">
      {!list && <Muted>Загрузка…</Muted>}
      {list?.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-slate-300">Вы пока никуда не записаны.</span>
          <Link href="/schedule" className={`rounded-xl px-4 py-2 text-sm ${GOLD}`}>
            Выбрать турнир
          </Link>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="divide-y divide-white/[0.06]">
          {list.map((s) => (
            <div key={s.scheduleId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="w-24 shrink-0">
                <div className="text-xs text-slate-400 first-letter:uppercase">{formatDay(s.date)}</div>
                <div className="text-2xl font-black tabular-nums leading-tight">{s.time}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{s.name}</div>
                <div className={`text-sm ${s.state === "going" ? "text-emerald-300" : "text-amber-300"}`}>
                  {s.state === "going" ? (s.started ? "Турнир открыт — вас ждут" : "Вы записаны") : `Лист ожидания — ${s.queue}-й в очереди`}
                  {s.guests > 0 && <span className="text-slate-400"> · гостей: {s.guests}{s.guestNames.length ? ` (${s.guestNames.join(", ")})` : ""}</span>}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                className={`rounded-xl px-4 py-2 text-sm ${OUTLINE}`}
                onClick={async () => {
                  setBusy(true);
                  setError(await signupAction({ action: "cancel", scheduleId: s.scheduleId }));
                  setBusy(false);
                }}
              >
                Отменить
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
    </Panel>
  );
}
