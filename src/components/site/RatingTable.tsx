"use client";

// Таблица рейтинга на сайте: место, игрок, очки, турниры, победы, нокауты. Золотая черта — зона финала.

import type { SiteStanding } from "@/lib/site";
import { formatKo, Muted, PlayerLink } from "./SiteShell";

const medal = (rank: number) => (rank === 1 ? "text-amber-300" : rank === 2 ? "text-slate-200" : rank === 3 ? "text-orange-300" : "text-slate-500");

export function RatingTable({ rows, zone, limit, empty }: { rows: SiteStanding[]; zone?: number; limit?: number; empty?: string }) {
  if (!rows.length) return <Muted>{empty ?? "Пока нет сыгранных турниров."}</Muted>;
  const list = limit ? rows.slice(0, limit) : rows;
  const showZone = zone != null && zone > 0 && zone < rows.length && !limit;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[20rem] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.15em] text-slate-500">
            <th className="w-10 px-1 py-2 font-semibold">#</th>
            <th className="px-1 py-2 font-semibold">Игрок</th>
            <th className="px-1 py-2 text-right font-semibold">Очки</th>
            <th className="px-1 py-2 text-right font-semibold" title="Турниров сыграно">
              Турн.
            </th>
            <th className="hidden px-1 py-2 text-right font-semibold sm:table-cell">Побед</th>
            <th className="px-1 py-2 text-right font-semibold" title="Нокауты">
              KO
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.playerId} className={`border-t ${showZone && r.rank === zone + 1 ? "border-t-2 border-amber-300/70" : "border-white/[0.06]"}`}>
              <td className={`px-1 py-2.5 font-bold tabular-nums ${medal(r.rank)}`}>{r.rank}</td>
              <td className="max-w-0 truncate px-1 py-2.5 font-semibold">
                <PlayerLink id={r.playerId} name={r.name} />
              </td>
              <td className="px-1 py-2.5 text-right font-bold tabular-nums text-amber-200">{r.points.toLocaleString("ru-RU")}</td>
              <td className="px-1 py-2.5 text-right tabular-nums text-slate-400">{r.tournaments}</td>
              <td className="hidden px-1 py-2.5 text-right tabular-nums text-slate-400 sm:table-cell">{r.wins || "—"}</td>
              <td className="px-1 py-2.5 text-right tabular-nums text-slate-400">{r.ko ? formatKo(r.ko) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {showZone && (
        <div className="mt-2 flex items-center gap-2 px-1 text-xs text-slate-400">
          <span className="inline-block h-0.5 w-6 bg-amber-300/70" /> выше золотой черты — зона финала (топ-{zone})
        </div>
      )}
    </div>
  );
}

/** Пьедестал: первые трое крупно — победитель по центру и выше остальных */
export function Podium({ rows }: { rows: SiteStanding[] }) {
  if (rows.length < 3) return null;
  const style = [
    { order: "order-2", lift: "sm:-mt-6", ring: "border-amber-300/70 shadow-[0_0_50px_-18px_rgba(252,211,77,0.8)]", tone: "text-amber-300", badge: "from-amber-200 to-amber-400" },
    { order: "order-1", lift: "", ring: "border-slate-300/40", tone: "text-slate-200", badge: "from-slate-100 to-slate-400" },
    { order: "order-3", lift: "", ring: "border-orange-400/40", tone: "text-orange-300", badge: "from-orange-200 to-orange-500" },
  ];
  return (
    <div className="mb-5 grid grid-cols-3 items-end gap-2 pt-6 sm:gap-4">
      {rows.slice(0, 3).map((r, i) => {
        const s = style[i];
        return (
          <div key={r.playerId} className={`${s.order} ${s.lift} rounded-2xl border bg-[#0f1822]/90 px-2 py-4 text-center sm:px-4 sm:py-6 ${s.ring}`}>
            <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b text-sm font-black text-[#080e15] sm:h-11 sm:w-11 sm:text-base ${s.badge}`}>
              {r.rank}
            </div>
            <div
              className={`mx-auto mt-3 flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] font-black uppercase ${s.tone} ${
                i === 0 ? "h-14 w-14 text-2xl sm:h-20 sm:w-20 sm:text-4xl" : "h-12 w-12 text-xl sm:h-16 sm:w-16 sm:text-3xl"
              }`}
            >
              {r.name.trim().charAt(0)}
            </div>
            <div className="mt-2 truncate text-sm font-bold sm:text-lg">
              <PlayerLink id={r.playerId} name={r.name} />
            </div>
            <div className={`mt-2 border-t border-white/[0.07] pt-2 text-xl font-black tabular-nums sm:text-3xl ${s.tone}`}>{r.points.toLocaleString("ru-RU")}</div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 sm:text-xs">очков</div>
          </div>
        );
      })}
    </div>
  );
}
