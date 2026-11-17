// «Вставить список»: админ копирует столбец с никами из Google-таблицы (и телефоны новичков рядом)
// и вставляет в админку. Здесь — чистые функции: разобрать вставленный текст и найти игроков в базе.

import { cleanName, normalizePhone, type Player } from "./players";

export const LIST_MAX_LINES = 200;

/** Одна строка списка */
export type ListLine = {
  /** Номер строки во вставленном тексте (с 1) */
  line: number;
  name: string;
  /** Телефон в виде +79001234567, если указан и похож на настоящий */
  phone: string | null;
  /** Цифры, не похожие на телефон, — показать админу */
  badPhone: string;
};

/** Что нашлось в базе по строке списка */
export type ListMatch =
  /** Точно этот игрок: совпал телефон или ник */
  | { kind: "found"; playerId: number; by: "phone" | "name" }
  /** Похожие ники — админ выбирает сам (или «новый игрок») */
  | { kind: "choose"; candidates: number[] }
  /** Такого нет — новый игрок (нужен телефон) */
  | { kind: "new" };

const HEADERS = new Set(["ник", "никнейм", "ники", "имя", "игрок", "игроки", "nick", "nickname", "name", "телефон"]);

/** Для сравнения: регистр, «ё», пробелы и знаки не важны */
export const nameKey = (s: string) =>
  s
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]/gu, "");

const digitsOnly = (s: string) => /^[\d\s()+-]+$/.test(s) && s.replace(/\D/g, "").length >= 5;

/**
 * Разобрать вставленный текст. Из Google-таблицы столбцы приходят через табуляцию;
 * можно и без неё: «Ник 89001234567». Пустые строки и заголовок «Ник» пропускаются,
 * повтор того же ника склеивается с первым.
 */
export function parseList(text: string): ListLine[] {
  const out: ListLine[] = [];
  const seen = new Map<string, ListLine>();
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((rawLine, i) => {
    const cells = rawLine.split(/\t|;/).map((c) => cleanName(c)).filter(Boolean);
    if (!cells.length) return;
    let name = "";
    let phone: string | null = null;
    let badPhone = "";
    for (const c of cells) {
      if (digitsOnly(c)) {
        const p = normalizePhone(c);
        if (p) phone ??= p;
        else badPhone ||= c;
      } else if (!name) name = c;
    }
    // без табуляции: телефон в конце строки — «Матвей Репин 8 900 123-45-67»
    if (name && !phone && !badPhone) {
      const m = /^(.*?\S)\s+(\+?\d[\d\s()-]{8,})$/.exec(name);
      if (m) {
        const p = normalizePhone(m[2]);
        if (p) {
          name = cleanName(m[1]);
          phone = p;
        }
      }
    }
    if (!name) return;
    if (out.length === 0 && !phone && HEADERS.has(nameKey(name))) return;
    const key = nameKey(name);
    const prev = seen.get(key);
    if (prev) {
      prev.phone ??= phone;
      if (!prev.badPhone && !prev.phone) prev.badPhone = badPhone;
      return;
    }
    const row: ListLine = { line: i + 1, name: name.slice(0, 60), phone, badPhone };
    seen.set(key, row);
    out.push(row);
  });
  if (out.length > LIST_MAX_LINES) throw new Error(`Слишком длинный список — не больше ${LIST_MAX_LINES} строк за раз`);
  return out;
}

/** Расстояние Левенштейна — сколько букв поправить, чтобы из одного получилось другое */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e",
  ю: "u", я: "ya",
};
/** «Гост» → «gost»: чтобы «Ghost» и «Гост» оказались похожими */
const latin = (key: string) => [...key].map((ch) => TRANSLIT[ch] ?? ch).join("");

/** Насколько ники похожи: 0 — одинаковые, больше — дальше; null — не похожи */
function likeness(a: string, b: string): number | null {
  if (!a || !b) return null;
  if (a === b) return 0;
  const la = latin(a);
  const lb = latin(b);
  if (la === lb) return 1;
  const short = Math.min(la.length, lb.length);
  const d = editDistance(la, lb);
  const limit = short >= 7 ? 2 : short >= 4 ? 1 : 0;
  if (d <= limit) return 1 + d;
  // «Матвей» ↔ «Матвей Репин», «Коля» ↔ «Колян»
  if (short >= 3 && (la.startsWith(lb) || lb.startsWith(la))) return 4;
  return null;
}

/** Найти игрока по строке списка: сначала по телефону, потом по нику, иначе — похожие ники */
export function matchLine<T extends Pick<Player, "id" | "name" | "phone">>(row: Pick<ListLine, "name" | "phone">, players: T[]): ListMatch {
  if (row.phone) {
    const byPhone = players.find((p) => p.phone === row.phone);
    if (byPhone) return { kind: "found", playerId: byPhone.id, by: "phone" };
  }
  const key = nameKey(row.name);
  const same = players.filter((p) => nameKey(p.name) === key);
  if (same.length === 1) return { kind: "found", playerId: same[0].id, by: "name" };
  if (same.length > 1) return { kind: "choose", candidates: same.map((p) => p.id) };
  const firstWord = nameKey(row.name.split(" ")[0]);
  const similar = players
    .map((p) => {
      let score = likeness(key, nameKey(p.name));
      // совпало первое слово: «Матвей Репин» ↔ «Матвей Р.»
      if (score == null && firstWord.length >= 3 && nameKey(p.name.split(" ")[0]) === firstWord) score = 5;
      return { p, score };
    })
    .filter((x): x is { p: T; score: number } => x.score != null)
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name, "ru"))
    .slice(0, 5);
  return similar.length ? { kind: "choose", candidates: similar.map((x) => x.p.id) } : { kind: "new" };
}
