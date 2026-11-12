"use client";

// Лидеры по фишкам на табло (docs/SEATING.md): только посчитанные стеки. Лидер крупно, под ним ещё двое.
// В перерыв — на экране перерыва, во время игры — отдельным экраном в правом блоке.

import type { BoardRating } from "@/lib/db/board";
import { formatChips } from "@/lib/clock";

type Leaders = NonNullable<BoardRating["chipLeaders"]>;

const time = (ts: number) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Когда посчитали (самый свежий подсчёт среди лидеров) */
export const countedLabel = (leaders: Leaders) => `Посчитано в ${time(Math.max(...leaders.map((l) => l.countedAt)))}`;

const bbText = (stack: number, bb?: number) => (bb && bb > 0 ? `${Math.round(stack / bb)} ББ` : "");

export function ChipLeaders({ leaders, bb, size = "panel" }: { leaders: Leaders; bb?: number; size?: "panel" | "break" }) {
  const [first, ...rest] = leaders;
  const latest = Math.max(...leaders.map((l) => l.countedAt));
  const big = size === "break";
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-[clamp(0.6rem,1.6vh,1.6rem)]">
      <div className="rounded-2xl border border-amber-300/30 bg-gradient-to-br from-amber-300/[0.12] to-transparent px-[clamp(0.9rem,1.6vw,2rem)] py-[clamp(0.7rem,1.6vh,1.8rem)]">
        <div className="tv-xs font-bold tracking-[0.3em] text-amber-300/80">♦ ЧИПЛИДЕР</div>
        <div
          className={`mt-1 truncate font-black leading-tight text-white ${
            big ? "text-[clamp(2rem,4.2vw,6rem)]" : "text-[clamp(1.4rem,2.6vw,3.8rem)]"
          }`}
        >
          {first.name}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span
            className={`font-black tabular-nums text-amber-300 ${big ? "text-[clamp(1.8rem,3.4vw,5rem)]" : "text-[clamp(1.2rem,2.1vw,3rem)]"}`}
          >
            {formatChips(first.stack)}
          </span>
          {bbText(first.stack, bb) && <span className="tv-md font-semibold text-slate-400">{bbText(first.stack, bb)}</span>}
        </div>
      </div>

      {rest.map((l, i) => (
        <div key={l.name} className="flex items-center gap-3 px-1">
          <div className="tv-md flex h-[1.7em] w-[1.7em] shrink-0 items-center justify-center rounded-lg bg-white/[0.05] font-bold text-slate-400">
            {i + 2}
          </div>
          <div className="min-w-0 flex-1 truncate text-[clamp(0.95rem,1.6vw,2.4rem)] font-semibold leading-tight text-slate-100">{l.name}</div>
          <div className="shrink-0 text-right">
            <div className="text-[clamp(0.95rem,1.6vw,2.4rem)] font-bold leading-tight tabular-nums text-amber-200/90">{formatChips(l.stack)}</div>
            {(bbText(l.stack, bb) || time(l.countedAt) !== time(latest)) && (
              <div className="tv-xs leading-tight text-slate-500">
                {/* время — только если этот стек посчитали в другую минуту, чем остальных */}
                {[bbText(l.stack, bb), time(l.countedAt) !== time(latest) ? `в ${time(l.countedAt)}` : ""].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
