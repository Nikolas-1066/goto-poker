// Расходы турнира (docs/CASH.md, «Расходы»): дилеры, админ, прочее — кому сколько заплатили
// и сколько часов отработали. Чистые функции; база — src/lib/db/expenses.ts.

export type ExpenseKind = "dealer" | "admin" | "other";
export const EXPENSE_KINDS: ExpenseKind[] = ["dealer", "admin", "other"];
export const EXPENSE_LABEL: Record<ExpenseKind, string> = { dealer: "Дилер", admin: "Админ", other: "Прочее" };

export type Expense = {
  id: number;
  tournamentId: number;
  kind: ExpenseKind;
  /** Кому (имя дилера / админа) или на что («такси», «фишки») */
  name: string;
  /** Отработано часов; null — не указано */
  hours: number | null;
  amount: number;
  note: string;
  at: number;
};

export type ExpenseTotals = { total: number; byKind: Record<ExpenseKind, number>; hours: number; dealers: number };

export function expenseTotals(list: Expense[]): ExpenseTotals {
  const t: ExpenseTotals = { total: 0, byKind: { dealer: 0, admin: 0, other: 0 }, hours: 0, dealers: 0 };
  const dealers = new Set<string>();
  for (const e of list) {
    t.total += e.amount;
    t.byKind[e.kind] += e.amount;
    if (e.kind === "dealer") {
      t.hours += e.hours ?? 0;
      dealers.add(e.name.trim().toLowerCase());
    }
  }
  t.dealers = dealers.size;
  t.hours = Math.round(t.hours * 100) / 100;
  return t;
}

/** Проверить и привести расход к виду для записи. Бросает Error с понятным текстом */
export function sanitizeExpense(input: unknown) {
  const x = (input ?? {}) as Record<string, unknown>;
  const kind = EXPENSE_KINDS.includes(x.kind as ExpenseKind) ? (x.kind as ExpenseKind) : null;
  if (!kind) throw new Error("Выберите, за что расход: дилер, админ или прочее");
  const name = String(x.name ?? "").trim().slice(0, 60);
  if (!name) throw new Error(kind === "other" ? "Напишите, на что расход" : "Напишите имя");
  const amount = Math.round(Number(String(x.amount ?? "").replace(/\s/g, "")) || 0);
  if (amount < 0 || amount > 10_000_000) throw new Error("Сумма — целое число рублей");
  const rawHours = String(x.hours ?? "").replace(",", ".").trim();
  const hours = rawHours === "" ? null : Math.round(Number(rawHours) * 100) / 100;
  if (hours != null && (!Number.isFinite(hours) || hours < 0 || hours > 24)) throw new Error("Часы — число от 0 до 24, например 4,5");
  if (amount === 0 && !hours) throw new Error("Укажите сумму или часы");
  const note = String(x.note ?? "").trim().slice(0, 120);
  return { kind, name, hours, amount, note };
}

/** «4,5 ч» */
export const formatHours = (h: number) => `${String(Math.round(h * 100) / 100).replace(".", ",")} ч`;
