"use client";

// Картинки для отчёта (без кассы — можно показать игрокам): итоги турнира, топ-10 рейтинга,
// участники турнира в рейтинге. Рисуются в браузере на canvas в стиле табло клуба.

import { useEffect, useState } from "react";
import { formatKo, formatShift, type TournamentReport } from "@/lib/report";
import { draw, GOLD, loadLogo, MUTED, PAD, TEXT, W, type CardSpec } from "./cardImage";

const shiftColor = (shift: number | null) => (shift == null ? GOLD : shift > 0 ? "#6ee7b7" : shift < 0 ? "#fca5a5" : MUTED);

const dateOf = (ts: number | null) => (ts ? new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

function specs(r: TournamentReport): { name: string; spec: CardSpec }[] {
  const t = r.tournament;
  const when = dateOf(t.startedAt);
  const list: { name: string; spec: CardSpec }[] = [
    {
      name: "итоги",
      spec: {
        title: t.name,
        subtitle: [t.kindLabel, when, `игроков ${t.players}`, t.reentries ? `re-entry ${t.reentries}` : ""].filter(Boolean).join(" · "),
        columns: [
          { x: PAD, align: "left" },
          { x: PAD + 130, align: "left" },
          { x: W - PAD, align: "right" },
        ],
        head: ["Место", "Игрок", "Нокауты"],
        rows: r.places.map((p, i) => [
          { text: p.place == null ? "—" : p.placeTo ? `${p.place}–${p.placeTo}` : String(p.place), color: i < 3 ? GOLD : TEXT, bold: true },
          { text: p.name, bold: i === 0 },
          { text: p.ko ? formatKo(p.ko) : "—", color: p.ko ? TEXT : MUTED },
        ]),
        footer: "Итоги турнира",
      },
    },
  ];
  if (r.rating) {
    list.push({
      name: "рейтинг",
      spec: {
        title: `Рейтинг · ${r.rating.periodName}`,
        subtitle: `Топ-${r.rating.top.length} после турнира «${t.name}»${when ? `, ${when}` : ""}`,
        columns: [
          { x: PAD, align: "left" },
          { x: PAD + 110, align: "left" },
          { x: W - PAD - 170, align: "right" },
          { x: W - PAD, align: "right" },
        ],
        head: ["#", "Игрок", "Очки", ""],
        rows: r.rating.top.map((row) => [
          { text: String(row.rank), color: row.rank <= 3 ? GOLD : TEXT, bold: true },
          { text: row.name, bold: row.rank === 1 },
          { text: String(row.points), bold: true },
          { text: formatShift(row.shift), color: shiftColor(row.shift), bold: true },
        ]),
        footer: "↑↓ — на сколько мест поднялся или опустился за турнир",
      },
    });
    list.push({
      name: "участники",
      spec: {
        title: "Участники в рейтинге",
        subtitle: `${r.rating.periodName} · место до и после турнира «${t.name}»`,
        columns: [
          { x: PAD, align: "left" },
          { x: PAD, align: "left" },
          { x: W - PAD - 190, align: "right" },
          { x: W - PAD, align: "right" },
        ],
        head: ["", "Игрок", "Место", "Очки"],
        rows: r.rating.participants.map((p) => [
          { text: "" },
          { text: p.name },
          {
            text: `${p.before ?? "—"} → ${p.after}`,
            color: p.before == null ? GOLD : p.after < p.before ? "#6ee7b7" : p.after > p.before ? "#fca5a5" : TEXT,
            bold: true,
          },
          { text: `+${p.gained}`, color: GOLD, bold: true },
        ]),
        footer: "Место в рейтинге: было → стало",
      },
    });
  }
  return list;
}

export function ReportImages({ report, onSaved }: { report: TournamentReport; onSaved: () => void }) {
  const [images, setImages] = useState<{ name: string; url: string }[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadLogo().then((img) => {
      if (!alive) return;
      setImages(specs(report).map(({ name, spec }) => ({ name, url: draw(spec, img) })));
    });
    return () => {
      alive = false;
    };
  }, [report]);

  const file = (name: string) => `${report.tournament.name}-${name}.png`.replace(/[\\/:*?"<>|]+/g, "_");

  return (
    <div className="rounded-xl border border-white/[0.09] bg-[#101923] p-3">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">Картинки (без кассы)</div>
      <div className="mb-3 text-xs text-slate-500">
        На телефоне: нажмите и подержите картинку → «Сохранить» или «Поделиться». На компьютере — кнопка «Скачать».
        {!report.rating && " Картинок рейтинга нет: турнир не попал в рейтинг."}
      </div>
      {!images ? (
        <div className="py-6 text-center text-sm text-slate-500">Рисую…</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {images.map((im) => (
            <figure key={im.name} className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- картинка нарисована в браузере (data:URL) */}
              <img src={im.url} alt={im.name} className="w-full rounded-lg border border-white/10" />
              <a href={im.url} download={file(im.name)} onClick={onSaved} className="inline-block text-sm text-amber-300 hover:underline">
                ⬇ Скачать «{im.name}»
              </a>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
