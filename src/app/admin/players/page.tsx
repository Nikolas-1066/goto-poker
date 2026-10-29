"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button, Card, Field, inputClass } from "@/components/admin/ui";
import { formatPhone, phoneTail, searchPlayers, similarByName, type Player } from "@/lib/players";

export default function PlayersPage() {
  return (
    <AdminShell>
      <Players />
    </AdminShell>
  );
}

/** Что открыто в форме: новый игрок (id: null) или правка существующего */
type Draft = { id: number | null; name: string; phone: string; note: string };

function Players() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
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
  }

  useEffect(() => {
    // первая загрузка списка
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const found = useMemo(() => searchPlayers(players ?? [], query, 100), [players, query]);

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
          {flash && <div className="mt-3 text-sm text-emerald-300">{flash}</div>}
          {error && <div className="mt-3 text-sm text-red-300">{error}</div>}

          <div className="mt-3 divide-y divide-white/[0.06]">
            {found.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDraft({ id: p.id, name: p.name, phone: formatPhone(p.phone), note: p.note })}
                className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name}</div>
                  {p.note && <div className="truncate text-xs text-slate-500">{p.note}</div>}
                </div>
                <div className="shrink-0 text-sm tabular-nums text-slate-400">{phoneTail(p.phone)}</div>
              </button>
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

function PlayerForm({
  draft,
  players,
  onCancel,
  onSaved,
}: {
  draft: Draft;
  players: Player[];
  onCancel: () => void;
  onSaved: (p: Player, isNew: boolean) => void;
}) {
  const [form, setForm] = useState(draft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // фокус туда, что ещё не заполнено
    (form.name ? phoneRef : nameRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isNew = form.id === null;
  // предупреждение о тёзках — только при добавлении нового
  const similar = isNew ? similarByName(players, form.name).slice(0, 3) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(isNew ? "/api/players" : `/api/players/${form.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, phone: form.phone, note: form.note }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Не удалось сохранить");
      return;
    }
    onSaved(data.player as Player, isNew);
  }

  return (
    <Card title={isNew ? "Новый игрок" : "Игрок"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Имя или ник">
          <input
            ref={nameRef}
            className={inputClass}
            value={form.name}
            maxLength={60}
            autoComplete="off"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Телефон">
          <input
            ref={phoneRef}
            className={inputClass}
            value={form.phone}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+7 900 123-45-67"
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        {similar.length > 0 && (
          <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-200">
            Уже есть похожие: {similar.map((p) => `${p.name} ${phoneTail(p.phone)}`).join(", ")}. Это не он?
          </div>
        )}
        <Field label="Заметка (необязательно)">
          <input
            className={inputClass}
            value={form.note}
            maxLength={300}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </Field>
        {error && <div className="text-sm text-red-300">{error}</div>}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button onClick={onCancel}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={busy || !form.name.trim() || !form.phone.trim()}>
            {isNew ? "Добавить" : "Сохранить"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
