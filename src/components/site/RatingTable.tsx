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
