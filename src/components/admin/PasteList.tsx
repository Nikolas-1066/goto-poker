"use client";

// «Вставить список»: админ копирует столбец с никами из Google-таблицы (у новичков — телефон в соседнем столбце),
// вставляет сюда, проверяет, кого программа нашла, и записывает всех разом.
// Куда — текущий турнир (карточка «Игроки») или турнир в расписании.

import { useState } from "react";
import type { ImportItem, ImportRow, ImportTarget } from "@/lib/db/importList";
import { normalizePhone } from "@/lib/players";
import { Button, inputClass } from "./ui";

/** Выбор по строке: игрок из базы, новый игрок или пропустить; "" — ещё не выбрано */
type Choice = { value: string; name: string; phone: string };

const initial = (r: ImportRow): Choice => {
  const base = { name: r.name, phone: r.phone ?? "" };
  if (r.match.kind === "found") return { ...base, value: r.options[0]?.already ? "skip" : String(r.match.playerId) };
  if (r.match.kind === "new") return { ...base, value: "new" };
  return { ...base, value: "" };
};

export function PasteList({ target, title, onDone }: { target: ImportTarget; title: string; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setOpen(false);
    setText("");
    setRows(null);
    setChoices([]);
    setError("");
  };

  async function post(body: object) {
    const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, target }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error ?? "Не получилось");
    return d;
  }

  async function check() {
    setBusy(true);
    setError("");
    try {
      const d = (await post({ action: "check", text })) as { rows: ImportRow[] };
      if (!d.rows.length) throw new Error("В списке не нашлось ни одного ника");
      setRows(d.rows);
      setChoices(d.rows.map(initial));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!rows) return;
    setBusy(true);
    setError("");
    try {
      const items = choices.flatMap((c): ImportItem[] =>
        c.value === "skip" || c.value === "" ? [] : c.value === "new" ? [{ name: c.name, phone: c.phone }] : [{ playerId: Number(c.value) }],
      );
      const d = (await post({ action: "apply", items })) as { added: number; created: number; skipped: string[] };
      const parts = [`Записано: ${d.added}`];
      if (d.created) parts.push(`новых игроков: ${d.created}`);
      if (d.skipped.length) parts.push(`не получилось: ${d.skipped.join("; ")}`);
      close();
      onDone(parts.join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" className="text-amber-300" onClick={() => setOpen(true)}>
        📋 Вставить список
      </Button>
    );
  }

  const set = (i: number, patch: Partial<Choice>) => setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const problem = (c: Choice) =>
    c.value === "" ? "выберите" : c.value === "new" ? (!c.name.trim() ? "впишите ник" : !normalizePhone(c.phone) ? "нужен телефон" : "") : "";
  const waiting = choices.filter((c) => problem(c)).length;
  const toAdd = choices.filter((c) => c.value !== "skip" && !problem(c)).length;

  return (
    <div className="basis-full space-y-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.04] p-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Вставить список · {title}</div>
        <Button variant="ghost" onClick={close}>
          Закрыть
        </Button>
      </div>

      {!rows ? (
        <>
          <div className="text-sm text-slate-400">
            Скопируйте в Google-таблице столбец с никами (можно вместе со столбцом телефонов) и вставьте сюда. Каждый игрок — с новой
            строки; новичку нужен телефон.
          </div>
          <textarea
            className={`${inputClass} min-h-40 font-mono text-sm`}
            placeholder={"FALKROOM\nГЛЕСО\nНовичок\t8 900 123-45-67"}
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
          <Button variant="primary" disabled={busy || !text.trim()} onClick={check}>
            Проверить список
          </Button>
        </>
      ) : (
        <>
          <div className="divide-y divide-white/[0.06]">
            {rows.map((r, i) => {
              const c = choices[i];
              const p = problem(c);
              const chosen = r.options.find((o) => String(o.id) === c.value);
              return (
                <div key={r.line} className="space-y-1.5 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-5 text-center">
                      {c.value === "skip" ? "–" : p ? "❓" : c.value === "new" ? "➕" : "✅"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                    <select
                      className={`${inputClass} w-auto max-w-full py-1.5 text-sm`}
                      value={c.value}
                      onChange={(e) => set(i, { value: e.target.value })}
                    >
                      {c.value === "" && <option value="">Кто это? Выберите…</option>}
                      {r.options.map((o) => (
                        <option key={o.id} value={o.id} disabled={o.already}>
                          {o.name} {o.tail}
                          {o.already ? " — уже записан" : ""}
                        </option>
                      ))}
                      <option value="new">Новый игрок</option>
                      <option value="skip">Пропустить</option>
                    </select>
                  </div>
                  <div className="pl-7 text-xs text-slate-500">
                    {r.match.kind === "found" && r.match.by === "phone" && chosen && chosen.name !== r.name && `найден по телефону: в базе «${chosen.name}»`}
                    {r.match.kind === "found" && r.options[0]?.already && "уже записан — пропускаем"}
                    {r.match.kind === "choose" && c.value === "" && "такого ника нет, но есть похожие — выберите или «Новый игрок»"}
                    {r.badPhone && <span className="text-red-300"> телефон «{r.badPhone}» не похож на настоящий</span>}
                  </div>
                  {c.value === "new" && (
                    <div className="flex flex-wrap gap-2 pl-7">
                      <input className={`${inputClass} min-w-0 flex-1 basis-32 py-1.5 text-sm`} placeholder="Ник" value={c.name} onChange={(e) => set(i, { name: e.target.value })} />
                      <input
                        className={`${inputClass} min-w-0 flex-1 basis-40 py-1.5 text-sm ${c.phone && !normalizePhone(c.phone) ? "border-red-400/50" : ""}`}
                        placeholder="Телефон новичка"
                        type="tel"
                        inputMode="tel"
                        value={c.phone}
                        onChange={(e) => set(i, { phone: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || waiting > 0 || toAdd === 0} onClick={apply}>
              Записать: {toAdd}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setRows(null)}>
              ← Изменить список
            </Button>
            {waiting > 0 && <span className="text-sm text-amber-200">Осталось разобрать строк: {waiting}</span>}
          </div>
        </>
      )}

      {error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
    </div>
  );
}
