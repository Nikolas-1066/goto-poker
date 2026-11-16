"use client";

// Достижения игрока — медали. Цвет медали — по редкости (у скольких игроков клуба есть):
// легендарное ≤ 5%, эпическое ≤ 15%, редкое ≤ 40%, обычное — остальные. Самые редкие — первыми.
// Наверху блока — сколько собрано и самое редкое из полученных. Нажатие на медаль — что нужно сделать, прогресс, дата.
// На странице игрока (видны всем) — полученные, по кнопке — все; в личном кабинете — сразу все.
// Названия, значки и условия — в src/lib/achievements.ts.

import { useState } from "react";
import type { AchievementView } from "@/lib/achievements";
import { formatSiteDate } from "@/lib/site";

type Tier = { name: string; ring: string; glow: string; text: string; chip: string };

const TIERS: Tier[] = [
  {
    name: "Легендарное",
    ring: "from-amber-200 via-amber-400 to-orange-500",
    glow: "shadow-[0_0_28px_-4px_rgba(251,191,36,0.75)]",
    text: "text-amber-300",
    chip: "bg-amber-300/15 text-amber-200 ring-1 ring-amber-300/40",
  },
  {
    name: "Эпическое",
    ring: "from-fuchsia-300 via-purple-500 to-indigo-500",
    glow: "shadow-[0_0_24px_-6px_rgba(192,132,252,0.7)]",
    text: "text-purple-300",
    chip: "bg-purple-400/15 text-purple-200 ring-1 ring-purple-400/40",
  },
  {
    name: "Редкое",
    ring: "from-sky-300 via-sky-500 to-blue-600",
    glow: "shadow-[0_0_20px_-8px_rgba(56,189,248,0.6)]",
    text: "text-sky-300",
    chip: "bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/40",
  },
  { name: "Обычное", ring: "from-slate-300 via-slate-400 to-slate-600", glow: "", text: "text-slate-300", chip: "bg-white/[0.07] text-slate-300 ring-1 ring-white/15" },
];

const tierOf = (a: AchievementView): Tier => (a.percent <= 5 ? TIERS[0] : a.percent <= 15 ? TIERS[1] : a.percent <= 40 ? TIERS[2] : TIERS[3]);
const pct = (a: AchievementView) => (a.percent === 0 ? (a.earned ? "<1%" : "0%") : `${a.percent}%`);
/** Самые редкие — первыми; среди одинаково редких — по порядку списка */
const byRarity = (list: AchievementView[]) => list.map((a, i) => ({ a, i })).sort((x, y) => x.a.percent - y.a.percent || x.i - y.i).map((x) => x.a);

/** Медаль: цветное кольцо по редкости, значок внутри. Не получена — тёмная, с замком и прогрессом по кругу. */
function Medal({ a, size, selected }: { a: AchievementView; size: "md" | "lg"; selected?: boolean }) {
  const got = !!a.earned;
  const t = tierOf(a);
  const box = size === "lg" ? "h-20 w-20 text-4xl sm:h-24 sm:w-24 sm:text-5xl" : "h-16 w-16 text-3xl";
  const progress = !got && a.need > 0 ? Math.min(1, a.have / a.need) : 0;
  return (
    <span className={`relative inline-flex shrink-0 rounded-full ${box} ${selected ? "ring-2 ring-white/70 ring-offset-2 ring-offset-[#0f1822]" : ""}`}>
      {got ? (
        <span className={`absolute inset-0 rounded-full bg-gradient-to-br p-[3px] ${t.ring} ${t.glow}`}>
          <span className="flex h-full w-full items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#24364a,#0b131c_70%)]">
            <span className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">{a.icon}</span>
          </span>
        </span>
      ) : (
        <>
          {/* прогресс по кругу */}
          <span
            className="absolute inset-0 rounded-full"
            style={{ background: `conic-gradient(rgba(252,211,77,0.55) ${progress * 360}deg, rgba(255,255,255,0.07) 0deg)` }}
          />
          <span className="absolute inset-[3px] flex items-center justify-center rounded-full bg-[#0b131c]">
            <span className="opacity-25 grayscale">{a.icon}</span>
          </span>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1a2633] text-[10px] ring-2 ring-[#0f1822]">🔒</span>
        </>
      )}
    </span>
  );
}

function Detail({ a }: { a: AchievementView }) {
  const got = !!a.earned;
  const t = tierOf(a);
  return (
    <div className="mt-4 flex items-center gap-4 rounded-2xl border border-white/[0.1] bg-gradient-to-r from-white/[0.06] to-transparent p-4">
      <Medal a={a} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-lg font-black ${got ? "text-white" : "text-slate-300"}`}>{a.title}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] ${t.chip}`}>{t.name}</span>
        </div>
        <div className="mt-0.5 text-sm text-slate-300">{a.text}</div>
        {!got && a.need > 1 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-200" style={{ width: `${Math.round((a.have / a.need) * 100)}%` }} />
            </div>
            <span className="shrink-0 text-xs font-bold tabular-nums text-amber-200">
              {a.have.toLocaleString("ru-RU")} / {a.need.toLocaleString("ru-RU")}
            </span>
          </div>
        )}
        <div className="mt-1 text-xs text-slate-500">
          {got && a.earned ? `Получено ${formatSiteDate(a.earned.at)} · ` : ""}
          {a.percent === 0 ? (got ? "есть меньше чем у 1% игроков" : "пока ни у кого нет") : `есть у ${a.percent}% игроков`}
        </div>
      </div>
    </div>
  );
}

/** showLocked — сразу показывать и ещё не полученные (личный кабинет) */
export function AchievementsPanel({ list, showLocked = false }: { list: AchievementView[]; showLocked?: boolean }) {
  const [all, setAll] = useState(showLocked);
  const [open, setOpen] = useState<string | null>(null);
  const earned = byRarity(list.filter((a) => a.earned));
  const locked = byRarity(list.filter((a) => !a.earned));
  const shown = all ? [...earned, ...locked] : earned;
  const best = earned[0];
  const selected = list.find((a) => a.id === open) ?? null;
  const share = list.length ? earned.length / list.length : 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-amber-300/20 bg-[#0f1822]/90 p-4 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)] sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-amber-300/[0.07] blur-3xl" />

      {/* шапка: сколько собрано и самое редкое */}
      <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="min-w-[9rem]">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-300">Достижения</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="bg-gradient-to-b from-amber-100 to-amber-400 bg-clip-text text-5xl font-black tabular-nums leading-none text-transparent">{earned.length}</span>
            <span className="text-lg font-bold text-slate-500">/ {list.length}</span>
          </div>
          <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-200" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        </div>

        {best && (
          <button type="button" onClick={() => setOpen(open === best.id ? null : best.id)} className="flex min-w-0 items-center gap-3 text-left">
            <Medal a={best} size="lg" selected={open === best.id} />
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Самое редкое</div>
              <div className="truncate text-xl font-black">{best.title}</div>
              <div className={`text-sm font-semibold ${tierOf(best).text}`}>
                {tierOf(best).name} · есть у {pct(best)} игроков
              </div>
            </div>
          </button>
        )}

        <button type="button" onClick={() => setAll(!all)} className="ml-auto self-start text-xs text-slate-400 hover:text-amber-200">
          {all ? "Только полученные" : "Показать все"}
        </button>
      </div>

      {/* медали */}
      {shown.length === 0 ? (
        <p className="relative mt-5 text-sm text-slate-400">Пока нет — первое достижение даётся за первый сыгранный турнир.</p>
      ) : (
        <div className="relative mt-6 grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-5 lg:grid-cols-7">
          {shown.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(open === a.id ? null : a.id)}
              aria-expanded={open === a.id}
              className="group flex flex-col items-center text-center"
            >
              <span className="transition group-hover:-translate-y-0.5">
                <Medal a={a} size="md" selected={open === a.id} />
              </span>
              <span className={`mt-2 line-clamp-2 text-xs font-bold leading-tight ${a.earned ? "text-slate-100" : "text-slate-500"}`}>{a.title}</span>
              <span className={`mt-0.5 text-[11px] font-semibold tabular-nums ${a.earned ? tierOf(a).text : "text-slate-600"}`}>{pct(a)}</span>
            </button>
          ))}
        </div>
      )}

      {selected && <Detail a={selected} />}
      {!selected && shown.length > 0 && <p className="relative mt-4 text-center text-[11px] text-slate-500">Нажмите на медаль — покажем, как её получить. Процент — у скольких игроков клуба она есть.</p>}
    </section>
  );
}
