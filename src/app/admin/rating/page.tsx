"use client";

import { useEffect, useMemo, useState } from "react";
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

function Rating() {
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
