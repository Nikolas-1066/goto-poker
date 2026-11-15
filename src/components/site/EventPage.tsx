"use client";

// Страница турнира из расписания (открывается по нажатию на карточку): когда, что за турнир, структура и цены,
// где проходит, полный список участников и лист ожидания, запись.

import Link from "next/link";
import { useState } from "react";
import { formatRub } from "@/lib/cash";
import { formatChips } from "@/lib/clock";
import { dayHint, formatDay } from "@/lib/schedule";
import type { SiteEvent } from "@/lib/site";
import { SignupBox, SignupLists } from "./Signup";
import { Muted, Panel, SiteShell, useSite } from "./SiteShell";

export function EventPage({ id }: { id: number }) {
  const [version, setVersion] = useState(0);
  const ok = Number.isInteger(id) && id > 0;
  const { data: ev, error, loading } = useSite<SiteEvent>(ok ? `event&id=${id}&v=${version}` : null, 60_000, true);
  const today = useSite<{ today: string }>("schedule").data?.today ?? "";

  return (
    <SiteShell>
      <Link href="/schedule" className="text-sm text-slate-400 hover:text-amber-200">
        ← Расписание
      </Link>
      {!ev && <Muted>{loading ? "Загрузка…" : error || "Турнир не найден"}</Muted>}
      {ev && <Event ev={ev} today={today} onChange={() => setVersion((v) => v + 1)} />}
    </SiteShell>
  );
}

function Event({ ev, today, onChange }: { ev: SiteEvent; today: string; onChange: () => void }) {
  const d = ev.details;
  const hint = today ? dayHint(ev.date, today) : "";
  const k = (n: number) => formatChips(n);
  const structure = d
    ? [
        { label: "Стартовый стек", value: k(d.startingStack) },
        d.rebuyUntilLevel > 0 && { label: "Re-entry", value: `${k(d.rebuyStack)} · до конца ${d.rebuyUntilLevel} ур.` },
        d.addonUntilLevel > 0 && { label: "Аддон", value: `${k(d.addonStack)} / двойной ${k(d.doubleAddonStack)} · на перерыве после ${d.addonUntilLevel} ур.` },
        d.levelMinutes && { label: "Уровни", value: `по ${d.levelMinutes} мин` },
      ].filter((x): x is { label: string; value: string } => !!x)
    : [];
  const prices = d
    ? [
        d.prices.entry > 0 && { label: "Вход", value: formatRub(d.prices.entry) },
        d.prices.reentry > 0 && { label: "Re-entry", value: formatRub(d.prices.reentry) },
        d.prices.addon > 0 && { label: "Аддон", value: formatRub(d.prices.addon) },
        d.prices.doubleAddon > 0 && { label: "Двойной аддон", value: formatRub(d.prices.doubleAddon) },
      ].filter((x): x is { label: string; value: string } => !!x)
    : [];

  return (
    <>
      <div className="mb-5 mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-slate-400">
            <span className="first-letter:uppercase">{formatDay(ev.date)}</span>
            {ev.started ? (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300">Идёт сейчас</span>
            ) : hint ? (
              <span className="rounded-full bg-amber-300/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-300">{hint}</span>
            ) : null}
          </div>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-5xl">{ev.name}</h1>
        </div>
        <div className="text-5xl font-black tabular-nums leading-none sm:text-6xl">{ev.time}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {(ev.note || d?.description) && (
            <Panel title="О турнире">
              {ev.note && <p className="whitespace-pre-line text-slate-100">{ev.note}</p>}
              {d?.description && <p className={`whitespace-pre-line text-slate-300 ${ev.note ? "mt-2" : ""}`}>{d.description}</p>}
            </Panel>
          )}

          {(structure.length > 0 || prices.length > 0) && (
            <Panel title="Структура и цены">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {[...structure, ...prices].map((f) => (
                  <div key={`${f.label}-${f.value}`}>
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{f.label}</dt>
                    <dd className="font-bold tabular-nums text-amber-100">{f.value}</dd>
                  </div>
                ))}
              </dl>
              {d?.friendBonus && (
                <p className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-2 text-sm text-emerald-200">
                  Бонус: {d.friendBonus} (на эту игру).
                </p>
              )}
            </Panel>
          )}

          <Panel title="Где проходит">
            {ev.place.address ? (
              <>
                <p className="font-semibold text-slate-100">{ev.place.address}</p>
                {ev.place.how && <p className="mt-1 whitespace-pre-line text-sm text-slate-300">{ev.place.how}</p>}
                <a
                  href={`https://yandex.ru/maps/?text=${encodeURIComponent(ev.place.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-sky-300 hover:text-sky-200"
                >
                  Открыть на карте ↗
                </a>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                Адрес — на странице{" "}
                <Link href="/about" className="text-amber-200 hover:underline">
                  «О клубе»
                </Link>
                .
              </p>
            )}
          </Panel>
        </div>

        {/* на телефоне запись — сразу под названием, на широком экране — справа */}
        <Panel title="Запись" className="order-first self-start lg:order-none">
          {ev.seatLimit != null && <p className="mb-1 text-sm text-slate-400">Мест: {ev.seatLimit}</p>}
          <SignupBox scheduleId={ev.id} signups={ev.signups} onChange={onChange} lists={false} />
        </Panel>
      </div>

      <div className="mt-4">
        <SignupLists signups={ev.signups} />
      </div>
    </>
  );
}
