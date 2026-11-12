"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { CashLine, CashPanel } from "@/components/admin/Cash";
import { ExpensesBlock } from "@/components/admin/Expenses";
import { ReportBlock } from "@/components/admin/Report";
import { Button, Card, inputClass } from "@/components/admin/ui";
import { formatRub, PAY_METHOD_LABEL, PAY_METHODS, type PayMethod } from "@/lib/cash";
import type { HistoryItem, TournamentDetails } from "@/lib/db/history";
import { formatEloDelta } from "@/lib/rating/elo";
import { formatPlace } from "@/lib/results";

export default function HistoryPage() {
  return (
    <AdminShell>
      <History />
    </AdminShell>
  );
}

const STATUS: Record<string, { text: string; cls: string }> = {
  finished: { text: "завершён", cls: "border-emerald-400/30 text-emerald-300" },
  running: { text: "идёт", cls: "border-amber-300/40 text-amber-200" },
  paused: { text: "пауза", cls: "border-white/15 text-slate-400" },
  idle: { text: "не начат", cls: "border-white/15 text-slate-400" },
  /** ушёл в историю, не дойдя до «Завершить» (загрузили новую структуру) */
  abandoned: { text: "не завершён", cls: "border-white/15 text-slate-400" },
};

const statusOf = (t: HistoryItem) => STATUS[t.status !== "finished" && !t.isCurrent ? "abandoned" : t.status] ?? STATUS.idle;

const KIND: Record<string, string> = {
  month_final: "Финал месяца",
  season_final: "Финал сезона",
  year_final: "Финал года",
};

function formatDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const num = (n: number) => String(n).replace(".", ",");

function History() {
  const [list, setList] = useState<HistoryItem[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/history", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Не удалось загрузить историю");
    setList(data.tournaments ?? []);
  }

  useEffect(() => {
    // первая загрузка списка
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  if (list === null) return <div className="py-20 text-center text-slate-500">Загрузка…</div>;

  if (selected != null) {
    return (
      <div className="mx-auto max-w-3xl">
        <Details
          id={selected}
          onBack={() => {
            setSelected(null);
            load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Card title={`История турниров · ${list.length}`}>
        {error && <div className="mb-3 text-sm text-red-300">{error}</div>}
        {list.length === 0 && <div className="py-8 text-center text-sm text-slate-500">Сыгранных турниров пока нет.</div>}
        <div className="divide-y divide-white/[0.06]">
          {list.map((t) => {
            const st = statusOf(t);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{t.name}</span>
                    {KIND[t.kind] && <span className="text-xs text-amber-300">{KIND[t.kind]}</span>}
                    {t.isCurrent && <span className="text-xs text-slate-500">сейчас на табло</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {formatDate(t.finishedAt ?? t.startedAt ?? t.createdAt)}
                    {" · "}
                    {t.players} игр.
                    {t.mode === "manual" && " · учёт вручную"}
                    {t.winner && ` · победитель ${t.winner}`}
                    {t.deal && " · дил"}
                  </div>
                  {t.cash && (
                    <div className="truncate text-xs tabular-nums text-slate-500">
                      собрано {formatRub(t.cash.paid)}
                      {t.cash.debt > 0 && <span className="text-red-300"> · долг {formatRub(t.cash.debt)}</span>}
                    </div>
                  )}
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${st.cls}`}>{st.text}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

type EditRow = { participantId: number; name: string; place: string; entries: string; ko: string; addon: 0 | 1 | 2 };

function Details({ id, onBack }: { id: number; onBack: () => void }) {
  const [t, setT] = useState<TournamentDetails | null>(null);
  const [edit, setEdit] = useState<EditRow[] | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/history/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.tournament ? setT(d.tournament) : setError(d.error ?? "Турнир не найден")))
      .catch(() => setError("Нет связи с сервером"));
  }, [id]);

  function startEdit() {
    if (!t) return;
    setFlash("");
    setError("");
    setEdit(
      t.results.map((r) => ({
        participantId: r.participantId,
        name: r.name,
        place: r.place != null ? String(r.place) : "",
        entries: String(r.entries),
        ko: num(r.ko),
        addon: r.doubleAddons ? 2 : r.addons ? 1 : 0,
      })),
    );
  }

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/history/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: edit.map((r) => ({
          participantId: r.participantId,
          place: Number(r.place),
          entries: Number(r.entries),
          ko: Number(r.ko.replace(",", ".")),
          addon: r.addon,
        })),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Не удалось сохранить");
      return;
    }
    setT(data.tournament);
    setEdit(null);
    setFlash(data.changed ? "Итоги исправлены. Изменения записаны в журнал." : "Ничего не изменилось");
  }

  /** Исправление кассы: оплата / отмена оплаты / «бесплатно» */
  async function cashFix(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setFlash("");
    const res = await fetch(`/api/history/${id}/cash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Не удалось сохранить");
      return;
    }
    setT(data.tournament);
    setFlash(`${data.message ?? "Сохранено"}. Изменение записано в журнал.`);
  }

  /** Расходы: добавить / удалить */
  async function expenseAct(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setFlash("");
    const res = await fetch(`/api/history/${id}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Не удалось сохранить");
      return false;
    }
    setT(data.tournament);
    return true;
  }

  const back = (
    <Button variant="ghost" onClick={onBack}>
      ← К списку
    </Button>
  );

  if (!t) return <Card action={back}>{error ? <div className="text-sm text-red-300">{error}</div> : <div className="text-slate-500">Загрузка…</div>}</Card>;

  const st = statusOf(t);
  const finished = t.status === "finished";
  const set = (i: number, patch: Partial<EditRow>) => setEdit(edit!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Card title={KIND[t.kind] ?? "Турнир"} action={back}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{t.name}</h1>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${st.cls}`}>{st.text}</span>
      </div>
      <div className="mt-1 text-sm text-slate-500">
        {t.startedAt ? `Начало ${formatDate(t.startedAt)}` : `Создан ${formatDate(t.createdAt)}`}
        {t.finishedAt && ` · конец ${formatDate(t.finishedAt)}`}
        {t.deal && " · места на финальном столе — по дилу"}
      </div>

      {t.results.length === 0 ? (
        <div className="mt-4 text-sm text-slate-400">
          Турнир вёлся вручную, без игроков: входов {t.counters.entries}, ребаев {t.counters.rebuys}, аддонов{" "}
          {t.counters.addons + t.counters.doubleAddons}.
        </div>
      ) : edit ? (
        <div className="mt-4">
          <div className="mb-2 text-sm text-slate-400">
            Одинаковые места — делёж (два «3» = «3–4», следующее место — 5). Нокауты можно с половинкой: 0,5.
            «Входов» — первый вход + re-entry; «А» — аддон (нажмите, чтобы переключить: — / А / 2А). Касса пересчитается сама:
            добавленный re-entry или аддон начислится игроку по цене турнира, убранный — снимется.
          </div>
          <div className="space-y-2">
            {edit.map((r, i) => (
              <div key={r.participantId} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_3rem_3rem] items-center gap-2">
                <input
                  className={`${inputClass} text-center`}
                  inputMode="numeric"
                  aria-label={`Место: ${r.name}`}
                  value={r.place}
                  onChange={(e) => set(i, { place: e.target.value.replace(/\D/g, "") })}
                />
                <div className="truncate font-semibold">{r.name}</div>
                <input
                  className={`${inputClass} text-center`}
                  inputMode="numeric"
                  aria-label={`Входов: ${r.name}`}
                  title="Входов"
                  value={r.entries}
                  onChange={(e) => set(i, { entries: e.target.value.replace(/\D/g, "") })}
                />
                <input
                  className={`${inputClass} text-center`}
                  inputMode="decimal"
                  aria-label={`Нокауты: ${r.name}`}
                  title="Нокауты"
                  value={r.ko}
                  onChange={(e) => set(i, { ko: e.target.value.replace(/[^\d,.]/g, "") })}
                />
                <button
                  type="button"
                  aria-label={`Аддон: ${r.name}`}
                  title="Аддон: нет / обычный / двойной"
                  className={`${inputClass} text-center font-semibold ${r.addon ? "text-emerald-300" : "text-slate-500"}`}
                  onClick={() => set(i, { addon: ((r.addon + 1) % 3) as 0 | 1 | 2 })}
                >
                  {r.addon === 2 ? "2А" : r.addon === 1 ? "А" : "—"}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-[3rem_minmax(0,1fr)_3rem_3rem_3rem] gap-2 text-center text-[10px] uppercase text-slate-500">
            <span>место</span>
            <span />
            <span>входов</span>
            <span>KO</span>
            <span>аддон</span>
          </div>
          {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button onClick={() => setEdit(null)}>Отмена</Button>
            <Button variant="primary" disabled={busy} onClick={save}>
              Сохранить итоги
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="w-12 py-2">Место</th>
                <th className="py-2">Игрок</th>
                <th className="w-16 py-2 text-center">Входов</th>
                <th className="hidden w-16 py-2 text-center sm:table-cell">Аддон</th>
                <th className="w-12 py-2 text-center">KO</th>
                <th className="w-14 py-2 text-right">Очки</th>
                <th className="w-12 py-2 text-right sm:w-24">ELO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {t.results.map((r) => (
                <tr key={r.participantId}>
                  <td className="py-2 font-bold tabular-nums text-amber-200">{formatPlace(r) || "—"}</td>
                  <td className="py-2 font-semibold">
                    <Link href={`/admin/players/${r.playerId}`} className="hover:text-amber-200">
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2 text-center tabular-nums">{r.entries}</td>
                  <td className="hidden py-2 text-center text-slate-400 sm:table-cell">
                    {r.doubleAddons ? "двойной" : r.addons ? "да" : "—"}
                  </td>
                  <td className="py-2 text-center tabular-nums">{r.ko ? num(r.ko) : "—"}</td>
                  <td className="py-2 text-right font-bold tabular-nums text-amber-200">{r.points ?? "—"}</td>
                  <td className="py-2 text-right tabular-nums text-slate-400">
                    {r.eloAfter != null ? (
                      <>
                        <span className="hidden sm:inline">{Math.round(r.eloAfter)} </span>
                        <span className="text-xs">{formatEloDelta(r.eloBefore, r.eloAfter)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {finished && (
            <div className="mt-2 text-xs text-slate-500">
              {t.rulesId != null
                ? `Очки — по правилам рейтинга, версия ${t.rulesId}.`
                : "Очки ещё не посчитаны — нажмите «Пересчитать» в разделе «Рейтинг»."}
            </div>
          )}
          {t.cashReport && <CashReport report={t.cashReport} busy={busy} onFix={cashFix} />}
          <ExpensesBlock
            expenses={t.expenses}
            names={t.expenseNames}
            paid={t.cashReport ? t.cashReport.summary.paid : null}
            busy={busy}
            onAdd={(e) => expenseAct({ type: "add", ...e })}
            onDelete={(expenseId) => void expenseAct({ type: "delete", expenseId })}
          />
          {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
          {flash && <div className="mt-3 text-sm text-emerald-300">{flash}</div>}
          {finished ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <ReportBlock key={t.id} tournamentId={t.id} />
              <Button onClick={startEdit}>Исправить итоги</Button>
            </div>
          ) : (
            <div className="mt-4 text-sm text-slate-500">Турнир не завершён — итоги пока предварительные.</div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Касса турнира: итог и по игрокам — кто сколько должен. Нажмите на сумму у игрока — откроется
 * исправление: кто сколько фактически занёс (можно больше начисленного), отмена оплаты, «бесплатно».
 */
function CashReport({
  report,
  busy,
  onFix,
}: {
  report: NonNullable<TournamentDetails["cashReport"]>;
  busy: boolean;
  onFix: (body: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const how = (byMethod: Record<string, number>) =>
    PAY_METHODS.filter((m) => byMethod[m] > 0)
      .map((m) => PAY_METHOD_LABEL[m].toLowerCase())
      .join(", ");
  return (
    <div className="mt-6">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Касса</div>
      <CashLine summary={report.summary} />
      <div className="mt-1 text-xs text-slate-500">
        Не сходится с фактическими деньгами? Нажмите «✎» у игрока: добавьте оплату (можно больше начисленного), отмените
        ошибочную или отметьте вход бесплатным.
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="py-2">Игрок</th>
            <th className="w-20 py-2 text-right">К оплате</th>
            <th className="w-24 py-2 text-right">Оплачено</th>
            <th className="w-20 py-2 text-right">Долг</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {report.players.map((p) => [
            <tr key={p.playerId}>
              <td className="py-2">
                <Link href={`/admin/players/${p.playerId}`} className="font-semibold hover:text-amber-200">
                  {p.name}
                </Link>
                {p.free > 0 && <span className="text-xs text-sky-300"> · бесплатно {formatRub(p.free)}</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{formatRub(p.charged)}</td>
              <td className="py-2 text-right tabular-nums">
                {formatRub(p.paid)}
                {p.paid > 0 && <div className="text-[11px] text-slate-500">{how(p.byMethod)}</div>}
              </td>
              <td
                className={`py-2 text-right font-bold tabular-nums ${
                  p.debt > 0 ? "text-red-300" : p.debt < 0 ? "text-amber-200" : "text-slate-500"
                }`}
              >
                {p.debt > 0 ? formatRub(p.debt) : p.debt < 0 ? `+${formatRub(-p.debt)}` : "—"}
                <button
                  type="button"
                  className="ml-2 rounded border border-white/10 px-1.5 text-xs font-normal text-slate-400 hover:text-amber-200"
                  title="Исправить кассу игрока"
                  onClick={() => setOpen(open === p.playerId ? null : p.playerId)}
                >
                  ✎
                </button>
              </td>
            </tr>,
            open === p.playerId && (
              <tr key={`${p.playerId}-fix`}>
                <td colSpan={4} className="pb-3">
                  <CashPanel
                    key={`${p.debt}-${p.cash.payments.length}`}
                    name={p.name}
                    cash={p.cash}
                    busy={busy}
                    allowOverpay
                    onPay={(amount: number, method: PayMethod) => onFix({ type: "pay", playerId: p.playerId, amount, method })}
                    onCancelPayment={(paymentId) => onFix({ type: "cancelPayment", paymentId })}
                    onSetFree={(eventId, free) => onFix({ type: "setFree", eventId, free })}
                  />
                </td>
              </tr>
            ),
          ])}
        </tbody>
      </table>
      {report.summary.debt > 0 && (
        <div className="mt-2 text-xs text-slate-500">Долг можно принять здесь (✎), в карточке игрока или когда он придёт на турнир.</div>
      )}
    </div>
  );
}
