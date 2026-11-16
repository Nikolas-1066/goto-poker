// Достижения игроков (утверждены владельцем 16.11.2026) — чистые функции.
// Всё считается из истории: сыгранные турниры (места, нокауты, re-entry, ELO, «привёл друга») и закрытые месяцы
// (финалисты, лидер рейтинга). Ничего не отмечается руками; прошлая история засчитывается.
// Для каждого достижения известно, когда и за какой турнир оно получено, — так бот сообщает о новых вместе с итогами.

import { clubToday } from "./schedule";

export type AchievementGroup = "games" | "wins" | "ko" | "finals" | "special";

export const GROUP_LABEL: Record<AchievementGroup, string> = {
  games: "Турниры",
  wins: "Победы и призы",
  ko: "Нокауты",
  finals: "Финалы и рейтинг",
  special: "Особые",
};

/** Что копится по ходу истории игрока */
type State = {
  played: number;
  wins: number;
  top3: number;
  /** Лучшая серия топ-3 подряд */
  top3Streak: number;
  ko: number;
  /** Больше всего нокаутов за один турнир */
  koOne: number;
  finals: number;
  finalWins: number;
  leader: number;
  /** Лучший ELO за всё время */
  elo: number;
  comeback: number;
  brought: number;
  /** Больше всего недель подряд, в каждую из которых играл */
  weeks: number;
};

type Def = {
  id: string;
  title: string;
  icon: string;
  group: AchievementGroup;
  /** За что — для подписи */
  text: string;
  need: number;
  value: (s: State) => number;
};

export const ACHIEVEMENTS: Def[] = [
  { id: "games_1", title: "Первый турнир", icon: "🎟", group: "games", text: "Сыграть первый турнир в клубе", need: 1, value: (s) => s.played },
  { id: "games_10", title: "Завсегдатай", icon: "🪑", group: "games", text: "Сыграть 10 турниров", need: 10, value: (s) => s.played },
  { id: "games_25", title: "Свой человек", icon: "🤝", group: "games", text: "Сыграть 25 турниров", need: 25, value: (s) => s.played },
  { id: "games_50", title: "Ветеран", icon: "🎖", group: "games", text: "Сыграть 50 турниров", need: 50, value: (s) => s.played },
  { id: "games_100", title: "Легенда клуба", icon: "👑", group: "games", text: "Сыграть 100 турниров", need: 100, value: (s) => s.played },

  { id: "wins_1", title: "Первая победа", icon: "🥇", group: "wins", text: "Занять 1-е место в турнире", need: 1, value: (s) => s.wins },
  { id: "wins_5", title: "Чемпион", icon: "🏆", group: "wins", text: "Победить в 5 турнирах", need: 5, value: (s) => s.wins },
  { id: "wins_10", title: "Гроза клуба", icon: "⚡", group: "wins", text: "Победить в 10 турнирах", need: 10, value: (s) => s.wins },
  { id: "top3_5", title: "Призёр", icon: "🥉", group: "wins", text: "5 раз попасть в топ-3", need: 5, value: (s) => s.top3 },
  { id: "top3_20", title: "Стабильность", icon: "📈", group: "wins", text: "20 раз попасть в топ-3", need: 20, value: (s) => s.top3 },
  { id: "top3_streak", title: "Серия", icon: "🔥", group: "wins", text: "Топ-3 три турнира подряд", need: 3, value: (s) => s.top3Streak },

  { id: "ko_10", title: "Охотник", icon: "🎯", group: "ko", text: "10 нокаутов всего", need: 10, value: (s) => s.ko },
  { id: "ko_50", title: "Палач", icon: "🪓", group: "ko", text: "50 нокаутов всего", need: 50, value: (s) => s.ko },
  { id: "ko_100", title: "Терминатор", icon: "🤖", group: "ko", text: "100 нокаутов всего", need: 100, value: (s) => s.ko },
  { id: "ko_one_3", title: "Хет-трик", icon: "🎩", group: "ko", text: "3 нокаута за один турнир", need: 3, value: (s) => s.koOne },
  { id: "ko_one_5", title: "Мясорубка", icon: "🌪", group: "ko", text: "5 нокаутов за один турнир", need: 5, value: (s) => s.koOne },

  { id: "finalist", title: "Финалист", icon: "⭐", group: "finals", text: "Пройти в финал месяца", need: 1, value: (s) => s.finals },
  { id: "finalist_3", title: "Постоянный финалист", icon: "🌟", group: "finals", text: "Пройти в финал месяца 3 раза", need: 3, value: (s) => s.finals },
  { id: "final_win", title: "Чемпион месяца", icon: "🏅", group: "finals", text: "Выиграть финал месяца", need: 1, value: (s) => s.finalWins },
  { id: "month_leader", title: "Лидер месяца", icon: "📊", group: "finals", text: "1-е место в рейтинге, когда месяц закрыли", need: 1, value: (s) => s.leader },
  { id: "elo_1200", title: "Сильный игрок", icon: "💪", group: "finals", text: "ELO 1200", need: 1200, value: (s) => s.elo },
  { id: "elo_1400", title: "Мастер", icon: "🧠", group: "finals", text: "ELO 1400", need: 1400, value: (s) => s.elo },

  { id: "comeback", title: "Камбэк", icon: "🔄", group: "special", text: "Победить в турнире, где брал re-entry", need: 1, value: (s) => s.comeback },
  { id: "friend", title: "Привёл друга", icon: "👋", group: "special", text: "Привести в клуб новичка", need: 1, value: (s) => s.brought },
  { id: "weeks_4", title: "Без пропусков", icon: "📅", group: "special", text: "Играть 4 недели подряд, хотя бы раз в неделю", need: 4, value: (s) => s.weeks },
];

/** Сыгранный турнир игрока (только с местом) */
export type HistoryTournament = {
  tournamentId: number;
  at: number;
  place: number;
  ko: number;
  /** Входов: 1 — без re-entry */
  entries: number;
  kind: string;
  eloAfter: number | null;
  /** Сколько новичков он привёл в этот турнир */
  brought: number;
};

/** Закрытый месяц: прошёл ли игрок в финал и был ли первым в рейтинге */
export type HistoryPeriod = { periodId: number; at: number; finalist: boolean; leader: boolean };

export type PlayerHistory = { tournaments: HistoryTournament[]; periods: HistoryPeriod[] };

export type EarnedAchievement = {
  id: string;
  at: number;
  /** За какой турнир получено (null — за закрытый месяц) */
  tournamentId: number | null;
  periodId: number | null;
};

export type AchievementView = {
  id: string;
  title: string;
  icon: string;
  group: AchievementGroup;
  text: string;
  earned: { at: number; tournamentId: number | null } | null;
  /** Сколько есть и сколько нужно (для полоски «32 из 50») */
  have: number;
  need: number;
  /** У какой доли игроков клуба оно есть, 0…100 */
  percent: number;
};

/** Номер недели (с понедельника) по дню в клубе */
function weekOf(at: number) {
  const [y, m, d] = clubToday(at).split("-").map(Number);
  const days = Date.UTC(y, m - 1, d) / 86_400_000;
  return Math.floor((days - 4) / 7); // 5 января 1970 — понедельник
}

/** Пройти историю по порядку: что получено, когда и за что, и сколько накоплено сейчас */
export function computeAchievements(history: PlayerHistory): { earned: EarnedAchievement[]; state: State } {
  const s: State = { played: 0, wins: 0, top3: 0, top3Streak: 0, ko: 0, koOne: 0, finals: 0, finalWins: 0, leader: 0, elo: 0, comeback: 0, brought: 0, weeks: 0 };
  const events = [
    ...history.tournaments.map((t) => ({ at: t.at, order: 0, t, p: null as HistoryPeriod | null })),
    ...history.periods.map((p) => ({ at: p.at, order: 1, t: null as HistoryTournament | null, p })),
  ].sort((a, b) => a.at - b.at || a.order - b.order || (a.t?.tournamentId ?? 0) - (b.t?.tournamentId ?? 0));

  const earned = new Map<string, EarnedAchievement>();
  let streak = 0;
  let lastWeek: number | null = null;
  let weekRun = 0;
  for (const e of events) {
    if (e.t) {
      const t = e.t;
      s.played += 1;
      if (t.place === 1) s.wins += 1;
      if (t.place <= 3) {
        s.top3 += 1;
        streak += 1;
      } else streak = 0;
      s.top3Streak = Math.max(s.top3Streak, streak);
      s.ko += t.ko;
      s.koOne = Math.max(s.koOne, t.ko);
      if (t.kind === "month_final" && t.place === 1) s.finalWins += 1;
      if (t.eloAfter != null) s.elo = Math.max(s.elo, Math.round(t.eloAfter));
      if (t.place === 1 && t.entries > 1) s.comeback += 1;
      s.brought += t.brought;
      const w = weekOf(t.at);
      if (w !== lastWeek) {
        weekRun = lastWeek != null && w === lastWeek + 1 ? weekRun + 1 : 1;
        lastWeek = w;
      }
      s.weeks = Math.max(s.weeks, weekRun);
    } else if (e.p) {
      if (e.p.finalist) s.finals += 1;
      if (e.p.leader) s.leader += 1;
    }
    for (const def of ACHIEVEMENTS) {
      if (!earned.has(def.id) && def.value(s) >= def.need) {
        earned.set(def.id, { id: def.id, at: e.at, tournamentId: e.t?.tournamentId ?? null, periodId: e.p?.periodId ?? null });
      }
    }
  }
  return { earned: [...earned.values()], state: s };
}

/** Все достижения для показа: полученные и нет, с прогрессом и долей игроков (shares: id → сколько у кого есть) */
export function achievementViews(history: PlayerHistory, shares: Record<string, number>, players: number): AchievementView[] {
  const { earned, state } = computeAchievements(history);
  const got = new Map(earned.map((e) => [e.id, e]));
  return ACHIEVEMENTS.map((d) => {
    const e = got.get(d.id);
    return {
      id: d.id,
      title: d.title,
      icon: d.icon,
      group: d.group,
      text: d.text,
      earned: e ? { at: e.at, tournamentId: e.tournamentId } : null,
      have: Math.min(d.value(state), d.need),
      need: d.need,
      percent: players > 0 ? Math.round(((shares[d.id] ?? 0) / players) * 100) : 0,
    };
  });
}

/** «есть у 12% игроков»; у очень редких — «меньше 1%» */
export function percentText(percent: number, has: boolean): string {
  if (percent === 0) return has ? "есть меньше чем у 1% игроков" : "пока ни у кого нет";
  return `есть у ${percent}% игроков`;
}

/** Новые достижения за турнир — строкой для Telegram: «🎩 Хет-трик, 🥇 Первая победа» */
export function achievementsLine(ids: string[]): string {
  return ids
    .map((id) => ACHIEVEMENTS.find((d) => d.id === id))
    .filter((d): d is Def => !!d)
    .map((d) => `${d.icon} ${d.title}`)
    .join(", ");
}
