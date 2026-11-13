"use client";

// Страницы сайта клуба (docs/SITE.md, шаг 2): главная, расписание, рейтинг, итоги, игрок, о клубе.

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import logo from "@/assets/logo.png";
import { formatSiteDate, type SiteArchive, type SitePlayer, type SiteRating } from "@/lib/site";
import { AboutBlock } from "./AboutBlock";
import { RatingTable } from "./RatingTable";
import { ResultsList } from "./ResultsList";
import { ScheduleList } from "./ScheduleList";
import { formatKo, Muted, PageTitle, Panel, PlayerLink, SiteShell, useSite } from "./SiteShell";

const More = ({ href, children }: { href: string; children: string }) => (
  <Link href={href} className="text-sm text-slate-400 hover:text-amber-200">
    {children} →
  </Link>
);

// ---------- Главная ----------

export function HomePage() {
  const { data: rating } = useSite<SiteRating>("rating");
  const month = rating?.open[0];
  return (
    <SiteShell>
      <div className="mb-5 flex flex-col items-center gap-3 rounded-2xl border border-white/[0.09] bg-gradient-to-b from-amber-300/[0.07] to-transparent px-4 py-8 text-center sm:mb-8 sm:py-12">
        <Image src={logo} alt="" className="h-20 w-auto sm:h-28" priority />
        <h1 className="text-3xl font-black tracking-[0.1em] sm:text-5xl">
          ГОТО <span className="text-amber-300">ПОКЕР</span>
        </h1>
        <p className="max-w-md text-sm text-slate-300 sm:text-base">Клуб спортивного покера в Воронеже. Турниры, рейтинг и финалы — играем на очки, не на деньги.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Ближайшие турниры" action={<More href="/schedule">Всё расписание</More>}>
          <ScheduleList limit={3} />
        </Panel>
        <Panel title={month ? `Рейтинг · ${month.label.replace(/^Месяц · /, "")}` : "Рейтинг"} action={<More href="/rating">Весь рейтинг</More>}>
          {rating ? <RatingTable rows={month?.rows ?? rating.all} limit={5} /> : <Muted>Загрузка…</Muted>}
        </Panel>
        <Panel title="Последние турниры" action={<More href="/results">Все итоги</More>}>
          <ResultsList limit={2} />
        </Panel>
        <AboutBlock brief />
      </div>
    </SiteShell>
  );
}

// ---------- Расписание ----------

export function SchedulePage() {
  return (
    <SiteShell>
      <PageTitle sub="Время — воронежское. Приходите за 15–20 минут до начала.">Расписание турниров</PageTitle>
      <Panel>
        <ScheduleList />
      </Panel>
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
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  t.key === tab ? "bg-amber-300 text-[#080e15]" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
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

// ---------- Итоги ----------

export function ResultsPage() {
  return (
    <SiteShell>
      <PageTitle sub="Победители и призёры прошедших турниров.">Итоги турниров</PageTitle>
      <Panel>
        <ResultsList />
      </Panel>
    </SiteShell>
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
          <PageTitle sub={p.finals.length ? `Финалист: ${p.finals.join(", ")}` : undefined}>{p.name}</PageTitle>
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[
              ["Очки", p.stats.points.toLocaleString("ru-RU")],
              ["Турниры", p.stats.tournaments],
              ["Победы", p.stats.wins],
              ["Топ-3", p.stats.top3],
              ["Нокауты", formatKo(p.stats.ko)],
              ["ELO", p.eloGames > 0 ? p.elo : "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/[0.09] bg-[#101923]/90 px-2 py-3 text-center">
                <div className="text-xl font-black tabular-nums text-amber-200 sm:text-2xl">{value}</div>
                <div className="mt-0.5 text-[11px] uppercase tracking-[0.15em] text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Panel title="Место в рейтинге" className="self-start">
              <div className="divide-y divide-white/[0.06]">
                {p.ratings.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-slate-300">{r.label}</span>
                    <span className="text-right">
                      {r.rank != null ? (
                        <>
                          <b className="text-amber-200">{r.rank}</b> <span className="text-slate-500">из {r.of}</span>
                          <span className="ml-2 tabular-nums text-slate-300">{r.points.toLocaleString("ru-RU")} оч.</span>
                        </>
                      ) : (
                        <span className="text-slate-500">ещё не играл</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Турниры">
              {p.tournaments.length === 0 ? (
                <Muted>Сыгранных турниров пока нет.</Muted>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {p.tournaments.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <div className="w-14 shrink-0 text-center">
                        <div className="text-lg font-black tabular-nums leading-tight">{t.place}</div>
                        <div className="text-[11px] text-slate-500">из {t.field}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">
                          {t.name}
                          {t.kindLabel && <span className="ml-2 text-xs font-bold text-amber-300">{t.kindLabel}</span>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatSiteDate(t.at)}
                          {t.ko > 0 && ` · KO ${formatKo(t.ko)}`}
                        </div>
                      </div>
                      <div className="shrink-0 text-right font-bold tabular-nums text-amber-200">{t.points != null ? `+${t.points}` : "—"}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
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
