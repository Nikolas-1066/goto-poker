"use client";

// Сигналы табло через Web Audio (без файлов): колокольный «чайм» из нескольких
// обертонов, пропущенный через компрессор — звучит громко и не хрипит.
// Браузер разрешает звук только после клика по странице, поэтому есть unlock().

let ctx: AudioContext | null = null;
let master: AudioNode | null = null;

/** Общая громкость 0…1 */
const MASTER_VOLUME = 1;

/** Цепочка выхода: компрессор → усиление → колонки. Возвращает вход цепочки. */
export function graph(c: BaseAudioContext): AudioNode {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 8;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  const out = c.createGain();
  out.gain.value = MASTER_VOLUME;
  // Компрессор выравнивает пики, makeup-gain поднимает общую громкость.
  const makeup = c.createGain();
  makeup.gain.value = 1.25;
  // Лимитер на выходе — страховка от хрипа на любых колонках.
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  comp.connect(makeup).connect(out).connect(limiter).connect(c.destination);
  return comp;
}

export function unlockAudio() {
  if (typeof window === "undefined") return false;
  if (!ctx) {
    ctx = new AudioContext();
    master = graph(ctx);
  }
  void ctx.resume();
  return true;
}

/**
 * Попробовать включить звук без клика. Получится в киоск-браузере
 * с разрешённым автозапуском (Fully Kiosk, Chrome с флагом autoplay).
 */
export async function tryAutoUnlock() {
  if (typeof window === "undefined") return false;
  unlockAudio();
  try {
    await Promise.race([ctx!.resume(), new Promise((r) => setTimeout(r, 500))]);
  } catch {
    /* браузер не разрешил — останется кнопка */
  }
  return audioReady();
}

export function audioReady() {
  return ctx?.state === "running";
}

// Обертоны «колокольчика» (отношения к основной частоте, громкость, затухание в с).
// Не гонг: верхние обертоны быстро гаснут, остаётся чистый яркий тон.
const BELL: [ratio: number, gain: number, decay: number][] = [
  [1, 1, 2.2],
  [2, 0.55, 1.4],
  [3, 0.28, 0.9],
  [4.2, 0.18, 0.5],
  [5.4, 0.12, 0.35],
  [0.5, 0.22, 1.6], // мягкий «корпус» снизу
];

function bell(
  c: BaseAudioContext,
  dest: AudioNode,
  freq: number,
  start: number,
  volume = 0.5,
  length = 1,
) {
  const t0 = c.currentTime + start;
  for (const [ratio, g, decay] of BELL) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    const d = decay * length;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(volume * g, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    osc.connect(env).connect(dest);
    osc.start(t0);
    osc.stop(t0 + d + 0.05);
  }
  // Короткий «удар» молоточка — даёт атаку и разборчивость в шумном зале.
  const click = c.createOscillator();
  const clickEnv = c.createGain();
  click.type = "triangle";
  click.frequency.value = freq * 6;
  clickEnv.gain.setValueAtTime(volume * 0.25, t0);
  clickEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
  click.connect(clickEnv).connect(dest);
  click.start(t0);
  click.stop(t0 + 0.1);
}

/** Мелодии сигналов — используются и вживую, и в тестовом рендере. */
export const SOUNDS = {
  /** Blinds up: восходящее трезвучие ми-соль#-си + финальная октава */
  levelUp(c: BaseAudioContext, dest: AudioNode) {
    bell(c, dest, 659.25, 0.0, 0.45, 0.7); // E5
    bell(c, dest, 830.61, 0.22, 0.45, 0.7); // G#5
    bell(c, dest, 987.77, 0.44, 0.45, 0.8); // B5
    bell(c, dest, 1318.5, 0.7, 0.55, 1.4); // E6 — держится дольше
    bell(c, dest, 659.25, 0.7, 0.3, 1.4); // E5 — опора под финалом
  },
  /** Начало перерыва: мягкий нисходящий «дин-дон» */
  breakStart(c: BaseAudioContext, dest: AudioNode) {
    bell(c, dest, 987.77, 0.0, 0.45, 1);
    bell(c, dest, 783.99, 0.45, 0.45, 1);
    bell(c, dest, 659.25, 0.9, 0.5, 1.5);
  },
  /** Последние 10 секунд: тихий «тик» каждую секунду (последние 3 — чуть выше) */
  tick(c: BaseAudioContext, dest: AudioNode, urgent = false) {
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = urgent ? 1760 : 1320;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(urgent ? 0.22 : 0.14, t0 + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
    osc.connect(env).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  },
  /** Вылет игрока: тяжёлый нисходящий аккорд — «бум» и спуск вниз */
  bust(c: BaseAudioContext, dest: AudioNode) {
    bell(c, dest, 523.25, 0.0, 0.5, 0.5); // C5
    bell(c, dest, 415.3, 0.18, 0.5, 0.5); // G#4
    bell(c, dest, 329.63, 0.36, 0.55, 0.6); // E4
    bell(c, dest, 220.0, 0.6, 0.6, 1.6); // A3 — низкая, держится
    bell(c, dest, 110.0, 0.6, 0.35, 1.6); // A2 — опора
  },
  /** Осталась минута: два коротких «пинга» */
  warning(c: BaseAudioContext, dest: AudioNode) {
    bell(c, dest, 1174.66, 0.0, 0.35, 0.35);
    bell(c, dest, 1174.66, 0.28, 0.35, 0.35);
  },
};

function play(name: "levelUp" | "breakStart" | "warning" | "bust") {
  if (!ctx || !master || !audioReady()) return;
  SOUNDS[name](ctx, master);
}

export function playTick(urgent = false) {
  if (!ctx || !master || !audioReady()) return;
  SOUNDS.tick(ctx, master, urgent);
}

export const playLevelChange = () => play("levelUp");
export const playBreakStart = () => play("breakStart");
export const playWarning = () => play("warning");
export const playBust = () => play("bust");
