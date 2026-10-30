"use client";

// Правый блок табло (docs/RATING.md, раздел 7): по очереди — топ месяца, топ за всё время,
// игроки текущего турнира, «сколько очков даст место сейчас». Время экрана — настройка.

import { useEffect, useMemo, useState } from "react";
import type { BoardRating, BoardRow } from "@/lib/db/board";

type Screen = { key: string; label: string; title: string; badge?: string; rows: (BoardRow & { out?: boolean })[]; hint: string };

/** Свежие данные рейтинга: раз в 15 секунд и сразу, когда турнир изменился */
function useBoardRating(updatedAt: number | undefined) {
  const [data, setData] = useState<BoardRating | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/board", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [updatedAt]);
  return data;
}

/** Сколько строк помещается на одну страницу экрана игроков турнира */
const PAGE = 10;

export function RatingRotator({ updatedAt }: { updatedAt: number | undefined }) {
  const data = useBoardRating(updatedAt);

  const screens = useMemo<Screen[]>(() => {
    if (!data) return [];
    const list: Screen[] = [];
    if (data.month) list.push({ key: "month", label: "♛ РЕЙТИНГ МЕСЯЦА", title: data.month.title, badge: `ТОП ${data.month.rows.length}`, rows: data.month.rows, hint: "Очки за турниры месяца" });
    if (data.all) list.push({ key: "all", label: "♛ ЛИДЕРЫ КЛУБА", title: "За всё время", badge: `ТОП ${data.all.rows.length}`, rows: data.all.rows, hint: "Сумма очков за все турниры" });
    if (data.players) {
      const pages = Math.max(1, Math.ceil(data.players.rows.length / PAGE));
      for (let i = 0; i < pages; i++) {
        list.push({
          key: `players-${i}`,
          label: data.players.finished ? "♠ ИТОГИ ТУРНИРА" : "♠ ИГРОКИ ТУРНИРА",
          title: data.players.finished ? `Игроков ${data.players.total}` : `В игре ${data.players.playing} из ${data.players.total}`,
          badge: pages > 1 ? `${i + 1}/${pages}` : undefined,
          rows: data.players.rows.slice(i * PAGE, (i + 1) * PAGE),
          hint: "KO — нокауты в этом турнире",
        });
      }
    }
    if (data.preview) {
      list.push({
        key: "preview",
        label: "★ ОЧКИ ЗА МЕСТО",
        title: `Если игроков ${data.preview.field}`,
        badge: data.preview.final ? "ФИНАЛ" : undefined,
        rows: data.preview.rows,
        hint: "Без нокаутов и re-entry · растёт с каждым новым игроком",
      });
    }
    return list;
  }, [data]);

  // экраны игроков турнира (несколько страниц) делят между собой время одного экрана
  const [tick, setTick] = useState(0);
  const seconds = data?.seconds ?? 25;
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), (seconds * 1000) / 2);
    return () => clearInterval(t);
  }, [seconds]);
  const schedule = useMemo(() => {
    // расписание в половинках времени экрана: обычный экран — целое время (2 половинки),
    // а если игроков турнира несколько страниц — каждая страница по половинке
    const pages = screens.filter((x) => x.key.startsWith("players-")).length;
    return screens.flatMap((s, i) => (s.key.startsWith("players-") && pages > 1 ? [i] : [i, i]));
  }, [screens]);
  const screen = screens.length ? screens[schedule[tick % schedule.length] ?? 0] : null;

  if (!screen) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="text-[10px] font-bold tracking-[0.25em] text-amber-300 xl:text-xs">♛ РЕЙТИНГ КЛУБА</div>
        <div className="mt-6 flex flex-1 items-center text-sm text-slate-500">Рейтинг появится после первого турнира по игрокам</div>
      </div>
    );
  }

  return (
    <div key={screen.key} className="flex flex-1 animate-[fadein_0.6s_ease] flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold tracking-[0.25em] text-amber-300 xl:text-xs">{screen.label}</div>
          <h2 className="mt-3 truncate text-lg font-bold xl:text-xl 2xl:text-2xl">{screen.title}</h2>
        </div>
        {screen.badge && <div className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[9px] text-slate-500">{screen.badge}</div>}
      </div>

      <div className="mt-4 flex flex-1 flex-col justify-around gap-1.5">
        {screen.rows.map((row, index) => {
          const ranked = screen.key === "month" || screen.key === "all";
          return (
            <div key={`${row.name}-${index}`} className={`flex items-center gap-3 ${row.out ? "opacity-50" : ""}`}>
              {ranked && (
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold 2xl:h-9 2xl:w-9 2xl:text-sm ${
                    index === 0 ? "bg-amber-300/15 text-amber-300" : "bg-white/[0.04] text-slate-400"
                  }`}
                >
                  {index + 1}
                </div>
              )}
              <div className="min-w-0 flex-1 truncate text-xs font-medium text-slate-200 xl:text-sm 2xl:text-lg">{row.name}</div>
              <div className="text-xs font-bold tabular-nums text-slate-400 xl:text-sm 2xl:text-lg">{row.value}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-[9px] tracking-wide text-slate-600">
        <span className="truncate">{screen.hint}</span>
        <span className="flex shrink-0 gap-1">
          {screens.map((s) => (
            <span key={s.key} className={`h-1.5 w-1.5 rounded-full ${s.key === screen.key ? "bg-amber-300" : "bg-white/15"}`} />
          ))}
        </span>
      </div>
    </div>
  );
}
