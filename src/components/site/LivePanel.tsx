"use client";

// Турнир, который идёт прямо сейчас: то же, что видно на табло в клубе, — уровень и блайнды, сколько игроков
// в игре, нокауты, лидеры по фишкам, кто вылетел. Обновляется само раз в 20 секунд.

import { formatChips } from "@/lib/clock";
import type { SiteLive } from "@/lib/site";
import { Avatar } from "./Avatar";
import { formatKo, PlayerLink, useSite } from "./SiteShell";

export const useLive = () => useSite<{ live: SiteLive | null }>("live", 20_000).data?.live ?? null;

const Head = ({ children }: { children: string }) => <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">{children}</h3>;

export function LivePanel({ live }: { live: SiteLive }) {
  const tiles = [
    { label: "В игре", value: `${live.playing} из ${live.total}` },
    { label: live.onBreak ? "Перерыв, дальше уровень" : "Уровень", value: String(live.level || "—") },
    live.blinds && { label: "Блайнды", value: `${formatChips(live.blinds.sb)} / ${formatChips(live.blinds.bb)}${live.blinds.ante ? ` (${formatChips(live.blinds.ante)})` : ""}` },
    live.avgStack != null && { label: "Средний стек", value: formatChips(live.avgStack) },
  ].filter((x): x is { label: string; value: string } => !!x);
  return (
    <section className="rounded-2xl border border-emerald-400/30 bg-gradient-to-b from-emerald-400/[0.08] to-[#0f1822]/90 p-4 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-black tracking-tight sm:text-2xl">
          {live.name}
          {live.kindLabel && <span className="ml-2 rounded-md bg-amber-300/15 px-1.5 py-0.5 align-middle text-xs font-bold text-amber-300">{live.kindLabel}</span>}
        </h2>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300">
          {live.paused ? "Пауза" : live.onBreak ? "Перерыв" : "Идёт сейчас"}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-white/[0.08] bg-[#0b131c]/80 px-3 py-3 text-center">
            <dd className="text-xl font-black tabular-nums text-amber-100 sm:text-2xl">{t.value}</dd>
            <dt className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-slate-500">{t.label}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <div>
          <Head>В игре · нокауты</Head>
          <div className="space-y-1.5 text-sm">
            {live.players.map((p) => (
              <div key={p.playerId} className="flex items-center gap-2">
                <Avatar id={p.playerId} name={p.name} className="h-6 w-6 border border-white/10 text-[11px] text-slate-300" />
                <PlayerLink id={p.playerId} name={p.name} className="min-w-0 flex-1 truncate font-semibold" />
                <span className={`shrink-0 tabular-nums ${p.ko > 0 ? "font-bold text-amber-200" : "text-slate-600"}`}>{p.ko > 0 ? `KO ${formatKo(p.ko)}` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Head>Лидеры по фишкам</Head>
          {live.chipLeaders.length === 0 ? (
            <p className="text-sm text-slate-500">Появятся, когда в клубе посчитают стеки.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              {live.chipLeaders.map((p, i) => (
                <div key={p.playerId} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 font-bold tabular-nums text-slate-500">{i + 1}</span>
                  <PlayerLink id={p.playerId} name={p.name} className="min-w-0 flex-1 truncate font-semibold" />
                  <span className="shrink-0 font-bold tabular-nums text-amber-200">{formatChips(p.stack)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <Head>Вылетели</Head>
          {live.out.length === 0 ? (
            <p className="text-sm text-slate-500">Пока все в игре.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              {live.out.map((p) => (
                <div key={p.playerId} className="flex items-center gap-2 text-slate-400">
                  <span className="w-9 shrink-0 font-bold tabular-nums text-slate-500">{p.place}</span>
                  <PlayerLink id={p.playerId} name={p.name} className="min-w-0 flex-1 truncate" />
                  {p.ko > 0 && <span className="shrink-0 text-xs tabular-nums">KO {formatKo(p.ko)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
