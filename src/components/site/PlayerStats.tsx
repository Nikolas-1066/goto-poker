"use client";

// Статистика игрока: цифры, место в рейтингах и все сыгранные турниры. Одинаково на открытой странице игрока
// и в его личном кабинете.

import { formatSiteDate, type SitePlayer } from "@/lib/site";
import { formatKo, Muted, Panel } from "./SiteShell";

export function PlayerStats({ p }: { p: SitePlayer }) {
  return (
    <>
    <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {[
        ["Очки", p.stats.points.toLocaleString("ru-RU")],
        ["Турниры", p.stats.tournaments],
        ["Победы", p.stats.wins],
        ["Топ-3", p.stats.top3],
        ["Нокауты", formatKo(p.stats.ko)],
        ["ELO", p.eloGames > 0 ? p.elo : "—"],
      ].map(([label, value]) => (
        <div key={label} className="rounded-xl border border-white/[0.08] bg-[#0f1822]/90 px-2 py-4 text-center">
          <div className="bg-gradient-to-b from-amber-100 to-amber-400 bg-clip-text text-2xl font-black tabular-nums text-transparent sm:text-3xl">{value}</div>
          <div className="mt-0.5 text-[11px] uppercase tracking-[0.15em] text-slate-500">{label}</div>
        </div>
      ))}
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Panel title="Место в рейтинге" className="self-start">
        <div className="divide-y divide-white/[0.06]">
          {p.ratings.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-slate-300">{r.label}</span>
              <span className="text-right">
                {r.rank != null ? (
                  <>
                    <b className="text-amber-200">{r.rank}</b> <span className="text-slate-500">из {r.of}</span>
                    <span className="ml-2 tabular-nums text-slate-300">{r.points.toLocaleString("ru-RU")} оч.</span>
                  </>
                ) : (
                  <span className="text-slate-500">ещё не играл</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Турниры">
        {p.tournaments.length === 0 ? (
          <Muted>Сыгранных турниров пока нет.</Muted>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {p.tournaments.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="w-14 shrink-0 text-center">
                  <div className="text-lg font-black tabular-nums leading-tight">{t.place}</div>
                  <div className="text-[11px] text-slate-500">из {t.field}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {t.name}
                    {t.kindLabel && <span className="ml-2 text-xs font-bold text-amber-300">{t.kindLabel}</span>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatSiteDate(t.at)}
                    {t.ko > 0 && ` · KO ${formatKo(t.ko)}`}
                  </div>
                </div>
                <div className="shrink-0 text-right font-bold tabular-nums text-amber-200">{t.points != null ? `+${t.points}` : "—"}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
    </>
  );
}
