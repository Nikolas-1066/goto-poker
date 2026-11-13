"use client";

// Прошедшие турниры карточками, как расписание: по каждому — пьедестал топ-3 и сколько было игроков; нажатие на карточку раскрывает все места (решение владельца).
// На странице «Расписание» — последние 10 и кнопка «Показать ещё».

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { formatSiteDate, playersWord, type SiteResult, type SiteResultFull } from "@/lib/site";
import { formatKo, Muted, OUTLINE, PlayerLink, useSite } from "./SiteShell";

const PLACE_STYLE = ["bg-amber-300 text-[#080e15]", "bg-slate-300 text-[#080e15]", "bg-orange-400/90 text-[#080e15]"];
const PLACE_REST = "bg-white/[0.07] text-slate-300";

type Row = SiteResult["top"][number];

function Rows({ rows, from = 0 }: { rows: Row[]; from?: number }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3 space-y-1.5 border-t border-white/[0.07] pt-3">
      {rows.map((r, i) => (
        <div key={r.playerId} className="flex items-center gap-2 text-sm">
          <span className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-xs font-black tabular-nums ${PLACE_STYLE[i + from] ?? PLACE_REST}`}>
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

/** Остальные места (с 4-го) — подгружаются, когда карточку раскрыли */
function RestRows({ id }: { id: number }) {
  const { data, error, loading } = useSite<SiteResultFull>(`result&id=${id}`);
  if (loading) return <div className="mt-3 text-center text-sm text-slate-500">Загрузка…</div>;
  if (!data) return <Muted>{error || "Не удалось загрузить"}</Muted>;
  return <Rows rows={data.rows.slice(3)} from={3} />;
}

const RING = ["border-amber-300 text-amber-200", "border-slate-300 text-slate-100", "border-orange-400 text-orange-200"];
const STAND = ["h-14 bg-gradient-to-b from-amber-300/30 to-amber-300/5", "h-10 bg-gradient-to-b from-slate-300/25 to-slate-300/5", "h-7 bg-gradient-to-b from-orange-400/25 to-orange-400/5"];

/** Пьедестал: второе место слева, первое по центру и выше, третье справа. Аватар — первая буква имени. */
function ResultPodium({ top }: { top: Row[] }) {
  const order = [1, 0, 2].filter((i) => top[i]);
  return (
    <div className="mt-4 grid grid-cols-3 items-end gap-2">
      {order.map((i) => {
        const r = top[i];
        return (
          <div key={r.playerId} className={`min-w-0 text-center ${top.length === 1 ? "col-start-2" : ""}`}>
            <div className="relative mx-auto w-fit">
              <div className={`flex items-center justify-center rounded-full border-2 bg-[#0b131c] font-black uppercase ${RING[i]} ${i === 0 ? "h-14 w-14 text-2xl" : "h-11 w-11 text-lg"}`}>
                {[...r.name.trim()][0] ?? "?"}
              </div>
              <span className={`absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-black tabular-nums ${PLACE_STYLE[i]}`}>{r.place}</span>
            </div>
            <PlayerLink id={r.playerId} name={r.name} className="mt-2 block truncate text-sm font-bold" />
            <div className="text-xs text-slate-400">{r.ko > 0 ? `KO ${formatKo(r.ko)}` : "без KO"}</div>
            <div className={`mt-1.5 flex items-start justify-center rounded-t-lg pt-1 text-sm font-black tabular-nums text-amber-200 ${STAND[i]}`}>{r.points ? `+${r.points}` : "—"}</div>
          </div>
        );
      })}
    </div>
  );
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
              {...(canExpand
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-expanded": expanded,
                    // нажатие на имя игрока ведёт на его страницу, а не раскрывает карточку
                    onClick: (e: MouseEvent) => !(e.target as HTMLElement).closest("a") && setOpen(expanded ? null : t.id),
                    onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && setOpen(expanded ? null : t.id),
                  }
                : {})}
              className={`flex flex-col rounded-2xl border bg-[#0f1822]/90 p-5 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)] transition hover:border-amber-300/40 ${
                expanded ? "border-amber-300/40" : "border-white/[0.08]"
              } ${canExpand ? "cursor-pointer" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-slate-400">{formatSiteDate(t.at)}</div>
                <span className="shrink-0 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300">{playersWord(t.players)}</span>
              </div>
              <h3 className="mt-2 text-xl font-bold leading-tight">{t.name}</h3>
              {t.kindLabel && <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-amber-300">{t.kindLabel}</div>}
              <ResultPodium top={t.top} />
              {expanded ? <RestRows id={t.id} /> : <Rows rows={t.top.slice(3)} from={3} />}
              {canExpand && <div className="mt-3 text-center text-xs text-slate-500">{expanded ? "Свернуть ↑" : "Все места ↓"}</div>}
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
