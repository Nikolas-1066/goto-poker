"use client";

// Расходы турнира в «Истории»: дилеры (имя, часы, сколько заплатили), админ, прочее.

import { useState } from "react";
import { formatRub } from "@/lib/cash";
import { EXPENSE_KINDS, EXPENSE_LABEL, expenseTotals, formatHours, type Expense, type ExpenseKind } from "@/lib/expenses";
import { Button, inputClass } from "./ui";

export function ExpensesBlock({
  expenses,
  names,
  paid,
  busy,
  onAdd,
  onDelete,
}: {
  expenses: Expense[];
  names: Record<ExpenseKind, string[]>;
  /** Собрано за турнир — чтобы показать «остаётся» */
  paid: number | null;
  busy: boolean;
  onAdd: (e: { kind: ExpenseKind; name: string; hours: string; amount: string; note: string }) => Promise<boolean>;
  onDelete: (id: number) => void;
}) {
  const [kind, setKind] = useState<ExpenseKind>("dealer");
  const [name, setName] = useState("");
  const [hours, setHours] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const t = expenseTotals(expenses);

  async function add() {
    if (await onAdd({ kind, name, hours, amount, note })) {
      setName("");
      setHours("");
      setAmount("");
      setNote("");
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Расходы</div>

      {expenses.length > 0 ? (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-white/[0.06]">
            {expenses.map((e) => (
              <tr key={e.id}>
                <td className="w-16 py-2 text-xs text-slate-500">{EXPENSE_LABEL[e.kind]}</td>
                <td className="py-2">
                  <span className="font-semibold">{e.name}</span>
                  {e.note && <span className="text-xs text-slate-500"> · {e.note}</span>}
                </td>
                <td className="w-16 py-2 text-right tabular-nums text-slate-400">{e.hours != null ? formatHours(e.hours) : ""}</td>
                <td className="w-24 py-2 text-right font-semibold tabular-nums">{formatRub(e.amount)}</td>
                <td className="w-8 py-2 text-right">
                  <button
                    type="button"
                    className="text-slate-500 hover:text-red-300"
                    title="Удалить"
                    disabled={busy}
                    onClick={() => window.confirm(`Удалить расход: ${e.name}, ${formatRub(e.amount)}?`) && onDelete(e.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-sm text-slate-500">Расходов пока нет.</div>
      )}

      {expenses.length > 0 && (
        <div className="mt-2 space-y-1 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">
              Дилеры{t.dealers ? ` · ${t.dealers} чел.` : ""}
              {t.hours ? ` · ${formatHours(t.hours)}` : ""}
            </span>
            <span className="tabular-nums">{formatRub(t.byKind.dealer)}</span>
          </div>
          {t.byKind.admin > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">Админ</span>
              <span className="tabular-nums">{formatRub(t.byKind.admin)}</span>
            </div>
          )}
          {t.byKind.other > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400">Прочее</span>
              <span className="tabular-nums">{formatRub(t.byKind.other)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-white/[0.06] pt-1 font-semibold">
            <span>Всего расходов</span>
            <span className="tabular-nums">{formatRub(t.total)}</span>
          </div>
          {paid != null && (
            <div className="flex justify-between font-bold">
              <span>Собрано − расходы</span>
              <span className={`tabular-nums ${paid - t.total < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatRub(paid - t.total)}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-3">
        <div className="grid grid-cols-3 gap-2">
          {EXPENSE_KINDS.map((k) => (
            <Button key={k} variant={kind === k ? "primary" : "default"} onClick={() => setKind(k)}>
              {EXPENSE_LABEL[k]}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_7rem] gap-2">
          <input
            className={inputClass}
            placeholder={kind === "other" ? "На что (такси, фишки…)" : "Имя"}
            list={`expense-names-${kind}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={`${inputClass} text-center`}
            placeholder="часов"
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value.replace(/[^\d,.]/g, ""))}
          />
          <input
            className={`${inputClass} text-right`}
            placeholder="₽"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <datalist id={`expense-names-${kind}`}>
          {names[kind].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <input className={inputClass} placeholder="Комментарий (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="primary" className="w-full" disabled={busy || !name.trim() || (!amount && !hours)} onClick={add}>
          Добавить расход
        </Button>
      </div>
    </div>
  );
}
