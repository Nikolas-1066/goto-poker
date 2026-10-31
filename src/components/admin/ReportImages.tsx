"use client";

// Картинки для отчёта (без кассы — можно показать игрокам): итоги турнира, топ-10 рейтинга,
// участники турнира в рейтинге. Рисуются в браузере на canvas в стиле табло клуба.

import { useEffect, useState } from "react";
import logo from "@/assets/logo.png";
import { formatKo, formatShift, type TournamentReport } from "@/lib/report";

const W = 1080;
const PAD = 64;
const ROW = 64;
const BG = "#080e15";
const PANEL = "#101923";
const GOLD = "#fcd34d";
const TEXT = "#e2e8f0";
const MUTED = "#64748b";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

type Cell = { text: string; color?: string; bold?: boolean };
/** Колонка: правый край (x) или левый, если align = left */
type Column = { x: number; align: CanvasTextAlign };

type CardSpec = {
  title: string;
  subtitle: string;
  columns: Column[];
  head: string[];
  rows: Cell[][];
  footer?: string;
};

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = logo.src;
  });
}

function draw(spec: CardSpec, logoImg: HTMLImageElement | null) {
  const top = 250;
  const H = top + 60 + spec.rows.length * ROW + 140;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // шапка: логотип, ГОТО ПОКЕР, заголовок
  if (logoImg) {
    const h = 96;
    ctx.drawImage(logoImg, PAD, 48, (logoImg.width / logoImg.height) * h, h);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.fillStyle = TEXT;
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText("ГОТО", W - PAD - 150, 108);
  ctx.fillStyle = GOLD;
  ctx.fillText("ПОКЕР", W - PAD, 108);

  ctx.textAlign = "left";
  ctx.fillStyle = GOLD;
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText(spec.title, PAD, 200);
  ctx.fillStyle = MUTED;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(spec.subtitle, PAD, 240);

  // панель таблицы
  const panelTop = top + 20;
  const panelH = 60 + spec.rows.length * ROW + 20;
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(PAD - 24, panelTop, W - 2 * (PAD - 24), panelH, 24);
  ctx.fill();

  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = MUTED;
  spec.head.forEach((h, i) => {
    ctx.textAlign = spec.columns[i].align;
    ctx.fillText(h.toUpperCase(), spec.columns[i].x, panelTop + 48);
  });

  spec.rows.forEach((row, r) => {
    const y = panelTop + 60 + r * ROW + 42;
    if (r > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(PAD, y - 46, W - 2 * PAD, 2);
    }
    row.forEach((cell, i) => {
      ctx.textAlign = spec.columns[i].align;
      ctx.fillStyle = cell.color ?? TEXT;
      ctx.font = `${cell.bold ? 800 : 500} 32px ${FONT}`;
      ctx.fillText(fit(ctx, cell.text, i === 1 ? 520 : 260), spec.columns[i].x, y);
    });
  });

  if (spec.footer) {
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(spec.footer, W / 2, H - 48);
  }
  return canvas.toDataURL("image/png");
}

/** Обрезать длинное имя с «…» */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

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
