"use client";

// Картинка всей таблицы рейтинга текущего периода — для публикации (ВК, общий чат).
// Без телефонов и денег: место, игрок, турниров, нокауты, очки; золотая черта — граница финалистов.

import { useState } from "react";
import type { StandingRow } from "@/lib/db/periods";
import { formatKo } from "@/lib/report";
import { draw, GOLD, loadLogo, MUTED, PAD, TEXT, W, type CardSpec } from "./cardImage";
import { Button } from "./ui";

function spec(title: string, rows: StandingRow[], zoneN: number, finalistIds: Set<number>, now: number): CardSpec {
  const updated = new Date(now).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  return {
    title,
    subtitle: `Обновлено ${updated} · игроков ${rows.length}`,
    columns: [
      { x: PAD, align: "left" },
      { x: PAD + 100, align: "left" },
      { x: W - PAD - 300, align: "right" },
      { x: W - PAD - 160, align: "right" },
      { x: W - PAD, align: "right" },
    ],
    head: ["#", "Игрок", "Турн.", "KO", "Очки"],
    rows: rows.map((r) => {
      const fin = finalistIds.has(r.playerId);
      return [
        { text: String(r.rank), color: fin ? GOLD : TEXT, bold: true },
        { text: r.name, bold: r.rank === 1 },
        { text: String(r.tournaments), color: MUTED },
        { text: r.ko ? formatKo(r.ko) : "—", color: r.ko ? TEXT : MUTED },
        { text: String(r.points), color: fin ? GOLD : TEXT, bold: true },
      ];
    }),
    zoneLineBefore: zoneN > 0 && zoneN < rows.length ? zoneN : undefined,
    footer: zoneN > 0 ? `Золотым — в зоне финала (топ-${zoneN})` : "ГОТО ПОКЕР · спортивный покер",
  };
}

/** Кнопка «Картинка рейтинга» и окно с картинкой: «Скачать» / нажать и подержать на телефоне */
export function RatingImageButton({
  title,
  fileName,
  rows,
  zoneN = 0,
  finalistIds = new Set(),
}: {
  title: string;
  fileName: string;
  rows: StandingRow[];
  zoneN?: number;
  finalistIds?: Set<number>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    const logoImg = await loadLogo();
    setUrl(draw(spec(title, rows, zoneN, finalistIds, Date.now()), logoImg));
    setBusy(false);
  }

  return (
    <>
      <Button disabled={busy || rows.length === 0} onClick={make} title="Картинка всей таблицы для публикации">
        🖼 Картинка рейтинга
      </Button>
      {url && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#080e15] p-3 sm:p-6">
          <div className="mx-auto max-w-xl space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h2>
              <Button onClick={() => setUrl(null)}>✕ Закрыть</Button>
            </div>
            <div className="text-xs text-slate-500">
              На телефоне: нажмите и подержите картинку → «Сохранить» или «Поделиться». На компьютере — «Скачать».
            </div>
            <a href={url} download={fileName} className="inline-block rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-[#080e15]">
              ⬇ Скачать картинку
            </a>
            {/* eslint-disable-next-line @next/next/no-img-element -- картинка нарисована в браузере (data:URL) */}
            <img src={url} alt={title} className="w-full rounded-lg border border-white/10" />
          </div>
        </div>
      )}
    </>
  );
}
