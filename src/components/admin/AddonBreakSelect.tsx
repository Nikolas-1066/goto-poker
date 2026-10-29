"use client";

import { breaksOf } from "@/lib/clock";
import type { Step } from "@/lib/types";
import { inputClass } from "./ui";

/** Выбор перерыва для аддона: «Перерыв 2 — после 8 ур.»; значение — уровень перед перерывом (0 — без аддона). */
export function AddonBreakSelect({ steps, value, onChange }: { steps: Step[]; value: number; onChange: (afterLevel: number) => void }) {
  const breaks = breaksOf(steps);
  const known = value === 0 || breaks.some((b) => b.afterLevel === value);
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={0}>Без аддона</option>
      {breaks.map((b) => (
        <option key={b.number} value={b.afterLevel}>
          Перерыв {b.number} — после {b.afterLevel} ур.{b.note ? ` (${b.note})` : ""}
        </option>
      ))}
      {!known && <option value={value}>После {value} ур. — такого перерыва нет</option>}
    </select>
  );
}
