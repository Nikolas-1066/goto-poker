"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button, Card, Field, inputClass } from "@/components/admin/ui";
import { formatChips, formatClock, structureDurationMs } from "@/lib/clock";
import { newId, suggestNextLevel, withPresetDefaults } from "@/lib/presets";
import type { LevelStep, Preset, Step } from "@/lib/types";

export default function PresetsPage() {
  return (
    <AdminShell>
      <PresetsEditor />
    </AdminShell>
  );
}

type Draft = Omit<Preset, "id" | "updatedAt"> & { id: string | null };

const toDraft = (p: Preset): Draft => structuredClone(withPresetDefaults({ ...p }));

function blankDraft(): Draft {
  const first = suggestNextLevel(undefined, 20);
  return {
    id: null,
    name: "Новый пресет",
    description: "",
    startingStack: 30000,
    rebuyStack: 30000,
    addonStack: 30000,
    doubleAddonStack: 60000,
    rebuyUntilLevel: 0,
    addonUntilLevel: 0,
    steps: [first],
  };
}

async function fetchPresets() {
  const res = await fetch("/api/presets", { cache: "no-store" });
  const data = (await res.json()) as { presets: Preset[] };
  return data.presets;
}

function PresetsEditor() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const applyLoaded = useCallback((list: Preset[], selectId?: string) => {
    setPresets(list);
    const pick = list.find((p) => p.id === selectId) ?? list[0];
    if (pick) {
      const d = toDraft(pick);
      setSelectedId(pick.id);
      setDraft(d);
      setSaved(JSON.stringify(d));
    }
  }, []);

  const load = useCallback(
    async (selectId?: string) => applyLoaded(await fetchPresets(), selectId),
    [applyLoaded],
  );

  useEffect(() => {
    fetchPresets()
      .then((list) => applyLoaded(list))
      .catch(() => {});
  }, [applyLoaded]);

  const dirty = draft ? JSON.stringify(draft) !== saved : false;

  function confirmLeave() {
    return !dirty || window.confirm("Есть несохранённые изменения. Отменить их?");
  }

  function select(p: Preset) {
    if (p.id === selectedId || !confirmLeave()) return;
    const d = toDraft(p);
    setSelectedId(p.id);
    setDraft(d);
    setSaved(JSON.stringify(d));
    setMessage(null);
  }

  function createNew(from?: Draft) {
    if (!confirmLeave()) return;
    const d: Draft = from
      ? { ...structuredClone(from), id: null, name: `${from.name} (копия)` }
      : blankDraft();
    setSelectedId(null);
    setDraft(d);
    setSaved("");
    setMessage(null);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(draft.id ? `/api/presets/${draft.id}` : "/api/presets", {
      method: draft.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage({ kind: "error", text: data.error ?? "Не удалось сохранить" });
      return;
    }
    await load(data.preset.id);
    setMessage({ kind: "ok", text: "Сохранено" });
  }

  async function remove() {
    if (!draft?.id) {
      setDraft(null);
      await load();
      return;
    }
    if (!window.confirm(`Удалить пресет «${draft.name}»?`)) return;
    const res = await fetch(`/api/presets/${draft.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setMessage({ kind: "error", text: data.error ?? "Не удалось удалить" });
      return;
    }
    await load();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <Card title="Пресеты" className="self-start">
        <div className="space-y-1">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p)}
              className={`block w-full rounded-lg px-3 py-2 text-left ${
                p.id === selectedId ? "bg-amber-300/10 text-amber-200" : "text-slate-300 hover:bg-white/[0.05]"
              }`}
            >
              <div className="font-semibold">{p.name}</div>
              <div className="text-xs text-slate-500">
                {p.steps.filter((s) => s.kind === "level").length} ур. · стек {formatChips(p.startingStack)}
              </div>
            </button>
          ))}
          {draft && draft.id === null && (
            <div className="rounded-lg bg-amber-300/10 px-3 py-2 text-amber-200">
              <div className="font-semibold">{draft.name}</div>
              <div className="text-xs text-slate-500">не сохранён</div>
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-2">
          <Button onClick={() => createNew()}>+ Новый пресет</Button>
          <Button disabled={!draft} onClick={() => draft && createNew(draft)}>
            Дублировать
          </Button>
        </div>
      </Card>

      {draft ? (
        <PresetForm
          draft={draft}
          onChange={setDraft}
          dirty={dirty}
          busy={busy}
          message={message}
          onSave={save}
          onRevert={() => setDraft(saved ? JSON.parse(saved) : null)}
          onDelete={remove}
        />
      ) : (
        <Card>
          <div className="py-10 text-center text-slate-500">Выберите пресет слева</div>
        </Card>
      )}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  className = "",
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  return (
    <input
      className={`${inputClass} ${className}`}
      inputMode="numeric"
      value={Number.isFinite(value) && value !== 0 ? value : ""}
      placeholder="0"
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, "");
        onChange(raw === "" ? 0 : Number(raw));
      }}
    />
  );
}

function PresetForm({
  draft,
  onChange,
  dirty,
  busy,
  message,
  onSave,
  onRevert,
  onDelete,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  dirty: boolean;
  busy: boolean;
  message: { kind: "ok" | "error"; text: string } | null;
  onSave: () => void;
  onRevert: () => void;
  onDelete: () => void;
}) {
  const [bulkMinutes, setBulkMinutes] = useState(20);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const setSteps = (steps: Step[]) => set({ steps });

  const levels = draft.steps.filter((s): s is LevelStep => s.kind === "level");
  const lastLevel = levels[levels.length - 1];
  const totalMs = structureDurationMs(draft.steps);

  const levelNumbers = useMemo(() => {
    let n = 0;
    return draft.steps.map((s) => (s.kind === "level" ? ++n : n));
  }, [draft.steps]);

  function updateStep(index: number, patch: Partial<LevelStep> & { note?: string }) {
    setSteps(draft.steps.map((s, i) => (i === index ? ({ ...s, ...patch } as Step) : s)));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setSteps(steps);
  }

  function insertAfter(index: number, step: Step) {
    const steps = [...draft.steps];
    steps.splice(index + 1, 0, step);
    setSteps(steps);
  }

  function addLevel() {
    setSteps([...draft.steps, suggestNextLevel(lastLevel, lastLevel?.minutes ?? bulkMinutes)]);
  }

  function addBreak() {
    setSteps([...draft.steps, { id: newId(), kind: "break", minutes: 10 }]);
  }

  return (
    <div className="space-y-5">
      <Card
        title={draft.id ? "Редактирование пресета" : "Новый пресет"}
        action={
          <div className="flex items-center gap-2">
            {message && (
              <span className={`text-sm ${message.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}>
                {message.text}
              </span>
            )}
            {dirty && draft.id && (
              <Button variant="ghost" onClick={onRevert}>
                Отменить изменения
              </Button>
            )}
            <Button variant="primary" onClick={onSave} disabled={busy || (!dirty && !!draft.id)}>
              {busy ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Название">
            <input className={inputClass} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Описание">
            <input
              className={inputClass}
              value={draft.description ?? ""}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Стартовый стек">
            <NumInput value={draft.startingStack} onChange={(v) => set({ startingStack: v })} />
          </Field>
          <Field label="Стек ребая">
            <NumInput value={draft.rebuyStack} onChange={(v) => set({ rebuyStack: v })} />
          </Field>
          <Field label="Стек аддона">
            <NumInput value={draft.addonStack} onChange={(v) => set({ addonStack: v })} />
          </Field>
          <Field label="Стек двойного аддона">
            <NumInput value={draft.doubleAddonStack} onChange={(v) => set({ doubleAddonStack: v })} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Ребаи до конца уровня (0 — нет)">
            <NumInput value={draft.rebuyUntilLevel} onChange={(v) => set({ rebuyUntilLevel: v })} />
          </Field>
          <Field label="Аддоны до конца уровня (0 — нет)">
            <NumInput value={draft.addonUntilLevel} onChange={(v) => set({ addonUntilLevel: v })} />
          </Field>
          {(draft.rebuyUntilLevel === 0 || draft.addonUntilLevel === 0) && (
            <div className="rounded-lg border border-amber-300/30 bg-amber-300/[0.07] px-3 py-2 col-span-2 text-xs text-amber-200">
              {draft.rebuyUntilLevel === 0 && draft.addonUntilLevel === 0
                ? "Ребаи и аддоны выключены (0)"
                : draft.rebuyUntilLevel === 0
                  ? "Ребаи выключены (0)"
                  : "Аддоны выключены (0)"}
              : в турнире «по игрокам» этих кнопок не будет. Укажите уровень, до конца которого они разрешены.
              Уже загруженный турнир правка пресета не меняет — там это настраивается в карточке «Игроки».
            </div>
          )}
          <div className="col-span-2 self-end pb-2 text-xs text-slate-500">
            Включая перерыв сразу после этого уровня. Обычно аддон берут на перерыве, когда закрываются ребаи.
          </div>
        </div>
        <div className="mt-4 text-sm text-slate-400">
          {levels.length} уровней · {draft.steps.length - levels.length} перерывов · общая длительность{" "}
          <span className="font-semibold text-slate-200">{formatClock(totalMs)}</span>
          {levels[0] && draft.startingStack > 0 && (
            <> · старт {Math.round(draft.startingStack / Math.max(1, levels[0].bb))} ББ</>
          )}
        </div>
      </Card>

      <Card
        title="Уровни"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <NumInput value={bulkMinutes} onChange={setBulkMinutes} className="w-16! py-1.5" />
              <Button
                className="py-1.5 whitespace-nowrap"
                onClick={() =>
                  setSteps(draft.steps.map((s) => (s.kind === "level" ? { ...s, minutes: bulkMinutes } : s)))
                }
              >
                мин всем уровням
              </Button>
            </div>
            <Button
              className="py-1.5"
              onClick={() => setSteps(draft.steps.map((s) => (s.kind === "level" ? { ...s, ante: s.bb } : s)))}
            >
              Анте = ББ
            </Button>
            <Button
              className="py-1.5"
              onClick={() => setSteps(draft.steps.map((s) => (s.kind === "level" ? { ...s, ante: 0 } : s)))}
            >
              Без анте
            </Button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="w-12 py-2 font-normal">#</th>
                <th className="py-2 pr-2 font-normal">Малый блайнд</th>
                <th className="py-2 pr-2 font-normal">Большой блайнд</th>
                <th className="py-2 pr-2 font-normal">Анте</th>
                <th className="w-24 py-2 pr-2 font-normal">Минут</th>
                <th className="w-40 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {draft.steps.map((s, i) => (
                <tr key={s.id} className="border-t border-white/[0.05]">
                  {s.kind === "level" ? (
                    <>
                      <td className="py-1.5 font-bold text-slate-400">{levelNumbers[i]}</td>
                      <td className="py-1.5 pr-2">
                        <NumInput value={s.sb} onChange={(v) => updateStep(i, { sb: v })} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <NumInput
                          value={s.bb}
                          onChange={(v) =>
                            updateStep(i, {
                              bb: v,
                              // если МБ был ровно половиной ББ — держим пропорцию
                              ...(s.sb * 2 === s.bb ? { sb: Math.round(v / 2) } : {}),
                              ...(s.ante === s.bb ? { ante: v } : {}),
                            })
                          }
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <NumInput value={s.ante} onChange={(v) => updateStep(i, { ante: v })} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 text-sky-300">☕</td>
                      <td colSpan={3} className="py-1.5 pr-2">
                        <input
                          className={`${inputClass} border-sky-300/20`}
                          placeholder="Перерыв · подпись на табло (необязательно), напр. «Укрупнение фишек 100»"
                          value={s.note ?? ""}
                          onChange={(e) => updateStep(i, { note: e.target.value })}
                        />
                      </td>
                    </>
                  )}
                  <td className="py-1.5 pr-2">
                    <NumInput value={s.minutes} onChange={(v) => updateStep(i, { minutes: v })} />
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <IconBtn title="Выше" onClick={() => move(i, -1)} disabled={i === 0}>
                      ↑
                    </IconBtn>
                    <IconBtn title="Ниже" onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1}>
                      ↓
                    </IconBtn>
                    <IconBtn
                      title="Вставить перерыв после"
                      onClick={() => insertAfter(i, { id: newId(), kind: "break", minutes: 10 })}
                    >
                      ☕
                    </IconBtn>
                    <IconBtn title="Удалить" onClick={() => setSteps(draft.steps.filter((_, j) => j !== i))}>
                      ✕
                    </IconBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={addLevel}>+ Уровень</Button>
          <Button onClick={addBreak}>+ Перерыв</Button>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="danger" onClick={onDelete}>
          {draft.id ? "Удалить пресет" : "Отменить создание"}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={busy || (!dirty && !!draft.id)}>
          {busy ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 rounded-md text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-25"
    >
      {children}
    </button>
  );
}
