// Касса турнира — чистые функции (docs/CASH.md).

import type { Prices } from "./types";

/** «1 500 ₽» */
export function formatRub(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
}

export const hasPrices = (p: Prices | undefined) => !!p && (p.entry > 0 || p.reentry > 0 || p.addon > 0 || p.doubleAddon > 0);
