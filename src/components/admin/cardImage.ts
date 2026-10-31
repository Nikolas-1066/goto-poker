// Рисование карточек-картинок в стиле табло клуба (canvas в браузере): заголовок, логотип,
// таблица со строками. Используют отчёт после турнира и картинка рейтинга для публикации.

import logo from "@/assets/logo.png";

export const W = 1080;
export const PAD = 64;
const ROW = 64;
const BG = "#080e15";
const PANEL = "#101923";
export const GOLD = "#fcd34d";
export const TEXT = "#e2e8f0";
export const MUTED = "#64748b";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export type Cell = { text: string; color?: string; bold?: boolean };
/** Колонка: правый край (x) или левый, если align = left */
export type Column = { x: number; align: CanvasTextAlign };

export type CardSpec = {
  title: string;
  subtitle: string;
  columns: Column[];
  head: string[];
  rows: Cell[][];
  footer?: string;
  /** Золотая черта над этой строкой (граница финалистов) */
  zoneLineBefore?: number;
};

export function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = logo.src;
  });
}

export function draw(spec: CardSpec, logoImg: HTMLImageElement | null) {
  const top = 250;
  const H = top + 60 + spec.rows.length * ROW + 140;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // шапка: логотип, ГОТО ПОКЕР, заголовок
  if (logoImg) {
    const h = 96;
    ctx.drawImage(logoImg, PAD, 48, (logoImg.width / logoImg.height) * h, h);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.fillStyle = TEXT;
  ctx.font = `900 34px ${FONT}`;
  ctx.fillText("ГОТО", W - PAD - 150, 108);
  ctx.fillStyle = GOLD;
  ctx.fillText("ПОКЕР", W - PAD, 108);

  ctx.textAlign = "left";
  ctx.fillStyle = GOLD;
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText(spec.title, PAD, 200);
  ctx.fillStyle = MUTED;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(spec.subtitle, PAD, 240);

  // панель таблицы
  const panelTop = top + 20;
  const panelH = 60 + spec.rows.length * ROW + 20;
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.roundRect(PAD - 24, panelTop, W - 2 * (PAD - 24), panelH, 24);
  ctx.fill();

  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = MUTED;
  spec.head.forEach((h, i) => {
    ctx.textAlign = spec.columns[i].align;
    ctx.fillText(h.toUpperCase(), spec.columns[i].x, panelTop + 48);
  });

  spec.rows.forEach((row, r) => {
    const y = panelTop + 60 + r * ROW + 42;
    if (r > 0) {
      const zone = r === spec.zoneLineBefore;
      ctx.fillStyle = zone ? GOLD : "rgba(255,255,255,0.06)";
      ctx.fillRect(PAD, y - (zone ? 47 : 46), W - 2 * PAD, zone ? 4 : 2);
    }
    row.forEach((cell, i) => {
      ctx.textAlign = spec.columns[i].align;
      ctx.fillStyle = cell.color ?? TEXT;
      ctx.font = `${cell.bold ? 800 : 500} 32px ${FONT}`;
      ctx.fillText(fit(ctx, cell.text, i === 1 ? 520 : 260), spec.columns[i].x, y);
    });
  });

  if (spec.footer) {
    ctx.textAlign = "center";
    ctx.fillStyle = MUTED;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(spec.footer, W / 2, H - 48);
  }
  return canvas.toDataURL("image/png");
}

/** Обрезать длинное имя с «…» */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
