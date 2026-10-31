// Отчёт владельцу после турнира — чистые функции: сдвиг мест в рейтинге и текст для мессенджера.
// Данные собирает src/lib/db/report.ts; картинки рисует src/components/admin/ReportImages.tsx.

import { formatRub, PAY_METHOD_LABEL, PAY_METHODS, type CashSummary } from "./cash";
import type { Standing } from "./rating/standings";

export type ReportPlace = { place: number | null; placeTo: number | null; name: string; ko: number };

/** Строка топа: место после турнира и сдвиг (плюс — поднялся; null — новый в таблице) */
export type TopRow = { rank: number; name: string; points: number; shift: number | null };

/** Участник турнира в рейтинге: место до и после (null — до турнира в таблице не было) */
export type ParticipantRow = { name: string; before: number | null; after: number; points: number; gained: number };

export type TournamentReport = {
  tournament: {
    id: number;
    name: string;
    kindLabel: string | null;
    startedAt: number | null;
    finishedAt: number | null;
    players: number;
    entries: number;
    reentries: number;
    addons: number;
    doubleAddons: number;
  };
  places: ReportPlace[];
  cash: { summary: CashSummary; debtors: { name: string; debt: number }[] } | null;
  /** Рейтинг периода, в который пошёл турнир; null — ни в какой рейтинг не попал */
  rating: { periodName: string; periodLabel: string; top: TopRow[]; participants: ParticipantRow[] } | null;
};

/**
 * Сдвиг мест: таблица до турнира и после. top — первые N после турнира;
 * participants — игроки этого турнира, по месту после турнира.
 */
export function ratingShift(before: Standing[], after: Standing[], participantIds: number[], n = 10) {
  const was = new Map(before.map((s) => [s.playerId, s]));
  const top: TopRow[] = after.slice(0, n).map((s) => {
    const b = was.get(s.playerId);
    return { rank: s.rank, name: s.name, points: s.points, shift: b ? b.rank - s.rank : null };
  });
  const ids = new Set(participantIds);
  const participants: ParticipantRow[] = after
    .filter((s) => ids.has(s.playerId))
    .map((s) => {
      const b = was.get(s.playerId);
      return { name: s.name, before: b?.rank ?? null, after: s.rank, points: s.points, gained: s.points - (b?.points ?? 0) };
    });
  return { top, participants };
}

export const formatKo = (ko: number) => String(ko).replace(".", ",");

/** «↑2», «↓1», «=», «new» */
export function formatShift(shift: number | null) {
  if (shift == null) return "new";
  return shift > 0 ? `↑${shift}` : shift < 0 ? `↓${-shift}` : "=";
}

const dateTime = (ts: number) =>
  new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const time = (ts: number) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Строка места: «7–8» при делёже */
const placeText = (p: ReportPlace) => (p.place == null ? "—" : p.placeTo ? `${p.place}–${p.placeTo}` : String(p.place));

/** Текст отчёта для Telegram / WhatsApp */
export function reportText(r: TournamentReport) {
  const t = r.tournament;
  const lines: string[] = [];
  const when = t.startedAt ? `${dateTime(t.startedAt)}${t.finishedAt ? `–${time(t.finishedAt)}` : ""}` : "";
  lines.push(`🏆 ${t.name}${t.kindLabel ? ` (${t.kindLabel})` : ""}${when ? ` · ${when}` : ""}`);
  const counts = [`игроков ${t.players}`, `входов ${t.entries}`];
  if (t.reentries) counts.push(`re-entry ${t.reentries}`);
  if (t.addons + t.doubleAddons) counts.push(`аддонов ${t.addons + t.doubleAddons}${t.doubleAddons ? ` (двойных ${t.doubleAddons})` : ""}`);
  lines.push(counts.join(" · "));

  lines.push("", "МЕСТА");
  for (const p of r.places) lines.push(`${placeText(p)}. ${p.name}${p.ko ? ` — KO ${formatKo(p.ko)}` : ""}`);

  lines.push("", "КАССА");
  if (!r.cash) lines.push("Денег в турнире не было (цены не заданы)");
  else {
    const s = r.cash.summary;
    const methods = PAY_METHODS.filter((m) => s.byMethod[m] > 0).map((m) => `${PAY_METHOD_LABEL[m].toLowerCase()} ${formatRub(s.byMethod[m])}`);
    lines.push(`Собрано ${formatRub(s.paid)} из ${formatRub(s.charged)}${methods.length ? ` (${methods.join(" · ")})` : ""}`);
    lines.push(
      r.cash.debtors.length
        ? `Долги ${formatRub(s.debt)}: ${r.cash.debtors.map((d) => `${d.name} ${formatRub(d.debt)}`).join(", ")}`
        : "Долгов нет",
    );
    if (s.free > 0) lines.push(`Бесплатно ${formatRub(s.free)}`);
    if (s.overpaid > 0) lines.push(`Переплата ${formatRub(s.overpaid)}`);
  }

  if (!r.rating) lines.push("", "РЕЙТИНГ", "Турнир не попал в рейтинг (период не начат или турнир не идёт в рейтинг)");
  else {
    lines.push("", `РЕЙТИНГ · ${r.rating.periodName} (после турнира)`);
    for (const row of r.rating.top) lines.push(`${row.rank}. ${row.name} — ${row.points} (${formatShift(row.shift)})`);
    lines.push("", "УЧАСТНИКИ В РЕЙТИНГЕ (было → стало)");
    for (const p of r.rating.participants) {
      lines.push(`${p.name}: ${p.before ?? "—"} → ${p.after} место · +${p.gained} очк.`);
    }
  }
  return lines.join("\n");
}
