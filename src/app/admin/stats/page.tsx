"use client";

// Статистика клуба (docs/STATS.md): деньги, турниры и игроки, новые игроки, топы, дни недели —
// за месяц, год или всё время.

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { OwnerGate } from "@/components/admin/Owner";
import { Card } from "@/components/admin/ui";
import { formatRub, PAY_METHOD_LABEL, PAY_METHODS } from "@/lib/cash";
import { periodLabel, WEEKDAYS, type BreakdownRow, type StatsSummary, type TopRow } from "@/lib/stats";

export default function StatsPage() {
  return (
    <AdminShell>
      {/* только владельцу: пароль владельца (docs/STATS.md) */}
      <OwnerGate>{(relock) => <Stats onLocked={relock} />}</OwnerGate>
    </AdminShell>
  );
}

type Tab = "month" | "year" | "all";
type Response = { period: string; summary: StatsSummary; breakdown: BreakdownRow[]; months: string[]; years: string[] };

const TABS: { id: Tab; label: string }[] = [
  { id: "month", label: "Месяцы" },
  { id: "year", label: "Годы" },
  { id: "all", label: "За всё время" },
];

const num = (n: number) => String(n).replace(".", ",");

function Stats({ onLocked }: { onLocked: () => void }) {
  const [tab, setTab] = useState<Tab>("month");
  /** Выбранный месяц / год; пусто — самый свежий */
  const [key, setKey] = useState("");
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");

  const period = tab === "all" ? "all" : key;

  useEffect(() => {
    let alive = true;
    (async () => {
      // первым запросом узнаём, какие месяцы и годы есть
      const res = await fetch(`/api/stats?period=${encodeURIComponent(period || "all")}`, { cache: "no-store" });
      const d = await res.json();
      if (!alive) return;
      if (res.status === 403) return onLocked(); // вход владельца истёк
      if (!res.ok) return setError(d.error ?? "Не удалось загрузить статистику");
      setError("");
      if (!period && tab !== "all") {
        const first = (tab === "month" ? d.months : d.years)[0];
        if (first) return setKey(first);
      }
      setData(d);
    })();
    return () => {
      alive = false;
    };
  }, [period, tab, onLocked]);

  const options = tab === "month" ? (data?.months ?? []) : tab === "year" ? (data?.years ?? []) : [];
  const s = data && data.period === (period || "all") ? data.summary : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto whitespace-nowrap rounded-xl bg-white/[0.03] p-1 [scrollbar-width:none]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setKey("");
              }}
              className={`rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-amber-300 font-bold text-[#080e15]" : "text-slate-400 hover:text-slate-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "all" && options.length > 0 && (
          <select
            className="rounded-lg border border-white/10 bg-[#0b131c] px-3 py-2 text-sm text-slate-100"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          >
            {options.map((k) => (
              <option key={k} value={k}>
                {periodLabel(k)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="text-sm text-red-300">{error}</div>}
      {!s && !error && <div className="py-20 text-center text-slate-500">Загрузка…</div>}
      {s && data && (
        <>
          <MoneyCard s={s} />
          <PlayersCard s={s} />
          {data.breakdown.length > 0 && <BreakdownCard rows={data.breakdown} byYears={tab === "all"} />}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            <TopCard title="Самые частые" rows={s.topByTournaments} format={(v) => `${v} турн.`} />
            <TopCard title="Больше всех принесли" rows={s.topByMoney} format={formatRub} />
          </div>
          <WeekdaysCard s={s} />
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "sky" | "gold" }) {
  const color = tone === "red" ? "text-red-300" : tone === "sky" ? "text-sky-300" : tone === "gold" ? "text-amber-200" : "";
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2">
      <div className={`text-xl font-black tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function MoneyCard({ s }: { s: StatsSummary }) {
  const methods = PAY_METHODS.filter((m) => s.byMethod[m] > 0)
    .map((m) => `${PAY_METHOD_LABEL[m].toLowerCase()} ${formatRub(s.byMethod[m])}`)
    .join(" · ");
  return (
    <Card title="Деньги">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <div className="col-span-2 md:col-span-1">
          <Tile label="Собрано" value={formatRub(s.paid)} sub={methods || undefined} tone="gold" />
        </div>
        <Tile label="Долги" value={formatRub(s.debt)} tone={s.debt > 0 ? "red" : undefined} />
        <Tile label="Бесплатно" value={formatRub(s.free)} tone={s.free > 0 ? "sky" : undefined} />
      </div>
      <div className="mt-2 text-xs text-slate-500">
        Собрано — по дню оплаты. Долги и бесплатно — за турниры этого периода. До появления кассы деньги не записывались.
      </div>
    </Card>
  );
}

function PlayersCard({ s }: { s: StatsSummary }) {
  return (
    <Card title="Турниры и игроки">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Турниров" value={String(s.tournaments)} />
        <Tile label="Разных игроков" value={String(s.players)} />
        <Tile label="В среднем на турнир" value={num(s.avgPlayers)} />
        <Tile label="Новых игроков" value={String(s.newPlayers)} />
        <Tile label="Входов" value={String(s.entries)} />
        <Tile label="Re-entry" value={String(s.reentries)} />
        <Tile label="Аддонов" value={String(s.addons)} />
        <Tile label="Двойных аддонов" value={String(s.doubleAddons)} />
      </div>
      <div className="mt-2 text-xs text-slate-500">
        Только завершённые турниры. Турниры «Вручную» — по счётчикам, разных игроков в них не посчитать.
      </div>
    </Card>
  );
}

/** Полоска для сравнения: доля от максимума */
function Bar({ value, max, tone = "bg-amber-300/70" }: { value: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-white/[0.05]">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function BreakdownCard({ rows, byYears }: { rows: BreakdownRow[]; byYears: boolean }) {
  const maxPaid = Math.max(...rows.map((r) => r.paid));
  const maxPlayers = Math.max(...rows.map((r) => r.entries));
  return (
    <Card title={byYears ? "По годам" : "По месяцам"}>
      <div className="divide-y divide-white/[0.06]">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="row-span-2 text-sm font-semibold sm:row-span-1">{byYears ? r.key : r.label.split(" ")[0]}</div>
            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">собрано</span>
                <span className="font-semibold tabular-nums text-amber-200">{formatRub(r.paid)}</span>
              </div>
              <Bar value={r.paid} max={maxPaid} />
            </div>
            <div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">
                  {r.tournaments} турн. · {r.players} игр. · новых {r.newPlayers}
                </span>
                <span className="tabular-nums text-slate-300">{r.entries} вх.</span>
              </div>
              <Bar value={r.entries} max={maxPlayers} tone="bg-sky-400/60" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TopCard({ title, rows, format }: { title: string; rows: TopRow[]; format: (v: number) => string }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500">Пока нет данных</div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {rows.map((r, i) => (
            <div key={r.playerId} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-5 text-right font-bold tabular-nums text-slate-500">{i + 1}</span>
              <Link href={`/admin/players/${r.playerId}`} className="min-w-0 flex-1 truncate font-semibold hover:text-amber-200">
                {r.name}
              </Link>
              <span className="shrink-0 tabular-nums text-slate-300">{format(r.value)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WeekdaysCard({ s }: { s: StatsSummary }) {
  const maxPlayers = Math.max(...s.weekdays.map((d) => d.avgPlayers));
  return (
    <Card title="По дням недели">
      <div className="divide-y divide-white/[0.06]">
        {s.weekdays.map((d) => (
          <div key={d.weekday} className={`grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 py-2 ${d.tournaments ? "" : "opacity-40"}`}>
            <div className="text-sm font-bold">{WEEKDAYS[d.weekday]}</div>
            <div>
              <div className="flex flex-wrap justify-between gap-x-3 text-xs">
                <span className="text-slate-400">
                  {d.tournaments ? `${d.tournaments} турн. · в среднем ${num(d.avgPlayers)} игр.` : "турниров не было"}
                </span>
                {d.tournaments > 0 && <span className="tabular-nums text-amber-200">{formatRub(d.avgPaid)} за турнир</span>}
              </div>
              <Bar value={d.avgPlayers} max={maxPlayers} tone="bg-sky-400/60" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
