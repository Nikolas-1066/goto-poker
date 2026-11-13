"use client";

// Прошедшие турниры карточками, как расписание: по каждому — топ-3 и сколько было игроков; по нажатию — все места (решение владельца).
// На странице «Расписание» — последние 10 и кнопка «Показать ещё».

import { useState } from "react";
import { formatSiteDate, playersWord, type SiteResult, type SiteResultFull } from "@/lib/site";
import { formatKo, Muted, OUTLINE, PlayerLink, useSite } from "./SiteShell";

const PLACE_STYLE = ["bg-amber-300 text-[#080e15]", "bg-slate-300 text-[#080e15]", "bg-orange-400/90 text-[#080e15]"];
const PLACE_REST = "bg-white/[0.07] text-slate-300";

type Row = SiteResult["top"][number];

function Rows({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-2 space-y-1.5">
      {rows.map((r, i) => (
        <div key={r.playerId} className="flex items-center gap-2 text-sm">
          <span className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-xs font-black tabular-nums ${PLACE_STYLE[i] ?? PLACE_REST}`}>
            {r.place}
          </span>
          <PlayerLink id={r.playerId} name={r.name} className="min-w-0 flex-1 truncate font-semibold" />
          {r.ko > 0 && <span className="shrink-0 text-xs text-slate-500">KO {formatKo(r.ko)}</span>}
          <span className="w-14 shrink-0 text-right font-bold tabular-nums text-amber-200">{r.points ? `+${r.points}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function FullTable({ id, top }: { id: number; top: Row[] }) {
  const { data, error, loading } = useSite<SiteResultFull>(`result&id=${id}`);
  if (loading) return <Rows rows={top} />;
  if (!data) return <Muted>{error || "Не удалось загрузить"}</Muted>;
  return <Rows rows={data.rows} />;
}

/** wide — карточки в 2–3 колонки, как расписание; иначе одной колонкой (главная) */
export function ResultsList({ limit, step = 0, wide = false }: { limit: number; step?: number; wide?: boolean }) {
  const [shown, setShown] = useState(limit);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading } = useSite<{ results: SiteResult[]; total: number }>(`results&limit=${shown}`, 0, true);
  if (!data) return <Muted>{loading ? "Загрузка…" : error || "Итоги скоро появятся"}</Muted>;
  const list = data.results;
  if (!list.length) return <Muted>Сыгранных турниров пока нет.</Muted>;
  return (
    <>
      <div className={`grid items-start gap-4 ${wide ? "sm:grid-cols-2 lg:grid-cols-3" : ""}`}>
        {list.map((t) => {
          const expanded = open === t.id;
          const canExpand = t.players > t.top.length;
          return (
            <article
              key={t.id}
              className="flex flex-col rounded-2xl border border-white/[0.08] bg-[#0f1822]/90 p-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)] transition hover:border-amber-300/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-slate-400">{formatSiteDate(t.at)}</div>
                <span className="shrink-0 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300">{playersWord(t.players)}</span>
              </div>
              <h3 className="mt-2 text-xl font-bold leading-tight">{t.name}</h3>
              {t.kindLabel && <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-amber-300">{t.kindLabel}</div>}
              <div className="mt-3 border-t border-white/[0.07] pt-2">{expanded ? <FullTable id={t.id} top={t.top} /> : <Rows rows={t.top} />}</div>
              {canExpand && (
                <button type="button" onClick={() => setOpen(expanded ? null : t.id)} className="mt-3 self-start text-sm text-slate-400 hover:text-amber-200">
                  {expanded ? "Свернуть ↑" : "Все места ↓"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {step > 0 && data.total > list.length && (
        <div className="mt-5 text-center">
          <button type="button" disabled={loading} onClick={() => setShown(list.length + step)} className={`rounded-xl px-5 py-2.5 text-sm ${OUTLINE}`}>
            {loading ? "Загрузка…" : "Показать ещё"}
          </button>
        </div>
      )}
    </>
  );
}
