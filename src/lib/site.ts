// Сайт клуба (docs/SITE.md, шаг 2): типы открытых данных и текст «О клубе» — чистые функции.
// На сайт уходят только имена, места, очки, нокауты и ELO. Телефоны, заметки, касса и долги — никогда.

export type SiteStanding = { rank: number; playerId: number; name: string; points: number; tournaments: number; wins: number; ko: number };

export type SitePeriod = {
  id: number;
  /** «Месяц · Ноябрь» */
  label: string;
  /** Сколько человек проходит в финал (золотая черта после этого места) */
  finalistsN: number;
  rows: SiteStanding[];
};

export type SiteEloRow = { rank: number; playerId: number; name: string; elo: number; games: number };

export type SiteRating = {
  /** Идущие периоды: месяц и, если включены, сезон и год */
  open: SitePeriod[];
  all: SiteStanding[];
  elo: SiteEloRow[];
  /** Закрытые периоды — для архива */
  archive: { id: number; label: string }[];
};

export type SiteArchive = SitePeriod & {
  /** Кто прошёл в финал: по рейтингу или по приглашению (wildcard) */
  finalists: { playerId: number; name: string; rank: number | null; wildcard: boolean }[];
};

export type SiteResult = {
  id: number;
  name: string;
  /** «Финал месяца» и т.п.; у обычного турнира — пусто */
  kindLabel: string;
  at: number;
  players: number;
  top: { playerId: number; name: string; place: string; points: number | null; ko: number }[];
};

/** Все места сыгранного турнира — открывается по нажатию на турнир */
export type SiteResultFull = Omit<SiteResult, "top"> & {
  rows: { playerId: number; name: string; place: string; points: number | null; ko: number }[];
};

/** Турнир, который идёт прямо сейчас, — то же, что видно на табло в клубе */
export type SiteLive = {
  name: string;
  kindLabel: string;
  paused: boolean;
  onBreak: boolean;
  /** Номер уровня (на перерыве — следующего) и его блайнды */
  level: number;
  blinds: { sb: number; bb: number; ante: number } | null;
  avgStack: number | null;
  /** Сколько человек в игре и сколько всего пришло */
  playing: number;
  total: number;
  /** Кто в игре: сначала у кого больше нокаутов */
  players: { playerId: number; name: string; ko: number }[];
  /** Кто вылетел: по местам */
  out: { playerId: number; name: string; place: string; ko: number }[];
  /** Лидеры по фишкам — только по стекам, которые посчитали в клубе */
  chipLeaders: { playerId: number; name: string; stack: number }[];
};

export type SitePlayer = {
  id: number;
  name: string;
  elo: number;
  eloGames: number;
  stats: { tournaments: number; wins: number; top3: number; bestPlace: number | null; ko: number; points: number };
  ratings: { label: string; rank: number | null; of: number; points: number }[];
  finals: string[];
  tournaments: { id: number; name: string; kindLabel: string; at: number; field: number; place: string; points: number | null; ko: number }[];
};

export type SiteScheduleItem = {
  id: number;
  date: string;
  time: string;
  name: string;
  note: string;
  seatLimit: number | null;
  /** Турнир уже открыт в клубе (идёт сегодня) */
  started: boolean;
  structure: { name: string; startingStack: number; entryPrice: number } | null;
};

/** Цифры клуба для главной — считаются по базе, ничего не придумано */
export type SiteFacts = { players: number; tournaments: number; finalistsN: number | null };

// ---------- «О клубе» ----------

export type SiteAbout = {
  address: string;
  /** Как добраться */
  how: string;
  phone: string;
  telegram: string;
  vk: string;
  /** О клубе — свободный текст */
  about: string;
  /** Правила клуба — свободный текст */
  rules: string;
};

export const ABOUT_EMPTY: SiteAbout = { address: "", how: "", phone: "", telegram: "", vk: "", about: "", rules: "" };

const text = (v: unknown, max: number, label: string) => {
  const s = String(v ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (s.length > max) throw new Error(`${label} — не длиннее ${max} символов`);
  return s;
};

/** Ссылка: «t.me/gotopoker» → «https://t.me/gotopoker». Только http/https — другое на сайт не попадёт. */
export function sanitizeLink(v: unknown, label: string): string {
  let s = text(v, 200, label);
  if (!s) return "";
  if (s.startsWith("@")) throw new Error(`${label} — нужна ссылка целиком, например https://t.me/название`);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new Error(`${label} — это не похоже на ссылку`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${label} — ссылка должна начинаться с https://`);
  if (!url.hostname.includes(".")) throw new Error(`${label} — это не похоже на ссылку`);
  return url.toString();
}

/** Привести «О клубе» к корректному виду. Бросает Error с понятным текстом. */
export function sanitizeAbout(input: unknown): SiteAbout {
  const p = (input ?? {}) as Record<string, unknown>;
  return {
    address: text(p.address, 200, "Адрес"),
    how: text(p.how, 500, "Как добраться"),
    phone: text(p.phone, 40, "Телефон"),
    telegram: sanitizeLink(p.telegram, "Telegram"),
    vk: sanitizeLink(p.vk, "ВКонтакте"),
    about: text(p.about, 3000, "О клубе"),
    rules: text(p.rules, 5000, "Правила"),
  };
}

export const aboutIsEmpty = (a: SiteAbout) => Object.values(a).every((v) => !v);

/** «12 ноября 2026» — по часам клуба */
export function formatSiteDate(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric" }).format(ts).replace(" г.", "");
}

/** «1 игрок», «3 игрока», «12 игроков» */
export function playersWord(n: number): string {
  const d = n % 10;
  const h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? "игрок" : d >= 2 && d <= 4 && (h < 12 || h > 14) ? "игрока" : "игроков"}`;
}
