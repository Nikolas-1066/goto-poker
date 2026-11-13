"use client";

// Ближайшие турниры — на главной (первые несколько) и на странице «Расписание».

import { formatRub } from "@/lib/cash";
import { formatChips } from "@/lib/clock";
import { dayHint, formatDay } from "@/lib/schedule";
import type { SiteScheduleItem } from "@/lib/site";
import { Muted, useSite } from "./SiteShell";

export function ScheduleList({ limit }: { limit?: number }) {
  const { data, error, loading } = useSite<{ today: string; items: SiteScheduleItem[] }>("schedule");
  if (loading) return <Muted>Загрузка…</Muted>;
  if (!data) return <Muted>{error || "Расписание скоро появится"}</Muted>;
  const items = limit ? data.items.slice(0, limit) : data.items;
  if (!items.length) return <Muted>Ближайших турниров пока нет — загляните позже.</Muted>;
  return (
    <div className="divide-y divide-white/[0.06]">
      {items.map((it) => {
        const hint = dayHint(it.date, data.today);
        const details = [
          it.structure && `стек ${formatChips(it.structure.startingStack)}`,
          it.structure && it.structure.entryPrice > 0 && `вход ${formatRub(it.structure.entryPrice)}`,
          it.seatLimit != null && `до ${it.seatLimit} мест`,
        ].filter(Boolean);
        return (
          <div key={it.id} className="flex items-start gap-4 py-3">
            <div className="w-24 shrink-0 sm:w-28">
              {hint && <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">{hint}</div>}
              <div className="text-sm text-slate-300">{formatDay(it.date)}</div>
              <div className="text-2xl font-black tabular-nums">{it.time}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold leading-tight">{it.name}</div>
              {details.length > 0 && <div className="mt-0.5 text-sm text-slate-400">{details.join(" · ")}</div>}
              {it.note && <div className="mt-1 text-sm text-slate-300">{it.note}</div>}
              {it.started && (
                <div className="mt-1 inline-block rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.15em] text-emerald-300">
                  Идёт сегодня
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
