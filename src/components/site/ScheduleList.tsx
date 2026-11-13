"use client";

// Ближайшие турниры карточками — на главной (первые несколько) и на странице «Расписание».

import { formatRub } from "@/lib/cash";
import { formatChips } from "@/lib/clock";
import { dayHint, formatDay } from "@/lib/schedule";
import type { SiteScheduleItem } from "@/lib/site";
import { useState } from "react";
import { SignupBox } from "./Signup";
import { Muted, useSite } from "./SiteShell";

/** hideStarted — открытый сегодня турнир уже показан отдельным блоком «Идёт сейчас» */
export function ScheduleList({ limit, hideStarted = false }: { limit?: number; hideStarted?: boolean }) {
  // после записи или отмены расписание перечитывается (список записавшихся и свободные места)
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useSite<{ today: string; items: SiteScheduleItem[] }>(`schedule&v=${version}`, 60_000, true);
  if (!data) return <Muted>{loading ? "Загрузка…" : error || "Расписание скоро появится"}</Muted>;
  const all = hideStarted ? data.items.filter((it) => !it.started) : data.items;
  const items = limit ? all.slice(0, limit) : all;
  if (!items.length) return <Muted>Ближайших турниров пока нет — загляните позже.</Muted>;
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => {
        const hint = dayHint(it.date, data.today);
        const facts = [
          it.structure && { label: "Стартовый стек", value: formatChips(it.structure.startingStack) },
          it.structure && it.structure.entryPrice > 0 && { label: "Вход", value: formatRub(it.structure.entryPrice) },
          it.seatLimit != null && { label: "Мест", value: String(it.seatLimit) },
        ].filter((x): x is { label: string; value: string } => !!x);
        return (
          <article
            key={it.id}
            className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#0f1822]/90 p-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)] transition hover:border-amber-300/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-slate-400 first-letter:uppercase">{formatDay(it.date)}</div>
                <div className="text-4xl font-black tabular-nums leading-tight">{it.time}</div>
              </div>
              {it.started ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300">Идёт сейчас</span>
              ) : hint ? (
                <span className="rounded-full bg-amber-300/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-300">{hint}</span>
              ) : null}
            </div>
            <h3 className="mt-3 text-xl font-bold leading-tight">{it.name}</h3>
            {it.note && <p className="mt-1 text-sm text-slate-300">{it.note}</p>}
            {facts.length > 0 && (
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[0.07] pt-3">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{f.label}</dt>
                    <dd className="font-bold tabular-nums text-amber-100">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-auto">
              <SignupBox scheduleId={it.id} signups={it.signups} onChange={() => setVersion((v) => v + 1)} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
