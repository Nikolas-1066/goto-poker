// Касса турнира — чистые функции (docs/CASH.md).
// Начисление = цена каждого не отменённого и не бесплатного входа / re-entry / аддона,
// запомненная в момент нажатия. Долг = начислено − оплачено (меньше нуля — переплата).

import type { Prices } from "./types";

export type PayMethod = "cash" | "card" | "transfer";
export const PAY_METHODS: PayMethod[] = ["cash", "card", "transfer"];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { cash: "Наличные", card: "Карта", transfer: "Перевод" };

export type ChargeType = "entry" | "reentry" | "addon" | "double_addon";
export const CHARGE_LABEL: Record<ChargeType, string> = {
  entry: "Вход",
  reentry: "Re-entry",
  addon: "Аддон",
  double_addon: "Двойной аддон",
};

/** Начисление: одно действие игрока с его ценой */
export type Charge = {
  eventId: number;
  playerId: number;
  type: ChargeType;
  price: number;
  free: boolean;
  cancelled: boolean;
  at: number;
};

export type Payment = {
  id: number;
  playerId: number;
  amount: number;
  method: PayMethod;
  at: number;
  cancelled: boolean;
};

export type ByMethod = Record<PayMethod, number>;

/** Касса одного игрока в турнире */
export type PlayerCash = {
  /** К оплате (без бесплатных и отменённых) */
  charged: number;
  /** Сколько было бы по цене за бесплатные действия */
  free: number;
  paid: number;
  byMethod: ByMethod;
  /** Долг; меньше нуля — переплата */
  debt: number;
  /** Действия с ценой — для отметки «бесплатно» */
  charges: Omit<Charge, "playerId" | "cancelled">[];
  /** Оплаты (не отменённые) — для отмены ошибочной */
  payments: Omit<Payment, "playerId" | "cancelled">[];
};

/** Итог кассы турнира */
export type CashSummary = {
  charged: number;
  free: number;
  paid: number;
  byMethod: ByMethod;
  /** Сумма долгов (только тех, кто недоплатил) */
  debt: number;
  debtors: number;
  /** Сумма переплат */
  overpaid: number;
};

export const priceOf = (prices: Prices | undefined, type: ChargeType) =>
  !prices ? 0 : type === "double_addon" ? prices.doubleAddon : prices[type];

const noMethods = (): ByMethod => ({ cash: 0, card: 0, transfer: 0 });

/** Касса по игрокам турнира */
export function cashByPlayer(charges: Charge[], payments: Payment[]) {
  const by = new Map<number, PlayerCash>();
  const get = (playerId: number) => {
    let c = by.get(playerId);
    if (!c) {
      c = { charged: 0, free: 0, paid: 0, byMethod: noMethods(), debt: 0, charges: [], payments: [] };
      by.set(playerId, c);
    }
    return c;
  };
  for (const ch of charges) {
    if (ch.cancelled) continue;
    const c = get(ch.playerId);
    if (ch.free) c.free += ch.price;
    else c.charged += ch.price;
    c.charges.push({ eventId: ch.eventId, type: ch.type, price: ch.price, free: ch.free, at: ch.at });
  }
  for (const p of payments) {
    if (p.cancelled) continue;
    const c = get(p.playerId);
    c.paid += p.amount;
    c.byMethod[p.method] += p.amount;
    c.payments.push({ id: p.id, amount: p.amount, method: p.method, at: p.at });
  }
  for (const c of by.values()) c.debt = c.charged - c.paid;
  return by;
}

/** Итог кассы турнира по кассе игроков */
export function cashSummary(players: Iterable<PlayerCash>): CashSummary {
  const s: CashSummary = { charged: 0, free: 0, paid: 0, byMethod: noMethods(), debt: 0, debtors: 0, overpaid: 0 };
  for (const c of players) {
    s.charged += c.charged;
    s.free += c.free;
    s.paid += c.paid;
    for (const m of PAY_METHODS) s.byMethod[m] += c.byMethod[m];
    if (c.debt > 0) {
      s.debt += c.debt;
      s.debtors += 1;
    } else s.overpaid -= c.debt;
  }
  return s;
}

/** Проверить оплату: целые рубли, не больше долга. Возвращает текст ошибки или null */
export function checkPayment(amount: number, method: string, debt: number) {
  if (!PAY_METHODS.includes(method as PayMethod)) return "Выберите способ оплаты";
  if (!Number.isInteger(amount) || amount <= 0) return "Сумма — целое число рублей больше нуля";
  if (debt <= 0) return "Долга нет — всё оплачено";
  if (amount > debt) return `Больше, чем долг: ${formatRub(debt)}`;
  return null;
}

/** «1 500 ₽» */
export function formatRub(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ")} ₽`;
}

export const hasPrices = (p: Prices | undefined) => !!p && (p.entry > 0 || p.reentry > 0 || p.addon > 0 || p.doubleAddon > 0);
