// Простая рассадка (без автобалансировки): столов в клубе до 3, мест за столом до 10.
// Отдельный файл — чтобы админка в браузере могла взять эти числа, не подключая код базы.

export const MAX_TABLES = 3;
export const MAX_SEATS = 10;

/** «стол 2/5», «стол 2» или пусто */
export function formatSeat(tableNo: number | null, seatNo: number | null) {
  if (tableNo == null) return "";
  return seatNo != null ? `стол ${tableNo}/${seatNo}` : `стол ${tableNo}`;
}
