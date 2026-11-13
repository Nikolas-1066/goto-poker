"use client";

// Страницы сайта клуба (docs/SITE.md, шаг 2): главная, расписание (с идущим и прошедшими турнирами), рейтинг, игрок, о клубе.

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import logo from "@/assets/logo.png";
import { playersWord, type SiteArchive, type SiteFacts, type SitePlayer, type SiteRating } from "@/lib/site";
import { AboutBlock } from "./AboutBlock";
import { Avatar } from "./Avatar";
import { LivePanel, useLive } from "./LivePanel";
import { PlayerStats } from "./PlayerStats";
import { Podium, RatingTable } from "./RatingTable";
import { ResultsList } from "./ResultsList";
import { ScheduleList } from "./ScheduleList";
import { GOLD, Muted, OUTLINE, PageTitle, Panel, PlayerLink, SiteShell, useSite } from "./SiteShell";

const More = ({ href, children }: { href: string; children: string }) => (
  <Link href={href} className="text-sm text-slate-400 hover:text-amber-200">
    {children} →
  </Link>
);

// ---------- Главная ----------

const SectionHead = ({ title, href, more }: { title: string; href: string; more: string }) => (
  <div className="mb-4 flex items-end justify-between gap-3">
    <h2 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h2>
    <More href={href}>{more}</More>
  </div>
);

export function HomePage() {
  const { data: rating } = useSite<SiteRating>("rating");
  const { data: facts } = useSite<SiteFacts>("facts");
  const live = useLive();
  const month = rating?.open[0];
  const table = month?.rows.length ? month.rows : (rating?.all ?? []);
  const tiles = [
    { big: "На очки", small: "Спортивный покер: без ставок на деньги, только рейтинг" },
    facts && facts.players > 0 && { big: String(facts.players), small: `${playersWord(facts.players).replace(/^\d+ /, "")} уже сыграли в клубе` },
    facts && facts.tournaments > 0 && { big: String(facts.tournaments), small: "турниров сыграно — итоги каждого на сайте" },
    facts?.finalistsN ? { big: `Топ-${facts.finalistsN}`, small: "лучшие по рейтингу месяца играют финал" } : { big: "Финал", small: "лучшие по рейтингу месяца играют финал" },
  ].filter((x): x is { big: string; small: string } => !!x);

  return (
    <SiteShell>
      <section className="flex flex-col items-center px-2 pb-8 pt-6 text-center sm:pb-12 sm:pt-12">
        <Image src={logo} alt="" className="h-24 w-auto drop-shadow-[0_0_40px_rgba(252,211,77,0.25)] sm:h-32" priority />
        <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
          Покер как спорт.
          <br />
          <span className="bg-gradient-to-b from-amber-100 via-amber-300 to-amber-500 bg-clip-text text-transparent">ГОТО ПОКЕР</span>
        </h1>
        <p className="mt-4 max-w-xl text-base text-slate-300 sm:text-lg">
          Клуб спортивного покера в Воронеже. Живые турниры, рейтинг игроков и финал месяца для сильнейших.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/schedule" className={`rounded-xl px-6 py-3 text-base ${GOLD}`}>
            Расписание игр
          </Link>
          <Link href="/rating" className={`rounded-xl px-6 py-3 text-base ${OUTLINE}`}>
            Рейтинг
          </Link>
        </div>
      </section>

      <section className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] lg:grid-cols-4 sm:mb-14">
        {tiles.map((t) => (
          <div key={t.small} className="bg-[#0f1822] px-3 py-6 text-center sm:px-6 sm:py-8">
            <div className="bg-gradient-to-b from-amber-100 to-amber-400 bg-clip-text text-3xl font-black tabular-nums text-transparent sm:text-4xl">{t.big}</div>
            <div className="mx-auto mt-2 max-w-[14rem] text-xs text-slate-400 sm:text-sm">{t.small}</div>
          </div>
        ))}
      </section>

      {live && (
        <section className="mb-10 sm:mb-14">
          <LivePanel live={live} />
        </section>
      )}

      <section className="mb-10 sm:mb-14">
        <SectionHead title="Ближайшие турниры" href="/schedule" more="Всё расписание" />
        <ScheduleList limit={3} hideStarted={!!live} />
      </section>

      <section className="mb-10 grid gap-8 lg:grid-cols-2 sm:mb-14">
        <div>
          <SectionHead title={month?.rows.length ? `Рейтинг · ${month.label.replace(/^Месяц · /, "")}` : "Рейтинг"} href="/rating" more="Весь рейтинг" />
          <Panel>{rating ? <RatingTable rows={table} limit={5} /> : <Muted>Загрузка…</Muted>}</Panel>
        </div>
        <div>
          <SectionHead title="Последние турниры" href="/schedule" more="Все прошедшие" />
          <ResultsList limit={2} />
        </div>
      </section>

      <section className="mb-10 sm:mb-14">
        <h2 className="text-center text-2xl font-black tracking-tight sm:text-3xl">Как устроена игра</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: "♠", title: "Турниры", text: "Приходите на турнир, получаете стартовый стек и играете до победителя. Чем выше место — тем больше очков." },
            { icon: "★", title: "Рейтинг и финал", text: "Очки за турниры складываются в рейтинг месяца. Лучшие по итогам месяца выходят в финал." },
            { icon: "◆", title: "Нокауты и ELO", text: "Считаем, кто кого выбил, и ведём ELO — рейтинг силы. Всё видно на странице каждого игрока." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-white/[0.08] bg-[#0f1822]/90 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-2xl text-amber-300">{f.icon}</div>
              <h3 className="mt-4 text-sm font-black uppercase tracking-[0.15em]">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mb-10 sm:mb-14">
        <AboutBlock brief />
      </div>

      <section className="rounded-2xl border border-amber-300/25 bg-gradient-to-b from-amber-300/[0.10] to-transparent px-4 py-10 text-center">
        <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Сыграем?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-300 sm:text-base">Выберите турнир в расписании и приходите. Новичкам всё объясним на месте.</p>
        <Link href="/schedule" className={`mt-5 inline-block rounded-xl px-6 py-3 ${GOLD}`}>
          Выбрать турнир
        </Link>
      </section>
    </SiteShell>
  );
}

// ---------- Расписание ----------

export function SchedulePage() {
  const live = useLive();
  return (
    <SiteShell>
      <PageTitle sub="Время — воронежское. Приходите за 15–20 минут до начала.">Расписание турниров</PageTitle>
      {live && (
        <div className="mb-6">
          <LivePanel live={live} />
        </div>
      )}
      <ScheduleList hideStarted={!!live} />
      <h2 className="mb-4 mt-10 text-2xl font-black tracking-tight sm:text-3xl">Прошедшие турниры</h2>
      <ResultsList limit={10} step={10} wide />
    </SiteShell>
  );
}

// ---------- Рейтинг ----------

export function RatingPage() {
  const { data, error, loading } = useSite<SiteRating>("rating");
  /** Вкладка: "p<id>" — идущий период, "all", "elo", "archive" */
  const [picked, setPicked] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<number | null>(null);

  const tabs = data
    ? [
        ...data.open.map((p) => ({ key: `p${p.id}`, label: p.label.replace(/^Месяц · /, "") })),
        { key: "all", label: "За всё время" },
        { key: "elo", label: "ELO" },
        ...(data.archive.length ? [{ key: "archive", label: "Архив" }] : []),
      ]
    : [];
  const tab = picked && tabs.some((t) => t.key === picked) ? picked : tabs[0]?.key;
  const open = data?.open.find((p) => `p${p.id}` === tab);
  const shownArchive = archiveId ?? data?.archive[0]?.id ?? null;

  return (
    <SiteShell>
      <PageTitle sub="Очки начисляются за место в турнире. Лучшие по итогам месяца играют финал.">Рейтинг клуба</PageTitle>
      {loading && <Muted>Загрузка…</Muted>}
      {!loading && !data && <Muted>{error || "Рейтинг скоро появится"}</Muted>}
      {data && (
        <>
          <div className="mb-3 flex gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPicked(t.key)}
                className={`rounded-lg px-4 py-2 text-sm ${t.key === tab ? GOLD : "border border-white/10 bg-white/[0.04] font-semibold text-slate-300 hover:bg-white/[0.08]"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {open && <Podium rows={open.rows} />}
          {tab === "all" && <Podium rows={data.all} />}
          <Panel>
            {open && <RatingTable rows={open.rows} zone={open.finalistsN} empty="В этом периоде турниров ещё не было." />}
            {tab === "all" && <RatingTable rows={data.all} />}
            {tab === "elo" && <EloTable rows={data.elo} />}
            {tab === "archive" && shownArchive != null && (
              <>
                <select
                  className="mb-3 w-full rounded-lg border border-white/10 bg-[#0b131c] px-3 py-2 text-base text-slate-100 outline-none focus:border-amber-300/60 sm:w-auto sm:text-sm"
                  value={shownArchive}
                  onChange={(e) => setArchiveId(Number(e.target.value))}
                >
                  {data.archive.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <ArchiveView id={shownArchive} />
              </>
            )}
          </Panel>
        </>
      )}
    </SiteShell>
  );
}

function EloTable({ rows }: { rows: SiteRating["elo"] }) {
  if (!rows.length) return <Muted>ELO появится после первых сыгранных турниров.</Muted>;
  return (
    <>
      <p className="mb-2 text-sm text-slate-400">ELO — рейтинг силы игрока. Старт — 1000; растёт, когда занимаешь места выше соперников. На финалы не влияет.</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.15em] text-slate-500">
            <th className="w-10 px-1 py-2 font-semibold">#</th>
            <th className="px-1 py-2 font-semibold">Игрок</th>
            <th className="px-1 py-2 text-right font-semibold">ELO</th>
            <th className="px-1 py-2 text-right font-semibold">Турн.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} className="border-t border-white/[0.06]">
              <td className="px-1 py-2.5 font-bold tabular-nums text-slate-500">{r.rank}</td>
              <td className="max-w-0 truncate px-1 py-2.5 font-semibold">
                <PlayerLink id={r.playerId} name={r.name} />
              </td>
              <td className="px-1 py-2.5 text-right font-bold tabular-nums text-amber-200">{r.elo}</td>
              <td className="px-1 py-2.5 text-right tabular-nums text-slate-400">{r.games}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ArchiveView({ id }: { id: number }) {
  const { data, error, loading } = useSite<SiteArchive>(`archive&id=${id}`);
  if (loading) return <Muted>Загрузка…</Muted>;
  if (!data) return <Muted>{error || "Не удалось загрузить"}</Muted>;
  return (
    <>
      {data.finalists.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300/30 bg-amber-300/[0.06] p-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">Финалисты</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {data.finalists.map((f) => (
              <span key={f.playerId}>
                <PlayerLink id={f.playerId} name={f.name} className="font-semibold" />
                {f.wildcard && <span className="ml-1 text-xs text-slate-400">(приглашён)</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      <RatingTable rows={data.rows} zone={data.finalistsN} />
    </>
  );
}

// ---------- Игрок ----------

export function PlayerPage({ id }: { id: number }) {
  const { data: p, error, loading } = useSite<SitePlayer>(Number.isInteger(id) && id > 0 ? `player&id=${id}` : null);
  return (
    <SiteShell>
      {loading && <Muted>Загрузка…</Muted>}
      {!loading && !p && <Muted>{error || "Игрок не найден"}</Muted>}
      {p && (
        <>
          <div className="mb-4 flex items-center gap-4 sm:mb-6">
            <Avatar id={p.id} name={p.name} className="h-16 w-16 border-2 border-amber-300/70 text-3xl text-amber-200 sm:h-20 sm:w-20" />
            <div className="min-w-0">
              <h1 className="truncate text-3xl font-black tracking-tight sm:text-4xl">{p.name}</h1>
              {p.finals.length > 0 && <p className="mt-1 text-sm text-slate-400">Финалист: {p.finals.join(", ")}</p>}
            </div>
          </div>
          <PlayerStats p={p} />
        </>
      )}
    </SiteShell>
  );
}

// ---------- О клубе ----------

export function AboutPage() {
  return (
    <SiteShell>
      <PageTitle>О клубе</PageTitle>
      <AboutBlock />
    </SiteShell>
  );
}
