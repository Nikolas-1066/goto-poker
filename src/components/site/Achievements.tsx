"use client";

// Достижения игрока: коротко — значок, название и «у скольких игроков есть». Самые редкие — первыми.
// Нажатие раскрывает: что нужно сделать, когда получено, прогресс.
// На странице игрока (видны всем) — полученные, по кнопке — все; в личном кабинете — сразу все.
// Названия, значки и условия — в src/lib/achievements.ts.

import { useState } from "react";
import type { AchievementView } from "@/lib/achievements";
import { formatSiteDate } from "@/lib/site";
import { Panel } from "./SiteShell";

/** «12%»; меньше процента — «<1%» */
const pct = (a: AchievementView) => (a.percent === 0 ? (a.earned ? "<1%" : "0%") : `${a.percent}%`);

/** Самые редкие — первыми; среди одинаково редких — по порядку списка */
const byRarity = (list: AchievementView[]) => list.map((a, i) => ({ a, i })).sort((x, y) => x.a.percent - y.a.percent || x.i - y.i).map((x) => x.a);

function Tile({ a, open, onToggle }: { a: AchievementView; open: boolean; onToggle: () => void }) {
  const got = !!a.earned;
  const rare = got && a.percent <= 10;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
        got ? (rare ? "border-amber-300/50 bg-amber-300/[0.08] hover:bg-amber-300/[0.12]" : "border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.07]") : "border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04]"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className={`text-xl leading-none ${got ? "" : "opacity-40 grayscale"}`}>{a.icon}</span>
        <span className={`min-w-0 flex-1 truncate text-sm font-bold ${got ? "text-slate-100" : "text-slate-500"}`}>{a.title}</span>
        <span className={`shrink-0 text-xs tabular-nums ${rare ? "font-bold text-amber-300" : "text-slate-500"}`} title="у скольких игроков клуба есть">
          {pct(a)}
        </span>
      </span>
      {open && (
        <span className="mt-2 block border-t border-white/[0.07] pt-2 text-xs text-slate-300">
          <span className="block">{a.text}</span>
          {!got && a.need > 1 && (
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <span className="block h-full rounded-full bg-amber-300/70" style={{ width: `${Math.round((a.have / a.need) * 100)}%` }} />
              </span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {a.have.toLocaleString("ru-RU")} из {a.need.toLocaleString("ru-RU")}
              </span>
            </span>
          )}
          <span className="mt-1 block text-slate-500">
            {got && a.earned ? `Получено ${formatSiteDate(a.earned.at)} · ` : "Ещё не получено · "}
            {a.percent === 0 ? (got ? "есть меньше чем у 1% игроков" : "пока ни у кого нет") : `есть у ${a.percent}% игроков`}
          </span>
        </span>
      )}
    </button>
  );
}

/** showLocked — сразу показывать и ещё не полученные (личный кабинет) */
export function AchievementsPanel({ list, showLocked = false }: { list: AchievementView[]; showLocked?: boolean }) {
  const [all, setAll] = useState(showLocked);
  const [open, setOpen] = useState<string | null>(null);
  const earned = byRarity(list.filter((a) => a.earned));
  const locked = byRarity(list.filter((a) => !a.earned));
  const shown = all ? [...earned, ...locked] : earned;
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
      ) : (
        <div className="grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((a) => (
            <Tile key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-500">Процент — у скольких игроков клуба есть это достижение. Нажмите на достижение, чтобы узнать, как его получить.</p>
    </Panel>
  );
}
