// Открытые данные для сайта клуба (docs/SITE.md, шаг 2). Сайт открыт без пароля, поэтому здесь
// только имена, места, очки, нокауты и ELO — без телефонов, заметок, кассы и долгов.
// Каждое поле перечислено явно: новое поле в карточке игрока само на сайт не попадёт.

import type { DatabaseSync } from "node:sqlite";
import { KIND_LABEL, type TournamentKind } from "../rating/points";
import type { Standing } from "../rating/standings";
import { formatPlace } from "../results";
import { clubToday } from "../schedule";
import {
  ABOUT_EMPTY,
  sanitizeAbout,
  type SiteAbout,
  type SiteArchive,
  type SiteFacts,
  type SitePeriod,
  type SitePlayer,
  type SiteRating,
  type SiteResult,
  type SiteScheduleItem,
  type SiteStanding,
} from "../site";
import { finalistsOf, getPeriod, listPeriods, openPeriod, PERIOD_LABEL, standingsOf, type Period } from "./periods";
import { playerCard } from "./playercard";
import { ensureSchedule, listSchedule } from "./schedule";
import { getSettings, type PeriodKind } from "./settings";
import { audit } from "./sqlite";

const row = (s: Standing): SiteStanding => ({
  rank: s.rank,
  playerId: s.playerId,
  name: s.name,
  points: s.points,
  tournaments: s.tournaments,
  wins: s.wins,
  ko: s.ko,
});

const periodLabel = (p: Period) => `${PERIOD_LABEL[p.kind]} · ${p.name}`;
const sitePeriod = (db: DatabaseSync, p: Period): SitePeriod => ({
  id: p.id,
  label: periodLabel(p),
  finalistsN: p.finalistsN,
  rows: standingsOf(db, p).map(row),
});
const kindLabel = (kind: string) => (kind === "regular" ? "" : (KIND_LABEL[kind as TournamentKind] ?? ""));

// ---------- Рейтинг ----------

export function siteRating(db: DatabaseSync): SiteRating {
  const settings = getSettings(db);
  const kinds: PeriodKind[] = ["month", ...(settings.seasonEnabled ? ["season" as const] : []), ...(settings.yearEnabled ? ["year" as const] : [])];
  const open = kinds.map((k) => openPeriod(db, k)).filter((p): p is Period => p != null);
  const elo = (
    db
      .prepare("SELECT id, name, elo, elo_games FROM players WHERE elo_games > 0 AND archived_at IS NULL ORDER BY elo DESC, elo_games DESC, name")
      .all() as { id: number; name: string; elo: number; elo_games: number }[]
  ).map((p, i) => ({ rank: i + 1, playerId: p.id, name: p.name, elo: Math.round(p.elo), games: p.elo_games }));
  return {
    open: open.map((p) => sitePeriod(db, p)),
    all: standingsOf(db, "all").map(row),
    elo,
    archive: listPeriods(db)
      .filter((p) => p.closedAt != null)
      .map((p) => ({ id: p.id, label: periodLabel(p) })),
  };
}

/** Закрытый период из архива: итоговая таблица и финалисты. null — нет такого или он ещё идёт */
export function siteArchive(db: DatabaseSync, periodId: number): SiteArchive | null {
  const p = getPeriod(db, periodId);
  if (!p || p.closedAt == null) return null;
  const view = sitePeriod(db, p);
  const names = new Map(view.rows.map((r) => [r.playerId, r.name]));
  const nameOf = db.prepare("SELECT name FROM players WHERE id = ?");
  return {
    ...view,
    finalists: finalistsOf(db, p).finalists.map((f) => ({
      playerId: f.playerId,
      name: names.get(f.playerId) ?? (nameOf.get(f.playerId) as { name: string } | undefined)?.name ?? "?",
      rank: f.rank,
      wildcard: f.source === "wildcard",
    })),
  };
}

/** Сколько игроков уже играло в клубе, сколько турниров сыграно, сколько человек выходит в финал месяца */
export function siteFacts(db: DatabaseSync): SiteFacts {
  const n = db
    .prepare(
      `SELECT (SELECT COUNT(DISTINCT p.player_id) FROM participants p WHERE p.place IS NOT NULL) AS players,
              (SELECT COUNT(*) FROM tournaments t WHERE t.status = 'finished' AND t.mode = 'players'
                 AND EXISTS (SELECT 1 FROM participants p WHERE p.tournament_id = t.id AND p.place IS NOT NULL)) AS tournaments`,
    )
    .get() as { players: number; tournaments: number };
  return { players: n.players, tournaments: n.tournaments, finalistsN: openPeriod(db, "month")?.finalistsN ?? null };
}

// ---------- Итоги турниров: топ-3 и сколько было игроков ----------

export function siteResults(db: DatabaseSync, limit = 40): SiteResult[] {
  const tournaments = db
    .prepare(
      `SELECT t.id, t.name, t.kind, COALESCE(t.started_at, t.created_at) AS at,
              (SELECT COUNT(*) FROM participants p WHERE p.tournament_id = t.id AND p.status NOT IN ('registered', 'no_show')) AS players
       FROM tournaments t
       WHERE t.status = 'finished' AND t.mode = 'players'
         AND EXISTS (SELECT 1 FROM participants p WHERE p.tournament_id = t.id AND p.place IS NOT NULL)
       ORDER BY at DESC, t.id DESC LIMIT ?`,
    )
    .all(limit) as { id: number; name: string; kind: string; at: number; players: number }[];
  const top = db.prepare(
    `SELECT p.player_id, pl.name, p.place, p.place_to, p.points, p.ko
     FROM participants p JOIN players pl ON pl.id = p.player_id
     WHERE p.tournament_id = ? AND p.place IS NOT NULL AND p.place <= 3
     ORDER BY p.place, pl.name`,
  );
  return tournaments.map((t) => ({
    id: t.id,
    name: t.name,
    kindLabel: kindLabel(t.kind),
    at: t.at,
    players: t.players,
    top: (top.all(t.id) as { player_id: number; name: string; place: number; place_to: number | null; points: number | null; ko: number }[]).map((r) => ({
      playerId: r.player_id,
      name: r.name,
      place: formatPlace({ place: r.place, placeTo: r.place_to }),
      points: r.points,
      ko: r.ko,
    })),
  }));
}

// ---------- Страница игрока ----------

export function sitePlayer(db: DatabaseSync, playerId: number): SitePlayer | null {
  const card = playerCard(db, playerId);
  if (!card) return null;
  return {
    id: card.player.id,
    name: card.player.name,
    elo: card.player.elo,
    eloGames: card.player.eloGames,
    stats: {
      tournaments: card.stats.tournaments,
      wins: card.stats.wins,
      top3: card.stats.top3,
      bestPlace: card.stats.bestPlace,
      ko: card.stats.ko,
      points: card.stats.points,
    },
    ratings: card.ratings.map((r) => ({ label: r.label, rank: r.rank, of: r.of, points: r.points })),
    finals: [...card.finals],
    // только сыгранные турниры: у идущего места ещё нет
    tournaments: card.tournaments
      .filter((t) => t.place != null)
      .map((t) => ({
        id: t.tournamentId,
        name: t.name,
        kindLabel: kindLabel(t.kind),
        at: t.at,
        field: t.field,
        place: formatPlace({ place: t.place, placeTo: t.placeTo }),
        points: t.points,
        ko: t.ko,
      })),
  };
}

// ---------- Расписание ----------

/** Ближайшие турниры: без отменённых; заодно ставит турниры постоянных дней на 2 недели вперёд */
export function siteSchedule(db: DatabaseSync, now = Date.now()): { today: string; items: SiteScheduleItem[] } {
  const today = clubToday(now);
  ensureSchedule(db, today, now);
  const presets = new Map(
    (db.prepare("SELECT id, name, starting_stack, prices_json FROM presets").all() as { id: string; name: string; starting_stack: number; prices_json: string | null }[]).map(
      (p) => {
        let entryPrice = 0;
        try {
          entryPrice = Number((JSON.parse(p.prices_json ?? "{}") as { entry?: number }).entry) || 0;
        } catch {
          entryPrice = 0;
        }
        return [p.id, { name: p.name, startingStack: p.starting_stack, entryPrice }];
      },
    ),
  );
  const items = listSchedule(db, today)
    // открытый турнир виден только в свой день («идёт сегодня»)
    .filter((it) => it.status === "planned" || (it.status === "started" && it.date === today))
    .map((it) => ({
      id: it.id,
      date: it.date,
      time: it.time,
      name: it.name,
      note: it.note,
      seatLimit: it.seatLimit,
      started: it.status === "started",
      structure: presets.get(it.presetId) ?? null,
    }));
  return { today, items };
}

// ---------- «О клубе» (settings, ключ «site_about») ----------

export function getAbout(db: DatabaseSync): SiteAbout {
  const r = db.prepare("SELECT value_json FROM settings WHERE key = 'site_about'").get() as { value_json: string } | undefined;
  if (!r) return { ...ABOUT_EMPTY };
  try {
    return sanitizeAbout(JSON.parse(r.value_json));
  } catch {
    return { ...ABOUT_EMPTY };
  }
}

export function saveAbout(db: DatabaseSync, input: unknown, now = Date.now()): SiteAbout {
  const next = sanitizeAbout(input);
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('site_about', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(next),
  );
  audit(db, "site.about.save", {}, now);
  return next;
}
