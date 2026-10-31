// Выгрузка в Excel из «Статистики» (только владельцу): за месяц, год или всё время.
// Листы: Сводка, Турниры, Места, Касса, Долги, Игроки, Рейтинг. Правила периодов — как в docs/STATS.md.

import type { DatabaseSync } from "node:sqlite";
import { PAY_METHOD_LABEL, type PayMethod } from "../cash";
import { formatPhone } from "../players";
import { KIND_LABEL, type TournamentKind } from "../rating/points";
import { computeStats, WEEKDAYS, type Range } from "../stats";
import type { CellValue, Sheet } from "../xlsx";
import { debtsByPlayer, tournamentCash } from "./cash";
import { listPeriods, standingsOf, type Period } from "./periods";
import { loadStatsData } from "./stats";

const date = (ts: number) => new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTime = (ts: number) =>
  new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ko = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10);

type TRow = { id: number; at: number; name: string; kind: string; mode: string };

/** Листы Excel за период [from, to); title — «Октябрь 2026», «2026 год», «За всё время» */
export function exportSheets(db: DatabaseSync, range: Range, title: string): Sheet[] {
  const data = loadStatsData(db);
  const s = computeStats(data, range);

  // ---- Сводка
  const summary: Sheet = {
    name: "Сводка",
    widths: [34, 22],
    rows: [
      ["Показатель", title],
      ["Собрано, ₽", s.paid],
      ...(["cash", "card", "transfer"] as PayMethod[]).map((m): CellValue[] => [`  ${PAY_METHOD_LABEL[m]}, ₽`, s.byMethod[m]]),
      ["Долги за турниры периода, ₽", s.debt],
      ["Бесплатно, ₽", s.free],
      ["Турниров", s.tournaments],
      ["Разных игроков", s.players],
      ["В среднем игроков на турнир", s.avgPlayers],
      ["Новых игроков", s.newPlayers],
      ["Входов", s.entries],
      ["Re-entry", s.reentries],
      ["Аддонов", s.addons],
      ["Двойных аддонов", s.doubleAddons],
      [],
      ["День недели", "Турниров / в среднем игроков / в среднем собрано, ₽"],
      ...s.weekdays.map((d): CellValue[] => [WEEKDAYS[d.weekday], d.tournaments ? `${d.tournaments} / ${d.avgPlayers} / ${d.avgPaid}` : "—"]),
    ],
  };

  // ---- Турниры периода (завершённые, по дате начала)
  const tournaments = (
    db
      .prepare(
        `SELECT id, COALESCE(started_at, created_at) AS at, name, kind, mode FROM tournaments
         WHERE status = 'finished' AND COALESCE(started_at, created_at) >= ? AND COALESCE(started_at, created_at) < ?
         ORDER BY at`,
      )
      .all(range.from, range.to) as TRow[]
  ).map((t) => ({ ...t, cash: tournamentCash(db, t.id) }));
  const tName = new Map(
    (db.prepare("SELECT id, name, COALESCE(started_at, created_at) AS at FROM tournaments").all() as { id: number; name: string; at: number }[]).map(
      (t) => [t.id, `${date(t.at)} ${t.name.trim()}`],
    ),
  );
  const fig = new Map(
    data.tournaments.map((t) => {
      const parts = data.participations.filter((p) => p.tournamentId === t.id);
      const manual = t.mode === "manual";
      return [
        t.id,
        {
          players: manual ? t.counters.entries : parts.length,
          reentries: manual ? t.counters.rebuys : parts.reduce((a, p) => a + Math.max(0, p.entries - 1), 0),
          addons: manual ? t.counters.addons + t.counters.doubleAddons : parts.reduce((a, p) => a + p.addons + p.doubleAddons, 0),
        },
      ];
    }),
  );
  const tournamentsSheet: Sheet = {
    name: "Турниры",
    widths: [17, 26, 14, 12, 10, 10, 10, 14, 12, 12],
    rows: [
      ["Дата", "Турнир", "Вид", "Учёт", "Игроков", "Re-entry", "Аддонов", "Начислено, ₽", "Собрано, ₽", "Долг, ₽"],
      ...tournaments.map((t): CellValue[] => {
        const f = fig.get(t.id);
        return [
          dateTime(t.at),
          t.name.trim(),
          KIND_LABEL[t.kind as TournamentKind] ?? t.kind,
          t.mode === "manual" ? "вручную" : "по игрокам",
          f?.players ?? 0,
          f?.reentries ?? 0,
          f?.addons ?? 0,
          t.cash.summary.charged,
          t.cash.summary.paid,
          t.cash.summary.debt,
        ];
      }),
    ],
  };

  // ---- Места
  const ids = tournaments.map((t) => t.id);
  const placeRows = ids.length
    ? (db
        .prepare(
          `SELECT p.tournament_id, p.place, p.place_to, pl.name, pl.phone, p.ko, p.entries, p.points,
                  (SELECT COUNT(*) FROM events e WHERE e.participant_id = p.id AND e.type IN ('addon', 'double_addon') AND e.cancelled_at IS NULL) AS addons
           FROM participants p JOIN players pl ON pl.id = p.player_id
           WHERE p.tournament_id IN (${ids.map(() => "?").join(",")}) AND p.status IN ('playing', 'busted')
           ORDER BY p.tournament_id, p.place`,
        )
        .all(...ids) as {
        tournament_id: number;
        place: number | null;
        place_to: number | null;
        name: string;
        phone: string | null;
        ko: number;
        entries: number;
        points: number | null;
        addons: number;
      }[])
    : [];
  const places: Sheet = {
    name: "Места",
    widths: [30, 8, 22, 18, 9, 9, 9, 9],
    rows: [
      ["Турнир", "Место", "Игрок", "Телефон", "Нокауты", "Входов", "Аддон", "Очки"],
      ...placeRows.map((r): CellValue[] => [
        tName.get(r.tournament_id) ?? "",
        r.place == null ? "" : r.place_to ? `${r.place}–${r.place_to}` : r.place,
        r.name,
        r.phone ? formatPhone(r.phone) : "",
        ko(r.ko),
        r.entries,
        r.addons ? "да" : "",
        r.points,
      ]),
    ],
  };

  // ---- Касса: оплаты по дню оплаты
  const pays = data.payments.filter((p) => p.at >= range.from && p.at < range.to).sort((a, b) => a.at - b.at);
  const cash: Sheet = {
    name: "Касса",
    widths: [17, 22, 30, 12, 12],
    rows: [
      ["Дата оплаты", "Игрок", "За турнир", "Сумма, ₽", "Способ"],
      ...pays.map((p): CellValue[] => [dateTime(p.at), p.name, tName.get(p.tournamentId) ?? "", p.amount, PAY_METHOD_LABEL[p.method]]),
      [],
      ["Итого", "", "", s.paid, ""],
    ],
  };

  // ---- Долги сейчас — за турниры периода
  const inRange = new Set(ids);
  const debtRows: CellValue[][] = [];
  const names = new Map((db.prepare("SELECT id, name FROM players").all() as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  const allDebts = debtsByPlayer(db);
  for (const [playerId, list] of allDebts) {
    for (const d of list) if (inRange.has(d.tournamentId)) debtRows.push([names.get(playerId) ?? "", tName.get(d.tournamentId) ?? "", d.debt]);
  }
  debtRows.sort((a, b) => Number(b[2]) - Number(a[2]));
  const debts: Sheet = {
    name: "Долги",
    widths: [22, 30, 12],
    rows: [["Игрок", "Турнир", "Долг сейчас, ₽"], ...debtRows, ...(debtRows.length ? [] : [["Долгов нет"]])],
  };

  // ---- Игроки за период
  const players = new Map<number, { name: string; tournaments: number; wins: number; ko: number; brought: number }>();
  const get = (id: number, name: string) => {
    let p = players.get(id);
    if (!p) players.set(id, (p = { name, tournaments: 0, wins: 0, ko: 0, brought: 0 }));
    return p;
  };
  const kos = new Map(
    (
      db.prepare("SELECT tournament_id, player_id, ko, place FROM participants WHERE status IN ('playing', 'busted')").all() as {
        tournament_id: number;
        player_id: number;
        ko: number;
        place: number | null;
      }[]
    ).map((r) => [`${r.tournament_id}:${r.player_id}`, r]),
  );
  for (const p of data.participations) {
    if (!inRange.has(p.tournamentId)) continue;
    const row = get(p.playerId, p.name);
    const k = kos.get(`${p.tournamentId}:${p.playerId}`);
    row.tournaments += 1;
    row.wins += k?.place === 1 ? 1 : 0;
    row.ko += k?.ko ?? 0;
  }
  for (const p of pays) get(p.playerId, p.name).brought += p.amount;
  const info = new Map(
    (db.prepare("SELECT id, phone, elo FROM players").all() as { id: number; phone: string | null; elo: number }[]).map((p) => [p.id, p]),
  );
  const playersSheet: Sheet = {
    name: "Игроки",
    widths: [22, 18, 10, 8, 9, 13, 13, 8],
    rows: [
      ["Игрок", "Телефон", "Турниров", "Побед", "Нокауты", "Принёс, ₽", "Долг всего, ₽", "ELO"],
      ...[...players]
        .sort((a, b) => b[1].tournaments - a[1].tournaments || b[1].brought - a[1].brought || a[1].name.localeCompare(b[1].name, "ru"))
        .map(([id, p]): CellValue[] => {
          const i = info.get(id);
          return [
            p.name,
            i?.phone ? formatPhone(i.phone) : "",
            p.tournaments,
            p.wins,
            ko(p.ko),
            p.brought,
            (allDebts.get(id) ?? []).reduce((a, d) => a + d.debt, 0),
            i ? Math.round(i.elo) : "",
          ];
        }),
    ],
  };

  // ---- Рейтинг: за месяц — период месяца, который больше всего пересекается с выбранным; иначе — за всё время
  const overlap = (p: Period) => Math.min(range.to, p.closedAt ?? Number.MAX_SAFE_INTEGER) - Math.max(range.from, p.startedAt);
  const isMonth = range.to - range.from < 32 * 86_400_000;
  const period = isMonth
    ? listPeriods(db)
        .filter((p) => p.kind === "month" && overlap(p) > 0)
        .sort((a, b) => overlap(b) - overlap(a))[0]
    : undefined;
  const standings = standingsOf(db, period ?? "all");
  const rating: Sheet = {
    name: "Рейтинг",
    widths: [8, 22, 10, 8, 12, 9, 10],
    rows: [
      [period ? `Рейтинг · ${period.name}` : "Рейтинг за всё время"],
      ["Место", "Игрок", "Очки", "Побед", "Лучшее место", "Нокауты", "Турниров"],
      ...standings.map((r): CellValue[] => [r.rank, r.name, r.points, r.wins, r.bestPlace, ko(r.ko), r.tournaments]),
    ],
  };

  return [summary, tournamentsSheet, places, cash, debts, playersSheet, rating];
}
