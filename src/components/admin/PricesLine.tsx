"use client";

import { useState } from "react";
import { formatRub, hasPrices } from "@/lib/cash";
import type { Prices } from "@/lib/types";
import { Button, Field, inputClass } from "./ui";

const FIELDS: { key: keyof Prices; label: string; short: string }[] = [
  { key: "entry", label: "Вход, ₽", short: "вход" },
  { key: "reentry", label: "Re-entry, ₽", short: "re-entry" },
  { key: "addon", label: "Аддон, ₽", short: "аддон" },
  { key: "doubleAddon", label: "Двойной аддон, ₽", short: "двойной" },
];

/**
 * Цены этого турнира (касса, docs/CASH.md). Берутся из пресета, здесь их можно поправить —
 * новые цены действуют на следующие входы и аддоны, уже начисленное не меняется.
 */
export function PricesLine({ prices, onSave }: { prices: Prices; onSave: (prices: Prices) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => Object.fromEntries(FIELDS.map((f) => [f.key, String(prices[f.key] || "")])));
  const off = !hasPrices(prices);

  if (editing) {
    return (
      <div className="mb-4 space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="0"
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.replace(/\D/g, "") })}
              />
            </Field>
          ))}
        </div>
        <div className="text-xs text-slate-500">Новые цены — для следующих входов и аддонов. Уже начисленное не меняется.</div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setEditing(false)}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key]) || 0])) as Prices);
              setEditing(false);
            }}
          >
            Сохранить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        off ? "border border-amber-300/30 bg-amber-300/[0.07] text-amber-200" : "bg-white/[0.03] text-slate-400"
      }`}
    >
      <div className="min-w-0 flex-1">
        {off ? (
          <>Цены не заданы — касса ничего не будет начислять.</>
        ) : (
          <>
            Цены:{" "}
            {FIELDS.map((f) => `${f.short} ${formatRub(prices[f.key])}`).join(" · ")}
          </>
        )}
      </div>
      <Button variant={off ? "primary" : "ghost"} onClick={() => setEditing(true)}>
        {off ? "Задать" : "Изменить"}
      </Button>
    </div>
  );
}
