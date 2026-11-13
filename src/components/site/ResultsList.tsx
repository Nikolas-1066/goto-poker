"use client";

// Итоги турниров: по каждому — топ-3 и сколько было игроков (решение владельца).

import { formatSiteDate, playersWord, type SiteResult } from "@/lib/site";
import { formatKo, Muted, PlayerLink, useSite } from "./SiteShell";

const PLACE_STYLE = ["bg-amber-300 text-[#080e15]", "bg-slate-300 text-[#080e15]", "bg-orange-400/90 text-[#080e15]"];

export function ResultsList({ limit }: { limit?: number }) {
  const { data, error, loading } = useSite<{ results: SiteResult[] }>("results");
  if (loading) return <Muted>Загрузка…</Muted>;
  if (!data) return <Muted>{error || "Итоги скоро появятся"}</Muted>;
  const list = limit ? data.results.slice(0, limit) : data.results;
  if (!list.length) return <Muted>Сыгранных турниров пока нет.</Muted>;
  return (
    <div className="divide-y divide-white/[0.06]">
      {list.map((t) => (
        <div key={t.id} className="py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <div className="font-bold">
              {t.name}
              {t.kindLabel && <span className="ml-2 rounded-md bg-amber-300/15 px-1.5 py-0.5 text-xs font-bold text-amber-300">{t.kindLabel}</span>}
            </div>
            <div className="text-sm text-slate-400">
              {formatSiteDate(t.at)} · {playersWord(t.players)}
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {t.top.map((r, i) => (
              <div key={r.playerId} className="flex items-center gap-2 text-sm">
                <span
                  className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-xs font-black tabular-nums ${
                    PLACE_STYLE[Math.min(i, 2)]
                  }`}
                >
                  {r.place}
                </span>
                <PlayerLink id={r.playerId} name={r.name} className="min-w-0 flex-1 truncate font-semibold" />
                {r.ko > 0 && <span className="shrink-0 text-xs text-slate-500">KO {formatKo(r.ko)}</span>}
                {r.points != null && <span className="w-14 shrink-0 text-right font-bold tabular-nums text-amber-200">+{r.points}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
