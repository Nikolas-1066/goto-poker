"use client";

// Карточка игрока: контакты, статистика, место в рейтингах, финалы, график ELO и все турниры.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { playerCard } from "@/lib/db/playercard";
import { formatPhone } from "@/lib/players";
import { formatEloDelta } from "@/lib/rating/elo";
import { KIND_LABEL } from "@/lib/rating/points";
import { formatPlace } from "@/lib/results";
import { formatRub, type PayMethod } from "@/lib/cash";
import { OldDebtsPanel } from "./Cash";
import { PlayerForm } from "./PlayerForm";
import { Button, Card } from "./ui";

type CardData = NonNullable<ReturnType<typeof playerCard>>;

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

export function PlayerCard({ id }: { id: number }) {
  const [card, setCard] = useState<CardData | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/players/${id}`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) return setError(d.error ?? "Игрок не найден");
    setCard(d);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function pay(tournamentId: number, amount: number, method: PayMethod) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/players/${id}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tournamentId, amount, method }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) return setError(d.error ?? "Ошибка");
    setFlash(d.message);
    load();
  }

  const back = (
    <Link href="/admin/players" className="text-sm text-slate-400 hover:text-slate-200">
      ← Игроки
    </Link>
  );
  if (!card) return <div className="mx-auto max-w-3xl">{error ? <Card action={back}>{error}</Card> : <div className="py-20 text-center text-slate-500">Загрузка…</div>}</div>;

  const { player, stats, ratings, finals, tournaments, eloHistory, debts } = card;

  if (editing) {
    return (
      <div className="mx-auto max-w-2xl">
        <PlayerForm
          draft={{ id: player.id, name: player.name, phone: formatPhone(player.phone), note: player.note }}
          players={[]}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-5">
        <Card title="Игрок" action={back}>
          <h1 className="text-2xl font-black">{player.name}</h1>
          <div className="mt-1 text-sm tabular-nums text-slate-400">{formatPhone(player.phone)}</div>
          {player.note && <div className="mt-2 text-sm text-slate-300">{player.note}</div>}
          <div className="mt-1 text-xs text-slate-500">
            {player.firstVisitAt ? `Первый визит ${fmtDate(player.firstVisitAt)}` : "Ещё не играл"}
          </div>
          <Button className="mt-3" onClick={() => setEditing(true)}>
            Изменить
          </Button>
        </Card>

        {(debts.total > 0 || flash) && (
          <Card title={debts.total > 0 ? `Долг · ${formatRub(debts.total)}` : "Долг"}>
            {flash && <div className="mb-2 text-sm text-emerald-300">{flash}</div>}
            {error && <div className="mb-2 text-sm text-red-300">{error}</div>}
            {debts.total > 0 ? (
              <OldDebtsPanel debts={debts.debts} busy={busy} onPay={pay} title="Не доплачено за турниры" />
            ) : (
              <div className="text-sm text-slate-400">Долгов нет</div>
            )}
          </Card>
        )}

        <Card title="Статистика">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Турниров" value={stats.tournaments} />
            <Stat label="Побед" value={stats.wins} />
            <Stat label="Топ-3" value={stats.top3} />
            <Stat label="Лучшее место" value={stats.bestPlace ?? "—"} />
            <Stat label="Нокаутов" value={num(stats.ko)} />
            <Stat label="Re-entry" value={stats.reentries} />
          </div>
          <div className="mt-3 flex items-baseline justify-between rounded-lg bg-white/[0.04] px-3 py-2">
            <span className="text-sm text-slate-400">ELO</span>
            <span className="text-2xl font-black tabular-nums">
              {player.elo}
              {player.eloGames < 5 && player.eloGames > 0 && <span className="ml-2 text-xs font-normal text-slate-500">новичок</span>}
            </span>
          </div>
          {eloHistory.length > 1 && <EloChart points={eloHistory.map((e) => e.elo)} />}
        </Card>

        <Card title="Рейтинг">
          <div className="divide-y divide-white/[0.06]">
            {ratings.map((r) => (
              <div key={r.label} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-400">{r.label}</span>
                <span className="tabular-nums">
                  {r.rank != null ? (
                    <>
                      <b className="text-amber-200">{r.rank}</b> из {r.of} · {r.points} очк.
                    </>
                  ) : (
                    <span className="text-slate-500">нет очков</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {finals.length > 0 && <div className="mt-3 text-sm text-amber-200">Финалист: {finals.join(", ")}</div>}
        </Card>
      </div>

      <Card title={`Турниры · ${tournaments.length}`}>
        {tournaments.length === 0 && <div className="py-6 text-center text-sm text-slate-500">Пока не играл.</div>}
        {tournaments.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2">Турнир</th>
                <th className="w-14 py-2 text-center">Место</th>
                <th className="w-10 py-2 text-center">KO</th>
                <th className="w-12 py-2 text-right">Очки</th>
                <th className="w-12 py-2 text-right">ELO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {tournaments.map((t) => (
                <tr key={t.tournamentId}>
                  <td className="py-2">
                    <div className="truncate font-semibold">{t.name}</div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(t.at)}
                      {t.kind !== "regular" && <span className="text-amber-300"> · {KIND_LABEL[t.kind]}</span>}
                      {t.entries > 1 && ` · входов ${t.entries}`}
                      {t.status !== "finished" && " · идёт"}
                    </div>
                  </td>
                  <td className="py-2 text-center tabular-nums">
                    {t.place != null ? (
                      <>
                        <b className={t.place === 1 ? "text-amber-200" : ""}>{formatPlace(t)}</b>
                        <span className="text-xs text-slate-500">/{t.field}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 text-center tabular-nums text-slate-400">{t.ko ? num(t.ko) : "—"}</td>
                  <td className="py-2 text-right font-bold tabular-nums text-amber-200">{t.points ?? "—"}</td>
                  <td className="py-2 text-right text-xs tabular-nums text-slate-400">{formatEloDelta(t.eloBefore, t.eloAfter) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-1 py-2">
      <div className="text-xl font-black tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

/** Простой график ELO по турнирам (от старых к новым) */
function EloChart({ points }: { points: number[] }) {
  const w = 300;
  const h = 60;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 4 - ((p - min) / span) * (h - 8)]);
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" aria-label="ELO по турнирам">
        <polyline points={xy.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#fcd34d" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-500">
        <span>мин {min}</span>
        <span>макс {max}</span>
      </div>
    </div>
  );
}
