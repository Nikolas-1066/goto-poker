"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import logo from "@/assets/logo.png";
import { boardView, formatChips, formatClock, stepMs, type BoardView } from "@/lib/clock";
import { playBreakStart, playLevelChange, playTick, playWarning, unlockAudio } from "@/lib/sound";
import type { Tournament } from "@/lib/types";
import { useTournament } from "@/lib/useTournament";
import { useTvMode } from "@/lib/useTvMode";
import { ChipLeaders, countedLabel } from "@/components/board/ChipLeaders";
import { RatingRotator, useBoardRating } from "@/components/board/RatingRotator";

/** Сколько секунд показывать заставку BLINDS UP после начала уровня */
const BLINDS_UP_MS = 6000;
/** Последние N мс уровня — красные пульсирующие цифры и тиканье */
const FINAL_COUNTDOWN_MS = 10_000;

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/[0.09] bg-[#101923]/90 ${className}`}
    >
      {children}
    </section>
  );
}

function SideCard({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: string;
  description: string;
  icon: string;
}) {
  return (
    <Panel className="flex min-h-0 flex-1 flex-col items-center justify-center p-5 text-center xl:p-6">
      <div className="flex items-center justify-center gap-3">
        <span className="tv-lg text-amber-300">{icon}</span>

        <span className="tv-sm font-bold uppercase tracking-[0.18em] text-slate-300">
          {label}
        </span>
      </div>

      <div className="mt-3 whitespace-nowrap text-[clamp(2.25rem,3.9vw,5.5rem)] font-black leading-none tabular-nums tracking-tight">
        {value}
      </div>

      <div className="tv-sm mt-3 text-slate-400">
        {description}
      </div>
    </Panel>
  );
}

const STATUS_LABEL = {
  idle: "ОЖИДАНИЕ СТАРТА",
  paused: "ПАУЗА",
  finished: "ТУРНИР ЗАВЕРШЁН",
} as const;

/** Большие цифры таймера: красные и пульсирующие в последние 10 секунд */
function Countdown({
  ms,
  status,
  className,
}: {
  ms: number;
  status: Tournament["status"];
  className: string;
}) {
  const final = status === "running" && ms > 0 && ms <= FINAL_COUNTDOWN_MS;
  const lastMinute = status === "running" && ms <= 60_000;
  return (
    <div
      key={final ? Math.ceil(ms / 1000) : "clock"}
      className={`${className} whitespace-nowrap font-black leading-none tabular-nums transition-colors ${
        final
          ? "animate-tick text-red-500"
          : status === "paused"
            ? "text-slate-500"
            : lastMinute
              ? "text-amber-300"
              : ""
      }`}
    >
      {formatClock(ms)}
    </div>
  );
}

function BlindsLine({ level }: { level: { sb: number; bb: number; ante: number } }) {
  return (
    <>
      <span>{formatChips(level.sb)}</span>
      <span className="text-slate-600">/</span>
      <span>{formatChips(level.bb)}</span>
      {level.ante > 0 && (
        <>
          <span className="text-slate-600">/</span>
          <span>{formatChips(level.ante)}</span>
        </>
      )}
    </>
  );
}

export default function Home() {
  const { tournament, now, online, build, lanUrl } = useTournament();
  const [soundOn, setSoundOn] = useState(false);

  const view = tournament ? boardView(tournament, now) : null;
  const status = tournament?.status ?? "idle";
  const { autoSound, cursorHidden } = useTvMode({
    build,
    canReload: status !== "running" || view?.step?.kind === "break",
  });

  // Звуки: смена уровня, начало перерыва, «осталась минута», тиканье в конце
  const prevIndex = useRef<number | null>(null);
  const warned = useRef<string>("");
  const lastTick = useRef<string>("");
  useEffect(() => {
    if (!view || status !== "running") {
      prevIndex.current = view?.index ?? null;
      return;
    }
    if (prevIndex.current !== null && prevIndex.current !== view.index) {
      if (view.step?.kind === "break") playBreakStart();
      else playLevelChange();
    }
    prevIndex.current = view.index;

    const key = `${view.index}`;
    if (view.remainingMs <= 60_000 && view.remainingMs > 58_000 && warned.current !== key) {
      warned.current = key;
      playWarning();
    }

    if (view.remainingMs > 0 && view.remainingMs <= FINAL_COUNTDOWN_MS) {
      const sec = Math.ceil(view.remainingMs / 1000);
      const tickKey = `${view.index}:${sec}`;
      if (lastTick.current !== tickKey) {
        lastTick.current = tickKey;
        playTick(sec <= 3);
      }
    }
  }, [view, status]);

  const enableSound = (
    <button
      type="button"
      onClick={() => {
        setSoundOn(unlockAudio());
        // короткая проверка, что колонки работают
        setTimeout(playLevelChange, 150);
      }}
      className="rounded border border-white/10 px-2 py-1 tracking-[0.15em] text-slate-500 hover:text-slate-300"
    >
      ВКЛЮЧИТЬ ЗВУК
    </button>
  );

  const fullscreen = (
    <button
      type="button"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }}
      className="rounded border border-white/10 px-2 py-1 tracking-[0.15em] text-slate-500 hover:text-slate-300"
    >
      ⛶
    </button>
  );

  const footer = (
    <>
      {tournament?.tickerOn && tournament.ticker.trim() && <Ticker text={tournament.ticker} />}
      <footer className="flex items-center justify-between gap-4 pt-4 tv-xs tracking-[0.2em] text-slate-500">
        <span>
          ГОТО ПОКЕР
          {process.env.NEXT_PUBLIC_BUILD_LABEL && (
            <span className="ml-2 normal-case tracking-normal text-slate-600">· v{process.env.NEXT_PUBLIC_BUILD_LABEL}</span>
          )}
          {!online && <span className="ml-3 text-red-400">НЕТ СВЯЗИ С СЕРВЕРОМ</span>}
          {lanUrl && (status !== "running" || view?.step?.kind === "break") && (
            <span className="ml-4 normal-case tracking-normal text-slate-500">
              Админка с телефона (Wi-Fi клуба): <span className="font-bold text-slate-300">{lanUrl}/admin</span>
            </span>
          )}
        </span>
        <span className="flex items-center gap-4">
          {!soundOn && !autoSound && enableSound}
          {fullscreen}
          <span>ИГРАЙ. ДУМАЙ. ПОБЕЖДАЙ.</span>
        </span>
      </footer>
    </>
  );

  const isBreak = view?.step?.kind === "break";

  // Заставка BLINDS UP: первые секунды каждого уровня, пока идёт игра
  const blindsUp =
    view &&
    status === "running" &&
    view.step?.kind === "level" &&
    stepMs(view.step) - view.remainingMs < BLINDS_UP_MS;

  return (
    <main className={`min-h-screen overflow-x-hidden bg-[#080e15] text-white ${cursorHidden ? "cursor-none" : ""}`}>
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-35%] h-[70%] w-[70%] -translate-x-1/2 rounded-full bg-amber-400/[0.045] blur-[150px]" />
        <div className="absolute bottom-[-40%] right-[-10%] h-[70%] w-[50%] rounded-full bg-blue-500/[0.04] blur-[150px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1920px] flex-col lg:h-screen lg:overflow-hidden px-5 py-5 md:px-8 md:py-6 xl:px-10 xl:py-7">
        <Header name={tournament?.name} />

        {tournament && view && isBreak ? (
          <BreakScreen tournament={tournament} view={view} now={now} />
        ) : (
          <MainBoard
            tournament={tournament}
            view={view}
          />
        )}

        {footer}
      </div>

      {blindsUp && view?.activeLevel && (
        <BlindsUpOverlay
          key={view.index}
          levelNumber={view.levelNumber}
          level={view.activeLevel}
          firstLevel={view.levelNumber === 1}
        />
      )}
    </main>
  );
}

function Header({ name }: { name?: string }) {
  return (
    <header className="flex items-center justify-between border-b border-white/10 pb-4">
      <div className="flex items-center gap-3 xl:gap-4">
        <Image src={logo} alt="ГОТО ПОКЕР" priority className="h-12 w-auto xl:h-16" />

        <div>
          <h1 className="text-2xl font-black tracking-[0.13em] xl:text-3xl">
            ГОТО <span className="text-amber-300">ПОКЕР</span>
          </h1>

          <p className="tv-xs mt-1 tracking-[0.32em] text-slate-500">
            POKER CLUB · TOURNAMENT CONTROL
          </p>
        </div>
      </div>

      <div className="text-right">
        <p className="tv-xs uppercase tracking-[0.25em] text-slate-500">
          Текущий турнир
        </p>

        <p className="tv-lg mt-1 font-semibold text-slate-100">
          {name ?? "—"}
        </p>
      </div>
    </header>
  );
}

/** Строки «Ребай / Аддон» для панели информации */
function RebuyAddonStatus({ tournament, view }: { tournament: Tournament; view: BoardView }) {
  const s = tournament.structure;
  if (!s) return null;
  const rows: { label: string; open: boolean; text: string }[] = [];
  if (s.rebuyUntilLevel > 0)
    rows.push({ label: "Ребай", open: view.rebuyOpen, text: view.rebuyOpen ? `открыт · до ${s.rebuyUntilLevel} ур.` : "закрыт" });
  // суммы аддонов коротко: 30к / 60к
  const k = (n: number) => (n % 1000 === 0 ? `${n / 1000}к` : formatChips(n));
  const sums = s.addonStack > 0 ? ` · ${k(s.addonStack)}${s.doubleAddonStack > 0 ? ` / ${k(s.doubleAddonStack)}` : ""}` : "";
  if (s.addonUntilLevel > 0)
    rows.push({
      label: "Аддон",
      open: view.addonOpen,
      text: view.addonOpen ? `сейчас, на перерыве${sums}` : view.addonUpcoming ? `перерыв после ${s.addonUntilLevel} ур.${sums}` : "закрыт",
    });
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-white/[0.07] pt-4">
      {rows.map((r) => (
        <div key={r.label} className="tv-md flex items-center justify-between gap-2">
          <span className="text-slate-400">{r.label}</span>
          <span className={r.open ? "font-semibold text-emerald-300" : r.text === "закрыт" ? "text-slate-600" : "text-slate-400"}>
            {r.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function MainBoard({
  tournament,
  view,
}: {
  tournament: Tournament | null;
  view: BoardView | null;
}) {
  const status = tournament?.status ?? "idle";
  const level = view?.activeLevel;
  const next = view?.nextLevel;

  return (
    <div className="mt-5 grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[0.85fr_1.8fr_0.95fr] lg:grid-rows-[minmax(0,1fr)] xl:mt-6 xl:gap-6">
      {/* LEFT */}
      <div className="flex flex-col gap-4 xl:gap-5">
        <SideCard
          icon="◷"
          label="До перерыва"
          value={view?.msToBreak != null ? formatClock(view.msToBreak) : "—"}
          description={
            view?.msToBreak != null ? "До начала следующего перерыва" : "Перерывов больше нет"
          }
        />

        <SideCard
          icon="↗"
          label="Идёт турнир"
          value={formatClock(view?.elapsedMs ?? 0)}
          description="С начала игры"
        />

        {tournament?.combination && (
          <Panel className="flex min-h-0 flex-1 flex-col justify-center border-amber-300/15 bg-gradient-to-br from-amber-300/[0.07] to-[#101923] p-5 xl:p-6">
            <div className="flex items-center gap-3">
              <span className="tv-lg text-amber-300">♣</span>

              <span className="tv-sm font-bold uppercase tracking-[0.18em] text-slate-300">
                Комбинация дня
              </span>
            </div>

            <div className="mt-3 text-[clamp(1.5rem,2.5vw,3.5rem)] font-black uppercase leading-tight tracking-wide text-amber-300">
              {tournament.combination}
            </div>

            <div className="tv-sm mt-2 text-slate-400">
              Комбинация сегодняшнего дня
            </div>
          </Panel>
        )}
      </div>

      {/* CENTER */}
      <Panel className="relative flex min-w-0 flex-col items-center justify-center px-5 py-8 text-center md:px-8 xl:px-5 xl:py-10">
        {status !== "running" && tournament?.structure && (
          <div
            className={`absolute left-1/2 top-5 -translate-x-1/2 tv-sm rounded-full border px-4 py-1.5 font-bold tracking-[0.3em] ${
              status === "paused"
                ? "animate-pulse border-amber-300/40 bg-amber-300/10 text-amber-300"
                : "border-white/15 bg-white/[0.04] text-slate-400"
            }`}
          >
            {STATUS_LABEL[status]}
          </div>
        )}

        {!tournament?.structure ? (
          <div className="flex flex-col items-center text-slate-500">
            <Image src={logo} alt="" className="h-48 w-auto opacity-80" />
            <div className="mt-6 text-2xl font-bold text-slate-300">
              Структура турнира не загружена
            </div>
            <div className="mt-2 text-sm">Выберите пресет в админке</div>
          </div>
        ) : (
          <>
            <div className="tv-lg font-bold tracking-[0.35em] text-amber-300">
              УРОВЕНЬ {view?.levelNumber ?? 1}
            </div>

            <div className="tv-sm mt-2 uppercase tracking-[0.25em] text-slate-400">
              До конца уровня
            </div>

            <Countdown
              ms={view?.remainingMs ?? 0}
              status={status}
              className="mt-1 text-[clamp(5rem,11vw,13rem)] leading-none tracking-[-0.065em]"
            />

            {/* CURRENT BLINDS — главное после таймера: крупно и в золотой рамке */}
            {level && (
              <div className="mt-6 w-full rounded-2xl border border-amber-300/30 bg-amber-300/[0.07] px-3 pb-5 pt-3 shadow-[0_0_40px_rgba(252,211,77,0.08)] xl:mt-9 xl:px-4 xl:pb-6">
                <div className="tv-sm font-bold tracking-[0.3em] text-amber-300/90">
                  ТЕКУЩИЕ БЛАЙНДЫ
                </div>
                <div className={`mt-2 grid w-full gap-2 ${level.ante > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
                  <Blind label="МАЛЫЙ БЛАЙНД" value={formatChips(level.sb)} />

                  <Blind label="БОЛЬШОЙ БЛАЙНД" value={formatChips(level.bb)} />

                  {level.ante > 0 && <Blind label="АНТЕ" value={formatChips(level.ante)} />}
                </div>
              </div>
            )}

            <div className="my-6 h-px w-full bg-white/10 xl:my-7" />

            {/* NEXT LEVEL */}
            {next ? (
              <>
                <div className="tv-sm font-bold tracking-[0.3em] text-slate-400">
                  СЛЕДУЮЩИЕ БЛАЙНДЫ
                </div>

                <div className="mt-3 flex items-center justify-center gap-2 whitespace-nowrap text-[clamp(1.25rem,2.5vw,3.6rem)] font-bold leading-none md:gap-3">
                  <BlindsLine level={next} />
                </div>

                <div className="tv-xs mt-3 tracking-[0.2em] text-slate-500">
                  СЛЕДУЮЩИЙ УРОВЕНЬ · {view?.nextLevelNumber}
                </div>
              </>
            ) : (
              <div className="tv-sm font-bold tracking-[0.3em] text-slate-400">
                ПОСЛЕДНИЙ УРОВЕНЬ СТРУКТУРЫ
              </div>
            )}
          </>
        )}
      </Panel>

      {/* RIGHT */}
      <div className="flex min-h-0 min-w-0 flex-col gap-4 xl:gap-5">
        <Panel className="shrink-0 p-5 xl:p-6">
          <div className="tv-sm font-bold tracking-[0.25em] text-amber-300">
            ИНФОРМАЦИЯ ОБ ИГРЕ
          </div>

          <div className="mt-4 space-y-4">
            <Stat
              label="Игроков в игре"
              value={
                tournament && tournament.entries > 0
                  ? `${tournament.playersLeft} / ${tournament.entries}`
                  : String(tournament?.playersLeft ?? 0)
              }
            />

            <Stat
              label="Средний стек"
              value={view?.avgStack ? formatChips(view.avgStack) : "—"}
              hint={
                view?.avgStack && level
                  ? `${Math.round(view.avgStack / Math.max(1, level.bb))} ББ`
                  : undefined
              }
            />

            {tournament && view && <RebuyAddonStatus tournament={tournament} view={view} />}
          </div>
        </Panel>

        {/* РЕЙТИНГ: экраны по очереди (RATING.md, раздел 7) */}
        <Panel className="flex min-h-[18rem] flex-1 flex-col overflow-hidden p-5 lg:min-h-0 xl:p-6">
          <RatingRotator updatedAt={tournament?.updatedAt} bb={level?.bb} />
        </Panel>
      </div>
    </div>
  );
}

/** Экран перерыва: логотип, большой таймер, когда продолжим, что дальше */
function BreakScreen({
  tournament,
  view,
  now,
}: {
  tournament: Tournament;
  view: BoardView;
  now: number;
}) {
  const status = tournament.status;
  const note = view.step?.kind === "break" ? view.step.note : undefined;
  const resumeAt = new Date(now + view.remainingMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const s = tournament.structure;
  const level = view.activeLevel;
  // лидеры по фишкам — только если стеки посчитаны (обычно как раз на перерыве)
  const leaders = useBoardRating(tournament.updatedAt)?.chipLeaders ?? null;

  return (
    <div className="mt-5 flex flex-1 flex-col gap-5 xl:mt-6 xl:gap-6">
      <Panel className="relative flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-6 py-10 lg:flex-row lg:gap-16 xl:gap-24">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(252_211_77/0.08),transparent_60%)]" />

        <Image
          src={logo}
          alt="ГОТО ПОКЕР"
          priority
          className={`animate-breathe relative w-auto ${leaders ? "h-[clamp(9rem,24vh,20rem)]" : "h-[clamp(14rem,38vh,30rem)]"}`}
        />

        <div className="relative flex flex-col items-center text-center lg:items-start lg:text-left">
          <div className="tv-lg font-bold tracking-[0.5em] text-amber-300">
            ☕ ПЕРЕРЫВ
          </div>

          {note && (
            <div className="mt-3 text-[clamp(1.1rem,2vw,3rem)] font-semibold leading-tight text-slate-200">{note}</div>
          )}

          <Countdown
            ms={view.remainingMs}
            status={status}
            className="mt-4 text-[clamp(6rem,13vw,13rem)] tracking-[-0.06em]"
          />

          <div className="tv-lg mt-4 text-slate-400">
            {status === "paused" ? (
              <span className="text-amber-300">Перерыв на паузе</span>
            ) : (
              <>
                Игра продолжится в{" "}
                <span className="font-bold text-white tabular-nums">{resumeAt}</span>
              </>
            )}
          </div>
        </div>

        {leaders && (
          <div className="relative flex w-full max-w-[34rem] flex-col self-stretch lg:w-[30%] lg:self-center">
            <div className="tv-sm mb-2 flex items-baseline justify-between gap-2">
              <span className="font-bold tracking-[0.25em] text-amber-300">ЛИДЕРЫ ПО ФИШКАМ</span>
              <span className="tv-xs text-slate-500">{countedLabel(leaders)}</span>
            </div>
            <ChipLeaders leaders={leaders} bb={level?.bb} size="break" />
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 xl:gap-6">
        <Panel className="p-5 xl:p-6">
          <div className="tv-sm font-bold tracking-[0.25em] text-slate-400">
            ПОСЛЕ ПЕРЕРЫВА · УРОВЕНЬ {view.levelNumber}
          </div>
          {level ? (
            <div className="mt-3 flex items-center gap-2 whitespace-nowrap text-[clamp(1.8rem,2.8vw,4rem)] font-black leading-none tabular-nums">
              <BlindsLine level={level} />
            </div>
          ) : (
            <div className="mt-4 text-slate-500">—</div>
          )}
          {level && (
            <div className="tv-sm mt-3 text-slate-400">
              МБ / ББ{level.ante > 0 ? " / анте" : ""} · {Math.round(stepMs(level) / 60000)} мин
            </div>
          )}
        </Panel>

        <Panel className="p-5 xl:p-6">
          <div className="tv-sm font-bold tracking-[0.25em] text-slate-400">
            ИГРА
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat
              label="Игроков"
              value={
                tournament.entries > 0
                  ? `${tournament.playersLeft} / ${tournament.entries}`
                  : String(tournament.playersLeft)
              }
            />
            <Stat
              label="Средний стек"
              value={view.avgStack ? formatChips(view.avgStack) : "—"}
              hint={
                view.avgStack && level
                  ? `${Math.round(view.avgStack / Math.max(1, level.bb))} ББ`
                  : undefined
              }
            />
          </div>
        </Panel>

        <Panel
          className={`p-5 xl:p-6 ${
            view.addonOpen ? "border-emerald-400/30 bg-gradient-to-br from-emerald-400/[0.08] to-[#101923]" : ""
          }`}
        >
          <div className="tv-sm font-bold tracking-[0.25em] text-slate-400">
            РЕБАЙ И АДДОН
          </div>
          {s && (view.addonOpen || view.rebuyOpen) ? (
            <div className="mt-4 space-y-2">
              {view.addonOpen && (
                <>
                  <div className="text-[clamp(1.25rem,2vw,3rem)] font-black leading-tight text-emerald-300">АДДОН ДОСТУПЕН</div>
                  <div className="tv-md text-slate-300 tabular-nums">
                    Аддон {formatChips(s.addonStack)} · двойной {formatChips(s.doubleAddonStack)}
                  </div>
                </>
              )}
              {view.rebuyOpen && (
                <div className="tv-md text-slate-300 tabular-nums">
                  Ребай {formatChips(s.rebuyStack)} — открыт до конца {s.rebuyUntilLevel} ур.
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 text-[clamp(1.25rem,2vw,3rem)] font-bold text-slate-600">Закрыты</div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Полноэкранная заставка при повышении блайндов */
function BlindsUpOverlay({
  levelNumber,
  level,
  firstLevel,
}: {
  levelNumber: number;
  level: { sb: number; bb: number; ante: number };
  firstLevel: boolean;
}) {
  return (
    <div className="animate-blinds-in pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#05090e]/95 text-center backdrop-blur-sm">
      <div className="animate-blinds-flash absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(252_211_77/0.45),transparent_65%)]" />

      <Image src={logo} alt="" className="relative h-[18vh] w-auto opacity-90" />

      <div className="animate-blinds-pop text-shine relative mt-6 text-[clamp(3rem,8vw,9rem)] font-black leading-none">
        {firstLevel ? "SHUFFLE UP" : "BLINDS UP"}
      </div>

      <div className="animate-blinds-rise relative mt-8">
        <div className="text-sm font-bold tracking-[0.5em] text-slate-400 xl:text-lg">
          УРОВЕНЬ {levelNumber}
        </div>
        <div className="mt-4 flex items-center justify-center gap-4 whitespace-nowrap text-[clamp(3rem,7vw,8rem)] font-black leading-none tabular-nums tracking-tight">
          <span>{formatChips(level.sb)}</span>
          <span className="text-amber-300/60">/</span>
          <span>{formatChips(level.bb)}</span>
        </div>
        {level.ante > 0 && (
          <div className="mt-5 text-2xl font-bold text-amber-300 tabular-nums xl:text-4xl">
            АНТЕ {formatChips(level.ante)}
          </div>
        )}
      </div>
    </div>
  );
}

function Ticker({ text }: { text: string }) {
  // Скорость ~ постоянная независимо от длины текста
  const duration = Math.max(12, text.length * 0.22);
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-amber-300/15 bg-amber-300/[0.05] py-2.5">
      <div
        className="animate-marquee inline-block whitespace-nowrap pl-[100%] tv-lg font-semibold tracking-wide text-amber-100"
        style={{ animationDuration: `${duration}s` }}
      >
        {text}
      </div>
    </div>
  );
}

function Blind({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 text-center">
      <div className="tv-sm flex min-h-8 items-center justify-center font-bold tracking-[0.08em] text-slate-300">
        {label}
      </div>

      {/* размер растёт с экраном; длинные числа (100 000) чуть мельче, чтобы влезли в колонку */}
      <div
        className={`mt-1 whitespace-nowrap font-black tabular-nums leading-none tracking-tight text-amber-200 ${
          value.length > 6 ? "text-[clamp(1.9rem,3.2vw,4.6rem)]" : "text-[clamp(2.4rem,4.1vw,6rem)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="tv-md text-slate-400">{label}</div>

      <div className="mt-1 flex items-baseline gap-2 text-[clamp(1.5rem,2.4vw,3.4rem)] font-bold leading-tight tabular-nums">
        {value}
        {hint && <span className="tv-md font-semibold text-slate-400">{hint}</span>}
      </div>
    </div>
  );
}
