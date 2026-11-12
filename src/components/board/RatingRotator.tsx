"use client";

// Правый блок табло (docs/RATING.md, раздел 7): по очереди — топ месяца, топ за всё время,
// игроки текущего турнира, «сколько очков даст место сейчас». Время экрана — настройка;
// игроки турнира (нокауты) показываются чаще и дольше остальных.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardRating, BoardRow } from "@/lib/db/board";

type Row = BoardRow & { out?: boolean };
type Screen = {
  key: string;
  /** Группа экранов: страницы одного списка идут подряд */
  group: "players" | "month" | "all" | "preview";
  label: string;
  title: string;
  badge?: string;
  rows: Row[];
  /** Номер места первой строки (для рейтингов на второй странице — 11, 12…) */
  start: number;
  ranked: boolean;
  hint: string;
};

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

/**
 * Размер блока не зависит от длины списка: он занимает своё место на экране, а сколько строк
 * в него влезает — измеряем. Длинный список делится на страницы (1/3, 2/3…).
 */
function usePerPage() {
  const [perPage, setPerPage] = useState(10);
  // callback-ref: срабатывает при каждом новом экране (блок пересоздаётся), следит за размером блока
  const listRef = useCallback((list: HTMLDivElement | null) => {
    if (!list) return;
    const measure = () => {
      const row = list.firstElementChild as HTMLElement | null;
      if (!row) return;
      const gap = 4;
      const fit = Math.max(3, Math.floor((list.clientHeight + gap) / (row.offsetHeight + gap)));
      setPerPage((old) => (old === fit ? old : fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, []);
  return { listRef, perPage };
}

/** Разбить список на страницы по perPage строк */
function paged(base: Omit<Screen, "key" | "rows" | "start">, rows: Row[], perPage: number): Screen[] {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  return Array.from({ length: pages }, (_, i) => ({
    ...base,
    key: `${base.group}-${i}`,
    badge: pages > 1 ? [base.badge, `${i + 1}/${pages}`].filter(Boolean).join(" · ") : base.badge,
    rows: rows.slice(i * perPage, (i + 1) * perPage),
    start: i * perPage + 1,
  }));
}

export function RatingRotator({ updatedAt }: { updatedAt: number | undefined }) {
  const data = useBoardRating(updatedAt);
  const [step, setStep] = useState(0);
  const { listRef, perPage } = usePerPage();

  const screens = useMemo<Screen[]>(() => {
    if (!data) return [];
    const list: Screen[] = [];
    if (data.month)
      list.push(...paged({ group: "month", label: "♛ РЕЙТИНГ МЕСЯЦА", title: data.month.title, badge: `ТОП ${data.month.rows.length}`, ranked: true, hint: "Очки за турниры месяца" }, data.month.rows, perPage));
    if (data.all)
      list.push(...paged({ group: "all", label: "♛ ЛИДЕРЫ КЛУБА", title: "За всё время", badge: `ТОП ${data.all.rows.length}`, ranked: true, hint: "Сумма очков за все турниры" }, data.all.rows, perPage));
    if (data.players)
      list.push(
        ...paged(
          {
            group: "players",
            label: data.players.finished ? "♠ ИТОГИ ТУРНИРА" : "♠ ИГРОКИ ТУРНИРА",
            title: data.players.finished ? `Игроков ${data.players.total}` : `В игре ${data.players.playing} из ${data.players.total}`,
            ranked: false,
            hint: "KO — нокауты в этом турнире",
          },
          data.players.rows,
          perPage,
        ),
      );
    if (data.preview)
      list.push(
        ...paged(
          {
            group: "preview",
            label: "★ ОЧКИ ЗА МЕСТО",
            title: `Кол-во игроков: ${data.preview.field}`,
            badge: data.preview.final ? "ФИНАЛ" : undefined,
            ranked: false,
            hint: "Без нокаутов и re-entry · растёт с каждым новым игроком",
          },
          data.preview.rows,
          perPage,
        ),
      );
    return list;
  }, [data, perPage]);

  // Расписание (docs/RATING.md, раздел 7): нокауты турнира — после каждого рейтинга, но по ОДНОЙ странице
  // за раз (страницы игроков чередуются), иначе при большом поле рейтинги почти не видны:
  // игроки (стр. 1) → месяц → игроки (стр. 2) → очки за место → игроки (стр. 3) → за всё время → …
  // Страница игроков — полное время (seconds), страница рейтинга — 80%.
  const seconds = data?.seconds ?? 25;
  const schedule = useMemo(() => {
    const full = seconds * 1000;
    const short = Math.round(full * 0.8);
    const players = screens.map((s, i) => (s.group === "players" ? i : -1)).filter((i) => i >= 0);
    const groups: number[][] = [];
    screens.forEach((s, i) => {
      if (s.group === "players") return;
      const last = groups[groups.length - 1];
      if (last && screens[last[0]].group === s.group) last.push(i);
      else groups.push([i]);
    });
    if (!players.length) return groups.flat().map((i) => ({ i, ms: full }));
    if (!groups.length) return players.map((i) => ({ i, ms: full }));
    // столько «слотов», чтобы каждая страница игроков и каждый рейтинг показались хотя бы раз
    const slots = groups.length * Math.max(1, Math.ceil(players.length / groups.length));
    const out: { i: number; ms: number }[] = [];
    for (let k = 0; k < slots; k++) {
      out.push({ i: players[k % players.length], ms: full });
      for (const i of groups[k % groups.length]) out.push({ i, ms: short });
    }
    return out;
  }, [screens, seconds]);

  // Таймер зависит только от шага и длительности (числа), а не от объекта расписания:
  // данные табло обновляются каждые 15 с, и пересоздание расписания не должно сбрасывать таймер
  // (иначе экран «залипал» на нокаутах и рейтинги не показывались).
  const current = schedule.length ? schedule[step % schedule.length] : null;
  const currentMs = current?.ms ?? 0;
  useEffect(() => {
    if (!currentMs) return;
    const t = setTimeout(() => setStep((x) => x + 1), currentMs);
    return () => clearTimeout(t);
  }, [step, currentMs]);
  const screen = current ? screens[current.i] ?? null : null;

  if (!screen) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="tv-sm font-bold tracking-[0.25em] text-amber-300">♛ РЕЙТИНГ КЛУБА</div>
        <div className="tv-md mt-6 flex flex-1 items-center text-slate-500">Рейтинг появится после первого турнира по игрокам</div>
      </div>
    );
  }

  return (
    <div key={screen.key} className="flex min-h-0 flex-1 animate-[fadein_0.6s_ease] flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="tv-sm font-bold tracking-[0.25em] text-amber-300">{screen.label}</div>
          <h2 className="tv-lg mt-2 truncate font-bold">{screen.title}</h2>
        </div>
        {screen.badge && <div className="tv-xs shrink-0 rounded-full border border-white/10 px-3 py-1 text-slate-400">{screen.badge}</div>}
      </div>

      <div ref={listRef} className="mt-3 flex min-h-0 flex-1 flex-col justify-around gap-1 overflow-hidden">
        {screen.rows.map((row, index) => {
          const place = screen.start + index;
          return (
            <div key={`${row.name}-${index}`} className={`flex shrink-0 items-center gap-3 ${row.out ? "opacity-50" : ""}`}>
              {screen.ranked && (
                <div
                  className={`tv-md flex h-[1.7em] w-[1.7em] shrink-0 items-center justify-center rounded-lg font-bold ${
                    place === 1 ? "bg-amber-300/15 text-amber-300" : "bg-white/[0.04] text-slate-400"
                  }`}
                >
                  {place}
                </div>
              )}
              <div className="min-w-0 flex-1 truncate text-[clamp(0.85rem,1.35vw,2rem)] font-medium leading-tight text-slate-100">{row.name}</div>
              <div className="shrink-0 text-[clamp(0.85rem,1.35vw,2rem)] font-bold leading-tight tabular-nums text-amber-200/90">{row.value}</div>
            </div>
          );
        })}
      </div>

      <div className="tv-xs mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-white/[0.07] pt-2 tracking-wide text-slate-500">
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
