"use client";

// Достижения игрока: на странице игрока (видны всем) — полученные; в личном кабинете — все, с прогрессом.
// У каждого — «есть у N% игроков».

import { useState } from "react";
import { GROUP_LABEL, percentText, type AchievementGroup, type AchievementView } from "@/lib/achievements";
import { formatSiteDate } from "@/lib/site";
import { Panel } from "./SiteShell";

const ORDER: AchievementGroup[] = ["games", "wins", "ko", "finals", "special"];

function Tile({ a }: { a: AchievementView }) {
  const got = !!a.earned;
  const rare = got && a.percent > 0 && a.percent <= 10;
  return (
    <div
      className={`flex gap-3 rounded-xl border p-3 ${
        got ? (rare ? "border-amber-300/50 bg-amber-300/[0.08]" : "border-white/[0.1] bg-white/[0.04]") : "border-white/[0.06] bg-white/[0.015]"
      }`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${got ? "bg-amber-300/15" : "bg-white/[0.04] opacity-40 grayscale"}`}>{a.icon}</div>
      <div className="min-w-0 flex-1">
        <div className={`font-bold leading-tight ${got ? "text-slate-100" : "text-slate-400"}`}>{a.title}</div>
        <div className="text-xs text-slate-400">{a.text}</div>
        {!got && a.need > 1 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-amber-300/70" style={{ width: `${Math.round((a.have / a.need) * 100)}%` }} />
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
              {a.have.toLocaleString("ru-RU")} из {a.need.toLocaleString("ru-RU")}
            </span>
          </div>
        )}
        <div className={`mt-1 text-[11px] ${rare ? "font-semibold text-amber-300" : "text-slate-500"}`}>
          {got && a.earned ? `${formatSiteDate(a.earned.at)} · ` : ""}
          {percentText(a.percent, got)}
        </div>
      </div>
    </div>
  );
}

/** showLocked — показывать и ещё не полученные (в личном кабинете) */
export function AchievementsPanel({ list, showLocked = false }: { list: AchievementView[]; showLocked?: boolean }) {
  const [all, setAll] = useState(showLocked);
  const earned = list.filter((a) => a.earned);
  const shown = all ? list : earned;
  return (
    <Panel
      title={`Достижения · ${earned.length} из ${list.length}`}
      action={
        <button type="button" onClick={() => setAll(!all)} className="text-xs text-slate-400 hover:text-amber-200">
          {all ? "Только полученные" : "Показать все"}
        </button>
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-slate-400">Пока нет — первое достижение даётся за первый сыгранный турнир.</p>
      ) : all ? (
        <div className="space-y-4">
          {ORDER.map((g) => {
            const items = shown.filter((a) => a.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{GROUP_LABEL[g]}</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((a) => (
                    <Tile key={a.id} a={a} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {/* самые редкие — первыми */}
          {[...shown]
            .sort((a, b) => a.percent - b.percent)
            .map((a) => (
              <Tile key={a.id} a={a} />
            ))}
        </div>
      )}
    </Panel>
  );
}
