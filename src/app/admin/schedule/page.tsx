"use client";

// Расписание будущих турниров (docs/SITE.md, шаг 2): ближайшие турниры и «постоянные дни».
// Отсюда же турнир открывают — он становится текущим на табло и в «Управлении».

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ScheduleSignups } from "@/components/admin/Signups";
import { TelegramCard } from "@/components/admin/Telegram";
import type { AdminSignup } from "@/lib/db/signups";
import type { Player } from "@/lib/players";
import { AboutEditor } from "@/components/admin/AboutEditor";
import { FinalistMessageEditor } from "@/components/admin/Accounts";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button, Card, Field, inputClass } from "@/components/admin/ui";
import { formatRub } from "@/lib/cash";
import { formatChips } from "@/lib/clock";
import { dayHint, formatDay, templateLabel, WEEKDAYS, type ScheduleItem, type ScheduleTemplate } from "@/lib/schedule";
import type { Preset } from "@/lib/types";

export default function SchedulePage() {
  return (
    <AdminShell>
      <Schedule />
    </AdminShell>
  );
}

type Data = { today: string; items: ScheduleItem[]; templates: ScheduleTemplate[]; signups: Record<number, AdminSignup[]> };
/** Поля формы — строками, как в полях ввода */
type Draft = { date: string; weekday: string; time: string; name: string; presetId: string; seatLimit: string; note: string };
type Editing = { kind: "item" | "template"; id: number | null; draft: Draft } | null;

function Schedule() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  /** Игроки базы — чтобы записать игрока на турнир вручную */
  const [players, setPlayers] = useState<Player[]>([]);

  useEffect(() => {
    // первая загрузка: расписание и список структур
    Promise.all([fetch("/api/schedule", { cache: "no-store" }), fetch("/api/presets", { cache: "no-store" })])
      .then(async ([s, p]) => {
        const sd = await s.json();
        if (!s.ok) throw new Error(sd.error ?? "Не удалось загрузить расписание");
        setData(sd);
        setPresets((await p.json()).presets ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить расписание"));
    fetch("/api/players", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { players: [] }))
      .then((d) => setPlayers(d.players ?? []))
      .catch(() => {});
  }, []);

  async function act(action: object, confirmText?: string): Promise<boolean> {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true);
    setError("");
    setFlash("");
    try {
      const res = await fetch("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Не получилось");
        return false;
      }
      setData({ today: d.today, items: d.items, templates: d.templates, signups: d.signups ?? {} });
      setFlash(d.message ?? "");
      return true;
    } catch {
      setError("Нет связи с сервером");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="py-20 text-center text-slate-500">{error || "Загрузка…"}</div>;

  const presetOf = (id: string) => presets.find((p) => p.id === id);
  const blank = (): Draft => ({
    date: data.today,
    weekday: "5",
    time: "19:00",
    name: "",
    presetId: presets[0]?.id ?? "",
    seatLimit: "",
    note: "",
  });
  const draftOf = (x: ScheduleItem | ScheduleTemplate): Draft => ({
    date: "date" in x ? x.date : data.today,
    weekday: "weekday" in x ? String(x.weekday) : "5",
    time: x.time,
    name: x.name,
    presetId: x.presetId,
    seatLimit: x.seatLimit == null ? "" : String(x.seatLimit),
    note: x.note,
  });

  async function save() {
    if (!editing) return;
    const { kind, id, draft } = editing;
    const type = kind === "item" ? (id == null ? "addItem" : "updateItem") : id == null ? "addTemplate" : "updateTemplate";
    // название не вписали — берём название структуры (оно и показано в поле серым)
    const name = draft.name.trim() || (presetOf(draft.presetId)?.name ?? "");
    if (await act({ type, id, data: { ...draft, name, weekday: Number(draft.weekday) } })) setEditing(null);
  }

  const form = (kind: "item" | "template", id: number | null) =>
    editing && editing.kind === kind && editing.id === id ? (
      <DraftForm
        kind={kind}
        isNew={id == null}
        draft={editing.draft}
        today={data.today}
        presets={presets}
        busy={busy}
        onChange={(draft) => setEditing({ kind, id, draft })}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    ) : null;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
      {flash && <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{flash}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          title="Ближайшие турниры"
          action={
            <Button variant="primary" disabled={!presets.length} onClick={() => setEditing({ kind: "item", id: null, draft: blank() })}>
              + Турнир
            </Button>
          }
        >
          {form("item", null)}
          {data.items.length === 0 && !editing && (
            <div className="py-6 text-center text-sm text-slate-500">
              Турниров пока нет. Добавьте турнир кнопкой «+ Турнир» или задайте постоянный день — тогда турниры будут ставиться сами.
            </div>
          )}
          <div className="divide-y divide-white/[0.06]">
            {data.items.map((it) =>
              editing?.kind === "item" && editing.id === it.id ? (
                <div key={it.id} className="py-3">
                  {form("item", it.id)}
                </div>
              ) : (
                <ItemRow
                  key={it.id}
                  item={it}
                  today={data.today}
                  preset={presetOf(it.presetId)}
                  busy={busy}
                  signups={
                    it.status === "cancelled" ? null : (
                      <ScheduleSignups
                        signups={data.signups?.[it.id] ?? []}
                        seatLimit={it.seatLimit}
                        players={players}
                        busy={busy}
                        onAdd={(playerId, guests) => act({ type: "signupAdd", id: it.id, playerId, data: { guests } })}
                        onRemove={(su) => act({ type: "signupRemove", signupId: su.id }, `Снять запись «${su.name}» на «${it.name}»?`)}
                      />
                    )
                  }
                  onEdit={() => setEditing({ kind: "item", id: it.id, draft: draftOf(it) })}
                  onCancel={() => act({ type: "cancel", id: it.id }, `Отменить турнир «${it.name}» ${formatDay(it.date)}?`)}
                  onRestore={() => act({ type: "restore", id: it.id })}
                  onOpen={async () => {
                    const ok = await act(
                      { type: "open", id: it.id },
                      `Открыть турнир «${it.name}»? Он появится на табло и в «Управлении». Прошлый турнир уйдёт в историю.`,
                    );
                    if (ok) router.push("/admin");
                  }}
                />
              ),
            )}
          </div>
        </Card>

        <div className="space-y-4 self-start">
          <Card
            title="Постоянные дни"
            action={
              <Button disabled={!presets.length} onClick={() => setEditing({ kind: "template", id: null, draft: blank() })}>
                + День
              </Button>
            }
          >
            <p className="mb-3 text-sm text-slate-400">
              Турниры, которые идут каждую неделю. Программа сама ставит их в расписание на 2 недели вперёд — отдельный турнир можно поправить или отменить.
            </p>
            {form("template", null)}
            {data.templates.length === 0 && !editing && <div className="py-3 text-center text-sm text-slate-500">Постоянных дней пока нет.</div>}
            <div className="divide-y divide-white/[0.06]">
              {data.templates.map((t) =>
                editing?.kind === "template" && editing.id === t.id ? (
                  <div key={t.id} className="py-3">
                    {form("template", t.id)}
                  </div>
                ) : (
                  <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-sm text-slate-400">
                        {templateLabel(t)} · {presetOf(t.presetId)?.name ?? "структура удалена"}
                        {t.seatLimit != null && ` · до ${t.seatLimit} мест`}
                      </div>
                    </div>
                    <Button variant="ghost" disabled={busy} onClick={() => setEditing({ kind: "template", id: t.id, draft: draftOf(t) })}>
                      Изменить
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        act({ type: "deleteTemplate", id: t.id }, `Убрать «${t.name}» (${templateLabel(t).toLowerCase()})? Его будущие турниры пропадут из расписания.`)
                      }
                    >
                      Убрать
                    </Button>
                  </div>
                ),
              )}
            </div>
          </Card>
          <AboutEditor />
          <FinalistMessageEditor />
          <TelegramCard />
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  today,
  preset,
  busy,
  signups,
  onEdit,
  onCancel,
  onRestore,
  onOpen,
}: {
  item: ScheduleItem;
  today: string;
  preset: Preset | undefined;
  busy: boolean;
  signups: ReactNode;
  onEdit: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onOpen: () => void;
}) {
  const hint = dayHint(item.date, today);
  const cancelled = item.status === "cancelled";
  const details = [
    preset ? `${preset.name} · стек ${formatChips(preset.startingStack)}` : "структура удалена",
    preset && preset.prices.entry > 0 && `вход ${formatRub(preset.prices.entry)}`,
    item.seatLimit != null && `до ${item.seatLimit} мест`,
    item.templateId != null && "постоянный день",
  ].filter(Boolean);
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-3 ${cancelled ? "opacity-50" : ""}`}>
      <div className="w-28 shrink-0">
        {hint && <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">{hint}</div>}
        <div className="text-sm text-slate-300">{formatDay(item.date)}</div>
        <div className="text-xl font-black tabular-nums">{item.time}</div>
      </div>
      <div className="min-w-0 flex-1 basis-52">
        <div className={`font-semibold ${cancelled ? "line-through" : ""}`}>{item.name}</div>
        <div className="text-sm text-slate-400">{details.join(" · ")}</div>
        {item.note && <div className="mt-0.5 text-sm text-slate-500">{item.note}</div>}
        {cancelled && <div className="mt-0.5 text-xs font-bold uppercase tracking-[0.15em] text-red-300">Отменён</div>}
        {item.status === "started" && <div className="mt-0.5 text-xs font-bold uppercase tracking-[0.15em] text-emerald-300">Открыт</div>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {item.status === "planned" && item.date === today && (
          <Button variant="primary" disabled={busy || !preset} onClick={onOpen}>
            Открыть турнир
          </Button>
        )}
        {item.status === "planned" && (
          <>
            <Button variant="ghost" disabled={busy} onClick={onEdit}>
              Изменить
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              Отменить
            </Button>
          </>
        )}
        {cancelled && (
          <Button variant="ghost" disabled={busy} onClick={onRestore}>
            Вернуть
          </Button>
        )}
      </div>
      {signups}
    </div>
  );
}

function DraftForm({
  kind,
  isNew,
  draft,
  today,
  presets,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  kind: "item" | "template";
  isNew: boolean;
  draft: Draft;
  today: string;
  presets: Preset[];
  busy: boolean;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  // название по умолчанию — как у структуры, пока его не вписали сами
  const pickPreset = (presetId: string) => {
    const was = presets.find((p) => p.id === draft.presetId)?.name ?? "";
    const next = presets.find((p) => p.id === presetId)?.name ?? "";
    set({ presetId, name: !draft.name.trim() || draft.name === was ? next : draft.name });
  };
  return (
    <form
      className="mb-3 space-y-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.04] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
        {kind === "item" ? (isNew ? "Новый турнир" : "Турнир") : isNew ? "Новый постоянный день" : "Постоянный день"}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {kind === "item" ? (
          <Field label="Дата">
            <input type="date" required min={today} className={inputClass} value={draft.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        ) : (
          <Field label="День недели">
            <select className={inputClass} value={draft.weekday} onChange={(e) => set({ weekday: e.target.value })}>
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={i + 1}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Начало">
          <input type="time" required className={inputClass} value={draft.time} onChange={(e) => set({ time: e.target.value })} />
        </Field>
      </div>
      <Field label="Структура">
        <select className={inputClass} value={draft.presetId} onChange={(e) => pickPreset(e.target.value)}>
          {!presets.some((p) => p.id === draft.presetId) && <option value={draft.presetId}>— выберите —</option>}
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · стек {formatChips(p.startingStack)}
              {p.prices.entry > 0 ? ` · вход ${formatRub(p.prices.entry)}` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Название (так увидят игроки)">
        <input
          className={inputClass}
          maxLength={60}
          placeholder={presets.find((p) => p.id === draft.presetId)?.name ?? "Например, Пятничный"}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Лимит мест">
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder="без лимита"
            value={draft.seatLimit}
            onChange={(e) => set({ seatLimit: e.target.value.replace(/\D/g, "").slice(0, 3) })}
          />
        </Field>
      </div>
      <Field label="Примечание для игроков (необязательно)">
        <input className={inputClass} maxLength={300} placeholder="Например, финал месяца — только финалисты" value={draft.note} onChange={(e) => set({ note: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onCancel}>Отмена</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {isNew ? "Добавить" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
