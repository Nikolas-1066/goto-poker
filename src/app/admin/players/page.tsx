"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { PlayerForm, type PlayerDraft } from "@/components/admin/PlayerForm";
import { Button, Card, inputClass } from "@/components/admin/ui";
import { formatRub } from "@/lib/cash";
import { phoneTail, searchPlayers, type Player } from "@/lib/players";

export default function PlayersPage() {
  return (
    <AdminShell>
      <Players />
    </AdminShell>
  );
}


function Players() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  /** Долги: { [playerId]: сумма } и фильтр «Должники» */
  const [debts, setDebts] = useState<Record<number, number>>({});
  const [onlyDebtors, setOnlyDebtors] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<PlayerDraft | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  async function load() {
    const res = await fetch("/api/players", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Не удалось загрузить игроков");
      setPlayers([]);
      return;
    }
    setPlayers(data.players);
    setDebts(data.debts ?? {});
  }

  useEffect(() => {
    // первая загрузка списка
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const debtors = Object.keys(debts).length;
  const found = useMemo(
    () => searchPlayers((players ?? []).filter((p) => !onlyDebtors || debts[p.id] > 0), query, 100),
    [players, query, onlyDebtors, debts],
  );

  function startNew() {
    const q = query.trim();
    const looksLikePhone = /^[\d\s()+-]+$/.test(q) && q.replace(/\D/g, "").length >= 10;
    setDraft({ id: null, name: looksLikePhone ? "" : q, phone: looksLikePhone ? q : "", note: "" });
    setFlash("");
  }

  function saved(p: Player, isNew: boolean) {
    setDraft(null);
    setFlash(isNew ? `Добавлен: ${p.name}` : `Сохранено: ${p.name}`);
    setQuery("");
    load();
  }

  if (players === null) return <div className="py-20 text-center text-slate-500">Загрузка…</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {draft ? (
        <PlayerForm
          key={draft.id ?? "new"}
          draft={draft}
          players={players}
          onCancel={() => setDraft(null)}
          onSaved={saved}
        />
      ) : (
        <Card
          title={`Игроки · ${players.length}`}
          action={
            <Button variant="primary" onClick={startNew}>
              + Новый игрок
            </Button>
          }
        >
          <input
            className={inputClass}
            placeholder="Имя или последние цифры телефона"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
          />
          {debtors > 0 && (
            <Button className="mt-2" variant={onlyDebtors ? "primary" : "ghost"} onClick={() => setOnlyDebtors(!onlyDebtors)}>
              Должники · {debtors}
            </Button>
          )}
          {flash && <div className="mt-3 text-sm text-emerald-300">{flash}</div>}
          {error && <div className="mt-3 text-sm text-red-300">{error}</div>}

          <div className="mt-3 divide-y divide-white/[0.06]">
            {found.map((p) => (
              <Link
                key={p.id}
                href={`/admin/players/${p.id}`}
                className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name}</div>
                  {p.note && <div className="truncate text-xs text-slate-500">{p.note}</div>}
                  {debts[p.id] > 0 && <div className="text-xs font-semibold text-red-300">Долг {formatRub(debts[p.id])}</div>}
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums text-slate-400">
                  <div>{phoneTail(p.phone)}</div>
                  <div className="text-xs text-slate-500">ELO {Math.round(p.elo)}</div>
                </div>
              </Link>
            ))}
          </div>

          {found.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-500">
              {players.length === 0 ? "Игроков пока нет — добавьте первого." : "Никого не нашлось."}
              {query.trim() && (
                <div className="mt-3">
                  <Button onClick={startNew}>+ Новый игрок «{query.trim()}»</Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
