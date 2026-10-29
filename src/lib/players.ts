// Игроки: проверка имени и телефона, поиск. Чистые функции — общие для сервера и браузера.

export type Player = {
  id: number;
  name: string;
  /** Всегда в виде +79001234567 */
  phone: string;
  note: string;
  firstVisitAt: number | null;
  elo: number;
  createdAt: number;
  updatedAt: number;
};

/** Что присылает админка при добавлении/правке игрока */
export type PlayerInput = { name: string; phone: string; note?: string };

export const NAME_MAX = 60;
export const NOTE_MAX = 300;

/**
 * Привести телефон к виду +79001234567. Понимает «8 900 123-45-67», «+7 (900) 123 45 67»,
 * «9001234567». Иностранный номер — с «+» и кодом страны. null — не похоже на телефон.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) return `+7${digits.slice(1)}`;
  if (digits.length === 10 && digits[0] === "9") return `+7${digits}`;
  if (raw.startsWith("+") && digits.length >= 10 && digits.length <= 15 && !digits.startsWith("7")) return `+${digits}`;
  return null;
}

/** +79001234567 → «+7 900 123-45-67» */
export function formatPhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

/** Последние 4 цифры для списков: «··· 45-67» */
export function phoneTail(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return `··· ${d.slice(-4, -2)}-${d.slice(-2)}`;
}

/** Убрать лишние пробелы в имени: «  саша   к. » → «саша к.» */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Проверить данные игрока. Бросает Error с понятным текстом. */
export function validatePlayer(input: unknown): { name: string; phone: string; note: string } {
  const p = (input ?? {}) as Record<string, unknown>;
  const name = cleanName(String(p.name ?? ""));
  if (!name) throw new Error("Укажите имя или ник");
  if (name.length > NAME_MAX) throw new Error(`Имя слишком длинное (до ${NAME_MAX} символов)`);
  const rawPhone = String(p.phone ?? "").trim();
  if (!rawPhone) throw new Error("Укажите телефон");
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Телефон не похож на настоящий. Пример: +7 900 123-45-67");
  const note = String(p.note ?? "").trim().slice(0, NOTE_MAX);
  return { name, phone, note };
}

/** Для поиска: регистр и «ё» не важны. */
const fold = (s: string) => s.toLowerCase().replaceAll("ё", "е");

/**
 * Найти игроков по части имени или по цифрам телефона (от 3 цифр, обычно последние 4).
 * Сначала те, у кого имя начинается с запроса, потом остальные; внутри — по алфавиту.
 */
export function searchPlayers<T extends Pick<Player, "name" | "phone">>(players: T[], query: string, limit = 20): T[] {
  const q = fold(cleanName(query));
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (!q) return sorted.slice(0, limit);

  const digits = q.replace(/\D/g, "");
  const byPhone = digits.length >= 3 && /^[\d\s()+-]+$/.test(q);
  const words = q.split(" ");

  const scored: { p: T; score: number }[] = [];
  for (const p of sorted) {
    if (byPhone) {
      const pd = p.phone.replace(/\D/g, "");
      if (pd.endsWith(digits)) scored.push({ p, score: 0 });
      else if (pd.includes(digits)) scored.push({ p, score: 1 });
      continue;
    }
    const name = fold(p.name);
    const nameWords = name.split(" ");
    // каждое слово запроса — начало какого-нибудь слова имени («са к» → «Саша Козлов»)
    const allWords = words.every((w) => nameWords.some((nw) => nw.startsWith(w)));
    if (name.startsWith(q)) scored.push({ p, score: 0 });
    else if (allWords) scored.push({ p, score: 1 });
    else if (name.includes(q)) scored.push({ p, score: 2 });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.p);
}

/** Похожие по имени игроки — предупредить «Уже есть: Антон Р. ··· 45-67. Это он?» */
export function similarByName<T extends Pick<Player, "name">>(players: T[], name: string): T[] {
  const q = fold(cleanName(name));
  if (q.length < 2) return [];
  const first = q.split(" ")[0];
  return players.filter((p) => fold(p.name).split(" ")[0] === first);
}
