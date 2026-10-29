"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button, Card, Field, inputClass } from "@/components/admin/ui";
import {
  KIND_LABEL,
  placesPreview,
  pointsBreakdown,
  sanitizeRules,
  type RatingRules,
  type TournamentKind,
} from "@/lib/rating/points";
import type { PeriodView, Period, StandingRow } from "@/lib/db/periods";
import type { ClubSettings, PeriodKind } from "@/lib/db/settings";
import type { Player } from "@/lib/players";

export default function RatingPage() {
  return (
    <AdminShell>
      <Rating />
    </AdminShell>
  );
}

/** Черновик правил в полях ввода: всё строками, чтобы можно было стереть и набрать заново */
type Draft = {
  placePoints: string[];
  upperHalfPoints: string;
  lowerHalfPoints: string;
  fieldBase: string;
  koPoints: string;
  reentryPenalty: string;
  minPoints: string;
  statusCoef: Record<TournamentKind, string>;
  elo: { start: string; k: string; newbieK: string; newbieGames: string };
};

const str = (n: number) => String(n).replace(".", ",");
const toDraft = (r: RatingRules): Draft => ({
  placePoints: r.placePoints.map(str),
  upperHalfPoints: str(r.upperHalfPoints),
  lowerHalfPoints: str(r.lowerHalfPoints),
  fieldBase: str(r.fieldBase),
  koPoints: str(r.koPoints),
  reentryPenalty: str(r.reentryPenalty),
  minPoints: str(r.minPoints),
  statusCoef: {
    regular: str(r.statusCoef.regular),
    month_final: str(r.statusCoef.month_final),
    season_final: str(r.statusCoef.season_final),
    year_final: str(r.statusCoef.year_final),
  },
  elo: { start: str(r.elo.start), k: str(r.elo.k), newbieK: str(r.elo.newbieK), newbieGames: str(r.elo.newbieGames) },
});

/** Правила из черновика (или ошибка, если что-то введено неверно) */
function fromDraft(d: Draft): { rules: RatingRules | null; error: string } {
  try {
    return { rules: sanitizeRules(d), error: "" };
  } catch (e) {
    return { rules: null, error: e instanceof Error ? e.message : "Ошибка" };
  }
}

function RulesTab() {
  const [saved, setSaved] = useState<{ id: number; rules: RatingRules } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/rating/rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.version) return setMessage({ ok: false, text: d.error ?? "Не удалось загрузить правила" });
        setSaved(d.version);
        setDraft(toDraft(d.version.rules));
      })
      .catch(() => setMessage({ ok: false, text: "Нет связи с сервером" }));
  }, []);

  const parsed = useMemo(() => (draft ? fromDraft(draft) : { rules: null, error: "" }), [draft]);
  const dirty = !!saved && !!parsed.rules && JSON.stringify(parsed.rules) !== JSON.stringify(saved.rules);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/rating/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: draft }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setMessage({ ok: false, text: data.error ?? "Не удалось сохранить" });
    setSaved(data.version);
    setDraft(toDraft(data.version.rules));
    setMessage({
      ok: true,
      text: data.changed
        ? `Сохранено — версия правил № ${data.version.id}. Уже посчитанные турниры не меняются, пока не нажата «Пересчитать».`
        : "Ничего не изменилось",
    });
  }

  if (!draft || !saved) {
    return (
      <div className="py-20 text-center text-slate-500">{message?.text ?? "Загрузка…"}</div>
    );
  }

  const set = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setMessage(null);
  };
  const input = (value: string, onChange: (v: string) => void, label: string) => (
    <input
      className={`${inputClass} text-center`}
      inputMode="decimal"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ""))}
    />
  );

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Card title={`Правила начисления очков · версия ${saved.id}`}>
        <div className="space-y-5">
          <section>
            <div className="mb-2 text-sm font-semibold">Баллы за места</div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
              {draft.placePoints.map((v, i) => (
                <label key={i} className="block text-center">
                  <span className="mb-1 block text-[11px] text-slate-500">{i + 1} место</span>
                  {input(v, (x) => set({ placePoints: draft.placePoints.map((p, j) => (j === i ? x : p)) }), `${i + 1} место`)}
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={`${draft.placePoints.length + 1}-е … ½ поля`}>
                {input(draft.upperHalfPoints, (x) => set({ upperHalfPoints: x }), "Верхняя половина")}
              </Field>
              <Field label="Остальные места">
                {input(draft.lowerHalfPoints, (x) => set({ lowerHalfPoints: x }), "Нижняя половина")}
              </Field>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Поле: √(N / …)">{input(draft.fieldBase, (x) => set({ fieldBase: x }), "База коэффициента поля")}</Field>
            <Field label="За нокаут +">{input(draft.koPoints, (x) => set({ koPoints: x }), "Очки за нокаут")}</Field>
            <Field label="За re-entry −">{input(draft.reentryPenalty, (x) => set({ reentryPenalty: x }), "Штраф за re-entry")}</Field>
            <Field label="Минимум">{input(draft.minPoints, (x) => set({ minPoints: x }), "Минимум за участие")}</Field>
          </section>

          <section>
            <div className="mb-2 text-sm font-semibold">Коэффициент турнира</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.keys(KIND_LABEL) as TournamentKind[]).map((k) => (
                <Field key={k} label={KIND_LABEL[k]}>
                  {input(draft.statusCoef[k], (x) => set({ statusCoef: { ...draft.statusCoef, [k]: x } }), KIND_LABEL[k])}
                </Field>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 text-sm font-semibold">ELO (отдельный показатель силы)</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Старт">{input(draft.elo.start, (x) => set({ elo: { ...draft.elo, start: x } }), "Стартовый ELO")}</Field>
              <Field label="K">{input(draft.elo.k, (x) => set({ elo: { ...draft.elo, k: x } }), "K")}</Field>
              <Field label="K новичков">{input(draft.elo.newbieK, (x) => set({ elo: { ...draft.elo, newbieK: x } }), "K новичков")}</Field>
              <Field label="Первые … турниров">
                {input(draft.elo.newbieGames, (x) => set({ elo: { ...draft.elo, newbieGames: x } }), "Турниров новичка")}
              </Field>
            </div>
          </section>

          {parsed.error && <div className="text-sm text-red-300">{parsed.error}</div>}
          {message && <div className={`text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</div>}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button disabled={!dirty} onClick={() => set(toDraft(saved.rules))}>
              Отменить правки
            </Button>
            <Button variant="primary" disabled={busy || !dirty} onClick={save}>
              Сохранить правила
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-5">
        <SettingsCard />
        <Rescore rulesId={saved.id} />
        <Calculator rules={parsed.rules ?? saved.rules} draftChanged={dirty} />
      </div>
    </div>
  );
}

/** «Пересчитать»: очки сыгранных турниров по текущим правилам (по RATING.md — только по кнопке) */
function Rescore({ rulesId }: { rulesId: number }) {
  const [outdated, setOutdated] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/rating/rescore", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setOutdated(d.outdated ?? 0))
      .catch(() => {});
  }, [rulesId]);

  async function run() {
    if (!window.confirm("Пересчитать очки всех сыгранных турниров по текущим правилам? Старые очки заменятся.")) return;
    setBusy(true);
    const res = await fetch("/api/rating/rescore", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setMessage(data.error ?? "Не удалось пересчитать");
    setOutdated(data.outdated);
    setMessage(`Пересчитано турниров: ${data.tournaments}`);
  }

  return (
    <Card title="Пересчёт очков">
      <div className="text-sm text-slate-400">
        {outdated === null
          ? "…"
          : outdated === 0
            ? `Все сыгранные турниры посчитаны по текущим правилам (версия ${rulesId}).`
            : `Турниров, посчитанных по старым правилам или ещё не посчитанных: ${outdated}.`}
      </div>
      {message && <div className="mt-2 text-sm text-emerald-300">{message}</div>}
      <Button className="mt-3" variant={outdated ? "primary" : "default"} disabled={busy || outdated === 0} onClick={run}>
        Пересчитать все турниры
      </Button>
    </Card>
  );
}

/** Пример расчёта: «откуда взялись очки» и сколько даёт каждое место при поле N */
function Calculator({ rules, draftChanged }: { rules: RatingRules; draftChanged: boolean }) {
  const [n, setN] = useState("24");
  const [place, setPlace] = useState("2");
  const [ko, setKo] = useState("1");
  const [entries, setEntries] = useState("2");
  const [kind, setKind] = useState<TournamentKind>("regular");

  const field = Math.max(1, Math.min(500, Number(n) || 1));
  const p = Math.max(1, Math.min(field, Number(place) || 1));
  const b = pointsBreakdown(
    { place: p, ko: Number(ko.replace(",", ".")) || 0, entries: Math.max(1, Number(entries) || 1), fieldSize: field, kind },
    rules,
  );
  const fmt = (x: number) => (Math.round(x * 100) / 100).toLocaleString("ru-RU");
  const preview = placesPreview(field, kind, rules);

  return (
    <Card title={draftChanged ? "Пример расчёта · по несохранённым правилам" : "Пример расчёта"}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Игроков (N)">
          <input className={inputClass} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Место">
          <input className={inputClass} inputMode="numeric" value={place} onChange={(e) => setPlace(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Нокауты">
          <input className={inputClass} inputMode="decimal" value={ko} onChange={(e) => setKo(e.target.value.replace(/[^\d,.]/g, ""))} />
        </Field>
        <Field label="Входов">
          <input className={inputClass} inputMode="numeric" value={entries} onChange={(e) => setEntries(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <div className="mt-3">
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as TournamentKind)}>
          {(Object.keys(KIND_LABEL) as TournamentKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]} · ×{fmt(rules.statusCoef[k])}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 rounded-lg bg-black/20 p-3 text-sm tabular-nums">
        <div className="text-slate-400">
          {fmt(b.base)} за место × {fmt(b.coef)} поле{b.status !== 1 && ` × ${fmt(b.status)}`}
          {b.ko > 0 && ` + ${fmt(b.ko * rules.koPoints)} за KO`}
          {b.reentries > 0 && ` − ${fmt(b.reentries * rules.reentryPenalty)} за re-entry`} = {fmt(b.raw)}
        </div>
        <div className="mt-1 text-2xl font-black text-amber-200">{b.total} очк.</div>
        {b.total === rules.minPoints && b.raw < rules.minPoints && <div className="text-xs text-slate-500">минимум за участие</div>}
      </div>

      <div className="mt-4">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
          Сколько даёт место при {field} игроках (без KO и re-entry)
        </div>
        <div className="grid grid-cols-2 gap-x-6 text-sm tabular-nums">
          {preview.map((r) => (
            <div key={r.from} className="flex justify-between border-b border-white/[0.05] py-1">
              <span className="text-slate-400">{r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`}</span>
              <span className="font-semibold">{r.points}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ====================== Вкладки рейтинга ======================

type Overview = {
  settings: ClubSettings;
  kinds: PeriodKind[];
  open: Partial<Record<PeriodKind, PeriodView | null>>;
  all: StandingRow[];
  closed: Period[];
  defaultNames: Record<PeriodKind, string>;
  nextNames: Record<PeriodKind, string>;
  unscored: number;
};

const KIND_TAB: Record<PeriodKind, string> = { month: "Месяц", season: "Сезон", year: "Год" };
type Tab = PeriodKind | "all" | "archive" | "rules";

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
/** yyyy-mm-dd из поля даты → начало этого дня по местному времени */
const dateToTs = (v: string) => {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

async function post(body: unknown) {
  const res = await fetch("/api/rating/periods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Ошибка");
}

function Rating() {
  const [tab, setTab] = useState<Tab>("month");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/rating", { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) return setError(d.error ?? "Не удалось загрузить рейтинг");
    setData(d);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const tabs: { id: Tab; label: string }[] = [
    ...(data?.kinds ?? ["month"]).map((k) => ({ id: k as Tab, label: KIND_TAB[k as PeriodKind] })),
    { id: "all", label: "За всё время" },
    { id: "archive", label: "Архив" },
    { id: "rules", label: "Правила" },
  ];

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto whitespace-nowrap rounded-xl bg-white/[0.03] p-1 [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-amber-300 font-bold text-[#080e15]" : "text-slate-400 hover:text-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mx-auto max-w-5xl text-sm text-red-300">{error}</div>}
      {data && data.unscored > 0 && tab !== "rules" && (
        <div className="mx-auto max-w-5xl rounded-lg border border-amber-300/30 bg-amber-300/[0.07] px-3 py-2 text-sm text-amber-200">
          Турниров без очков: {data.unscored}. Они не попадают в рейтинг — нажмите «Пересчитать» на вкладке «Правила».
        </div>
      )}

      {tab === "rules" ? (
        <RulesTab />
      ) : !data ? (
        <div className="py-20 text-center text-slate-500">Загрузка…</div>
      ) : tab === "all" ? (
        <div className="mx-auto max-w-5xl">
          <Card title={`За всё время · ${data.all.length} игр.`}>
            <StandingsTable rows={data.all} />
          </Card>
        </div>
      ) : tab === "archive" ? (
        <Archive closed={data.closed} onChanged={load} />
      ) : (
        <OpenPeriod
          // новый период (начали / закрыли) — форма начинается заново, с его значениями
          key={`${tab}-${data.open[tab]?.period.id ?? "none"}-${data.open[tab]?.period.finalistsN ?? ""}`}
          kind={tab}
          view={data.open[tab] ?? null}
          defaultName={data.open[tab] ? data.nextNames[tab] : data.defaultNames[tab]}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** Таблица рейтинга; zoneN — черта «зона финала: топ-N» */
function StandingsTable({
  rows,
  zoneN,
  finalistIds,
  action,
}: {
  rows: StandingRow[];
  zoneN?: number;
  finalistIds?: Set<number>;
  action?: (row: StandingRow) => React.ReactNode;
}) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-slate-500">Пока никто не набрал очков.</div>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
          <th className="w-8 py-2">#</th>
          <th className="py-2">Игрок</th>
          <th className="w-14 py-2 text-right">Очки</th>
          <th className="w-9 py-2 text-center" title="Турниров">Т</th>
          <th className="hidden w-9 py-2 text-center sm:table-cell" title="Побед">П</th>
          <th className="w-10 py-2 text-center">KO</th>
          <th className="hidden w-14 py-2 text-right sm:table-cell">ELO</th>
          {action && <th className="w-16" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.playerId}>
            <tr className={`border-t border-white/[0.06] ${finalistIds?.has(r.playerId) ? "bg-amber-300/[0.05]" : ""}`}>
              <td className="py-2 tabular-nums text-slate-400">{r.rank}</td>
              <td className="truncate py-2 font-semibold">{r.name}</td>
              <td className="py-2 text-right font-bold tabular-nums text-amber-200">{r.points}</td>
              <td className="py-2 text-center tabular-nums text-slate-400">{r.tournaments}</td>
              <td className="hidden py-2 text-center tabular-nums text-slate-400 sm:table-cell">{r.wins || "—"}</td>
              <td className="py-2 text-center tabular-nums text-slate-400">{r.ko ? num(r.ko) : "—"}</td>
              <td className="hidden py-2 text-right tabular-nums text-slate-500 sm:table-cell">{r.elo}</td>
              {action && <td className="py-1 text-right">{action(r)}</td>}
            </tr>
            {zoneN != null && r.rank === zoneN && rows.length > zoneN && (
              <tr>
                <td colSpan={8} className="py-1">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">
                    <span className="h-px flex-1 bg-amber-300/50" />
                    зона финала: топ-{zoneN}
                    <span className="h-px flex-1 bg-amber-300/50" />
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** Открытый период (или кнопка «Начать первый период») */
function OpenPeriod({
  kind,
  view,
  defaultName,
  onChanged,
}: {
  kind: PeriodKind;
  view: PeriodView | null;
  defaultName: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [name, setName] = useState(defaultName);
  const [date, setDate] = useState("");
  const [n, setN] = useState(view ? String(view.period.finalistsN) : "");

  async function run(body: unknown, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      await post(body);
      after?.();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-xl">
        <Card title={`${KIND_TAB[kind]} · рейтинг не начат`}>
          <div className="space-y-3">
            <div className="text-sm text-slate-400">
              Укажите, с какой даты считать рейтинг. Турниры по игрокам с этой даты сразу попадут в него.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Название">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Начало (пусто — сейчас)">
                <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            {error && <div className="text-sm text-red-300">{error}</div>}
            <Button variant="primary" disabled={busy} onClick={() => run({ action: "start", kind, name, startAt: date ? dateToTs(date) : undefined })}>
              Начать период
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const p = view.period;
  const finalistIds = new Set(view.finalists.map((f) => f.playerId));
  const finalistNames = view.finalists.map((f) => view.standings.find((s) => s.playerId === f.playerId)?.name ?? "?");

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[1.5fr_1fr]">
      <Card title={`${KIND_TAB[kind]} · ${p.name}`} action={<span className="text-xs text-slate-500">с {fmtDate(p.startedAt)}</span>}>
        <StandingsTable rows={view.standings} zoneN={p.finalistsN} finalistIds={finalistIds} />
      </Card>

      <div className="space-y-5">
        <Card title="Финал">
          <div className="flex items-end gap-2">
            <Field label="Сколько проходит (топ-N)">
              <input className={inputClass} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Button disabled={busy || Number(n) === p.finalistsN || !n} onClick={() => run({ action: "setFinalists", periodId: p.id, n: Number(n) })}>
              Сохранить
            </Button>
          </div>
          <div className="mt-2 text-xs text-slate-500">Меняется в любой момент, в том числе после закрытия периода.</div>
        </Card>

        <Card title="Закрыть период">
          {!closing ? (
            <>
              <div className="text-sm text-slate-400">
                Таблица замораживается, формируется список финалистов, сразу начинается новый период.
              </div>
              <Button className="mt-3" onClick={() => setClosing(true)}>
                Закрыть «{p.name}»…
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-300/30 bg-amber-300/[0.07] p-3 text-sm text-amber-100">
                Период «{p.name}» ({fmtDate(p.startedAt)}–{date ? fmtDate(dateToTs(date)) : "сейчас"}) закрывается, в финал
                проходят {view.finalists.length} игр.: {finalistNames.join(", ") || "—"}.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Новый период">
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Начало (пусто — сейчас)">
                  <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              </div>
              {error && <div className="text-sm text-red-300">{error}</div>}
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => setClosing(false)}>Отмена</Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    run({ action: "close", periodId: p.id, nextName: name, nextStart: date ? dateToTs(date) : undefined }, () => setClosing(false))
                  }
                >
                  Закрыть период
                </Button>
              </div>
            </div>
          )}
          {!closing && error && <div className="mt-2 text-sm text-red-300">{error}</div>}
        </Card>
      </div>
    </div>
  );
}

/** Закрытые периоды: замороженные таблицы, финалисты, wildcard и отказы, отмена закрытия */
function Archive({ closed, onChanged }: { closed: Period[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (selected != null) return <ClosedPeriod id={selected} onBack={() => (setSelected(null), onChanged())} />;
  return (
    <div className="mx-auto max-w-3xl">
      <Card title={`Закрытые периоды · ${closed.length}`}>
        {closed.length === 0 && <div className="py-6 text-center text-sm text-slate-500">Закрытых периодов пока нет.</div>}
        <div className="divide-y divide-white/[0.06]">
          {closed.map((p) => (
            <button key={p.id} type="button" onClick={() => setSelected(p.id)} className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {p.name} <span className="text-xs font-normal text-slate-500">{KIND_TAB[p.kind]}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {fmtDate(p.startedAt)} – {fmtDate(p.closedAt!)} · финал: топ-{p.finalistsN}
                </div>
              </div>
              <span className="text-slate-500">→</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ClosedPeriod({ id, onBack }: { id: number; onBack: () => void }) {
  const [view, setView] = useState<PeriodView | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState("");
  const [wild, setWild] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/rating/periods/${id}`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) return setError(d.error ?? "Ошибка");
    setView(d);
    setN(String(d.period.finalistsN));
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    fetch("/api/players", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPlayers(d.players ?? []))
      .catch(() => {});
  }, [load]);

  async function run(body: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    try {
      await post(body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Button variant="ghost" onClick={onBack}>
      ← К списку
    </Button>
  );
  if (!view) return <Card action={back}>{error || "Загрузка…"}</Card>;

  const p = view.period;
  const nameOf = (pid: number) => view.standings.find((s) => s.playerId === pid)?.name ?? players.find((x) => x.id === pid)?.name ?? "?";
  const finalistIds = new Set(view.finalists.map((f) => f.playerId));

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[1.5fr_1fr]">
      <Card title={`${KIND_TAB[p.kind]} · ${p.name} · закрыт`} action={back}>
        <div className="mb-2 text-xs text-slate-500">
          {fmtDate(p.startedAt)} – {fmtDate(p.closedAt!)} · таблица заморожена
        </div>
        <StandingsTable rows={view.standings} zoneN={p.finalistsN} finalistIds={finalistIds} />
      </Card>

      <div className="space-y-5">
        <Card title={`Финалисты · ${view.finalists.length}`}>
          <div className="divide-y divide-white/[0.06]">
            {view.finalists.map((f, i) => (
              <div key={f.playerId} className="flex items-center gap-2 py-2">
                <div className="w-6 text-center text-sm tabular-nums text-slate-500">{i + 1}</div>
                <div className="min-w-0 flex-1 truncate font-semibold">
                  {nameOf(f.playerId)}
                  {f.source === "wildcard" && <span className="ml-2 text-xs font-normal text-amber-300">wildcard</span>}
                  {f.rank != null && <span className="ml-2 text-xs font-normal text-slate-500">{f.rank} в таблице</span>}
                </div>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(
                      { action: "finalist", periodId: p.id, playerId: f.playerId, change: "remove", note: "отказ" },
                      `${nameOf(f.playerId)} отказывается от финала? Будет приглашён следующий по рейтингу.`,
                    )
                  }
                >
                  Отказ
                </Button>
              </div>
            ))}
          </div>
          {view.declined.length > 0 && (
            <div className="mt-3 text-sm text-slate-500">
              Отказались:{" "}
              {view.declined.map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className="mr-2 underline decoration-dotted hover:text-slate-300"
                  title="Вернуть в финалисты"
                  onClick={() => run({ action: "finalist", periodId: p.id, playerId: pid, change: "add", note: "вернули" })}
                >
                  {nameOf(pid)} ↺
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 flex items-end gap-2">
            <Field label="Wildcard">
              <select className={inputClass} value={wild} onChange={(e) => setWild(e.target.value)}>
                <option value="">Выберите игрока…</option>
                {players
                  .filter((x) => !finalistIds.has(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Button
              disabled={busy || !wild}
              onClick={() => run({ action: "finalist", periodId: p.id, playerId: Number(wild), change: "add", note: "wildcard" }).then(() => setWild(""))}
            >
              Добавить
            </Button>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <Field label="Сколько проходит (топ-N)">
              <input className={inputClass} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Button disabled={busy || !n || Number(n) === p.finalistsN} onClick={() => run({ action: "setFinalists", periodId: p.id, n: Number(n) })}>
              Сохранить
            </Button>
          </div>
          {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
        </Card>

        {view.changes.length > 0 && (
          <Card title="Правки списка">
            <div className="space-y-1 text-sm text-slate-400">
              {view.changes.map((c) => (
                <div key={c.id}>
                  {new Date(c.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ·{" "}
                  {c.action === "add" ? "добавлен" : "убран"}: {c.name}
                  {c.note && <span className="text-slate-500"> ({c.note})</span>}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="Отменить закрытие">
          {view.reopenBlocker ? (
            <div className="text-sm text-slate-500">Нельзя: {view.reopenBlocker.toLowerCase()}.</div>
          ) : (
            <>
              <div className="text-sm text-slate-400">Если закрыли по ошибке: период снова откроется, новый — удалится.</div>
              <Button
                className="mt-3"
                variant="danger"
                disabled={busy}
                onClick={() => run({ action: "reopen", periodId: p.id }, `Вернуть период «${p.name}»? Список финалистов и правки удалятся.`).then(onBack)}
              >
                Отменить закрытие
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Настройки: сезон/год, N финалистов для новых периодов */
function SettingsCard() {
  const [s, setS] = useState<ClubSettings | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/rating", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setS(d.settings ?? null))
      .catch(() => {});
  }, []);

  async function save(patch: Partial<ClubSettings>) {
    const res = await fetch("/api/rating/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? "Ошибка");
    setS(d.settings);
    setMsg("Сохранено");
  }

  if (!s) return null;
  return (
    <Card title="Периоды и финалы">
      <div className="space-y-3 text-sm">
        {(["seasonEnabled", "yearEnabled"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={s[k]} onChange={(e) => save({ [k]: e.target.checked })} />
            {k === "seasonEnabled" ? "Сезонный рейтинг и финал сезона" : "Годовой рейтинг и финал года"}
          </label>
        ))}
        <div className="grid grid-cols-3 gap-2">
          {(["month", "season", "year"] as const).map((k) => (
            <Field key={k} label={`Финал ${k === "month" ? "месяца" : k === "season" ? "сезона" : "года"}: топ-`}>
              <input
                className={inputClass}
                inputMode="numeric"
                defaultValue={s.finalistsN[k]}
                onBlur={(e) => Number(e.target.value) !== s.finalistsN[k] && save({ finalistsN: { ...s.finalistsN, [k]: Number(e.target.value) } })}
              />
            </Field>
          ))}
        </div>
        <div className="text-xs text-slate-500">Для новых периодов. У идущего периода число меняется на его вкладке.</div>
        {msg && <div className="text-emerald-300">{msg}</div>}
      </div>
    </Card>
  );
}
