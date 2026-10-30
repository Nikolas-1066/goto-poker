"use client";

// Форма игрока: добавить нового или изменить существующего (имя, телефон, заметка).

import { useEffect, useRef, useState } from "react";
import { phoneTail, similarByName, type Player } from "@/lib/players";
import { Button, Card, Field, inputClass } from "./ui";

/** Что открыто в форме: новый игрок (id: null) или правка существующего */
export type PlayerDraft = { id: number | null; name: string; phone: string; note: string };

export function PlayerForm({
  draft,
  players,
  onCancel,
  onSaved,
}: {
  draft: PlayerDraft;
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
