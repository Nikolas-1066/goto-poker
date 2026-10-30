"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { TournamentPlayers } from "@/components/admin/TournamentPlayers";
import { Button, Card, Counter, Field, inputClass } from "@/components/admin/ui";
import { boardView, formatChips, formatClock, stepMs } from "@/lib/clock";
import { AddonBreakSelect } from "@/components/admin/AddonBreakSelect";
import { fetchDebtWarning } from "@/components/admin/Cash";
import { PricesLine } from "@/components/admin/PricesLine";
import type { Preset, Step, Tournament, TournamentAction, TournamentMode } from "@/lib/types";
import { useTournament } from "@/lib/useTournament";

export default function AdminPage() {
  return (
    <AdminShell>
      <Control />
    </AdminShell>
  );
}

function Control() {
  const { tournament, now, online, send, refresh } = useTournament(1000);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/presets", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPresets(d.presets ?? []))
      .catch(() => {});
  }, []);

  async function act(action: TournamentAction, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    try {
      await send(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function setMode(mode: TournamentMode) {
    if (!tournament || mode === tournament.mode) return;
    if (
      mode === "players" &&
      tournament.entries > 0 &&
      !window.confirm("Перейти на учёт по игрокам? Счётчики табло будут считаться по участникам, ручные цифры заменятся.")
    )
      return;
    setError("");
    const res = await fetch("/api/tournament/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "setMode", mode }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Ошибка");
    refresh();
  }

  if (!tournament) return <div className="py-20 text-center text-slate-500">Загрузка…</div>;

  const view = boardView(tournament, now);
  const steps = tournament.structure?.steps ?? [];
  const hasStructure = steps.length > 0;
  const { status } = tournament;

  return (
    <div className="space-y-5 pb-28 lg:pb-0">
      <MobileBar
        status={status}
        hasStructure={hasStructure}
        label={view.step?.kind === "break" ? "Перерыв" : `Ур. ${view.levelNumber}`}
        remainingMs={view.remainingMs}
        playersLeft={tournament.playersLeft}
        onToggle={() =>
          act(status === "running" ? { type: "pause" } : status === "idle" ? { type: "start" } : { type: "resume" })
        }
        playersMode={tournament.mode === "players"}
        onBust={() =>
          tournament.mode === "players"
            ? document.getElementById("players")?.scrollIntoView({ behavior: "smooth" })
            : act({ type: "update", patch: { playersLeft: tournament.playersLeft - 1 } })
        }
      />
      {(error || !online) && (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {!online ? "Нет связи с сервером" : error}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* ТАЙМЕР */}
        <Card
          title="Таймер"
          action={<StatusBadge status={status} />}
        >
          {!hasStructure ? (
            <div className="py-10 text-center text-slate-400">
              Загрузите структуру из пресета ниже, чтобы начать турнир.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-bold tracking-[0.3em] text-amber-300">
                    {view.step?.kind === "break" ? "ПЕРЕРЫВ" : `УРОВЕНЬ ${view.levelNumber}`}
                  </div>
                  <div
                    className={`mt-1 text-6xl font-black tabular-nums tracking-tight sm:text-7xl ${
                      status === "paused"
                        ? "text-slate-500"
                        : status === "running" && view.remainingMs <= 10_000
                          ? "text-red-500"
                          : ""
                    }`}
                  >
                    {formatClock(view.remainingMs)}
                  </div>
                </div>
                {view.activeLevel && (
                  <div className="sm:text-right">
                    <div className="text-xs text-slate-500">
                      {view.step?.kind === "break" ? "После перерыва" : "Блайнды"}
                    </div>
                    <div className="text-3xl font-bold tabular-nums">
                      {formatChips(view.activeLevel.sb)} / {formatChips(view.activeLevel.bb)}
                    </div>
                    {view.activeLevel.ante > 0 && (
                      <div className="text-sm text-slate-400">
                        Анте {formatChips(view.activeLevel.ante)}
                      </div>
                    )}
                    {view.nextLevel && (
                      <div className="mt-1 text-xs text-slate-500">
                        Далее: {formatChips(view.nextLevel.sb)} / {formatChips(view.nextLevel.bb)}
                        {view.nextLevel.ante > 0 && ` / ${formatChips(view.nextLevel.ante)}`}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {status === "running" ? (
                  <Button variant="primary" className="col-span-2 min-w-36 py-3 text-base" onClick={() => act({ type: "pause" })}>
                    ❚❚ Пауза
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="col-span-2 min-w-36 py-3 text-base"
                    onClick={() => act(status === "idle" ? { type: "start" } : { type: "resume" })}
                  >
                    ▶ {status === "idle" ? "Старт турнира" : "Продолжить"}
                  </Button>
                )}
                <Button className="py-3" onClick={() => act({ type: "prev" })} disabled={tournament.stepIndex === 0}>
                  ◀ Пред.
                </Button>
                <Button
                  className="py-3"
                  onClick={() => act({ type: "next" })}
                  disabled={tournament.stepIndex >= steps.length - 1}
                >
                  След. ▶
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
                <Button onClick={() => act({ type: "adjustTime", deltaMs: -60_000 })}>−1 мин</Button>
                <Button onClick={() => act({ type: "adjustTime", deltaMs: 60_000 })}>+1 мин</Button>
                <Button onClick={() => act({ type: "adjustTime", deltaMs: -10_000 })}>−10 с</Button>
                <Button onClick={() => act({ type: "adjustTime", deltaMs: 10_000 })}>+10 с</Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <SetTime onSet={(ms) => act({ type: "setTime", remainingMs: ms })} />
                <Button onClick={() => act({ type: "restartStep" }, "Начать текущий уровень заново?")}>
                  ↺ Уровень заново
                </Button>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-4 text-sm">
                <Info label="Прошло" value={formatClock(view.elapsedMs)} />
                <Info
                  label="До перерыва"
                  value={view.step?.kind === "break" ? "перерыв" : view.msToBreak != null ? formatClock(view.msToBreak) : "—"}
                />
                <Info label="Средний стек" value={view.avgStack ? formatChips(view.avgStack) : "—"} />
              </div>
            </>
          )}
        </Card>

        {/* ИГРОКИ */}
        <Card
          title="Игроки"
          className="scroll-mt-16"
          id="players"
          action={
            <RebuyAddonBadges
              tournament={tournament}
              rebuyOpen={view.rebuyOpen}
              addonOpen={view.addonOpen}
              addonUpcoming={view.addonUpcoming}
            />
          }
        >
          <ModeSwitch mode={tournament.mode} onChange={setMode} />
          {tournament.structure && status !== "finished" && (
            <RulesLine
              key={`${tournament.structure.rebuyUntilLevel}-${tournament.structure.addonUntilLevel}`}
              rebuyUntilLevel={tournament.structure.rebuyUntilLevel ?? 0}
              addonUntilLevel={tournament.structure.addonUntilLevel ?? 0}
              steps={tournament.structure.steps}
              onSave={(rebuyUntilLevel, addonUntilLevel) => act({ type: "setRules", rebuyUntilLevel, addonUntilLevel })}
            />
          )}
          {tournament.structure && status !== "finished" && tournament.mode === "players" && (
            <PricesLine
              key={JSON.stringify(tournament.structure.prices ?? null)}
              prices={tournament.structure.prices ?? { entry: 0, reentry: 0, addon: 0, doubleAddon: 0 }}
              onSave={(prices) => act({ type: "setPrices", prices })}
            />
          )}
          {tournament.mode === "players" ? (
            <TournamentPlayers
              tournament={tournament}
              rebuyOpen={view.rebuyOpen}
              addonOpen={view.addonOpen}
              onChanged={refresh}
            />
          ) : (
            <>
              <Button
                variant="primary"
                className="mb-3 w-full py-3 text-base"
                disabled={tournament.playersLeft === 0}
                onClick={() => act({ type: "update", patch: { playersLeft: tournament.playersLeft - 1 } })}
              >
                ✕ Вылет игрока
              </Button>
              <Button
                className="mb-5 w-full"
                onClick={() =>
                  act({
                    type: "update",
                    patch: { entries: tournament.entries + 1, playersLeft: tournament.playersLeft + 1 },
                  })
                }
              >
                + Новый игрок (вход и в игре +1)
              </Button>
              <div className="grid grid-cols-2 gap-4">
                <Counter
                  label="В игре"
                  value={tournament.playersLeft}
                  onChange={(v) => act({ type: "update", patch: { playersLeft: v } })}
                />
                <Counter
                  label="Всего входов"
                  value={tournament.entries}
                  onChange={(v) => act({ type: "update", patch: { entries: v } })}
                />
                <Counter
                  label="Ребаи"
                  value={tournament.rebuys}
                  onChange={(v) => act({ type: "update", patch: { rebuys: v } })}
                />
                <Counter
                  label="Аддоны"
                  value={tournament.addons}
                  onChange={(v) => act({ type: "update", patch: { addons: v } })}
                />
                <Counter
                  label="Двойные аддоны"
                  value={tournament.doubleAddons}
                  onChange={(v) => act({ type: "update", patch: { doubleAddons: v } })}
                />
              </div>
            </>
          )}
          {tournament.structure && (
            <div className="mt-4 text-xs text-slate-500">
              Фишек в игре: {formatChips(view.totalChips)} · стартовый стек{" "}
              {formatChips(tournament.structure.startingStack)}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* СТРУКТУРА ТЕКУЩЕГО ТУРНИРА */}
        <Card
          title={tournament.structure ? `Структура · ${tournament.structure.name}` : "Структура"}
        >
          {!hasStructure ? (
            <div className="text-sm text-slate-500">Структура не загружена.</div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <StructureTable
                tournament={tournament}
                currentIndex={view.index}
                onGoto={(i) => act({ type: "goto", index: i }, "Перейти на этот уровень? Таймер уровня начнётся заново.")}
              />
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {/* ТУРНИР */}
          <Card title="Турнир">
            <TournamentInfo key={tournament.presetId ?? "none"} tournament={tournament} onSave={(patch) => act({ type: "update", patch })} />
          </Card>

          {/* БЕГУЩАЯ СТРОКА */}
          <Card
            title="Бегущая строка"
            action={
              <Toggle
                checked={tournament.tickerOn}
                onChange={(on) => act({ type: "update", patch: { tickerOn: on } })}
              />
            }
          >
            <TickerEditor key={tournament.ticker} value={tournament.ticker} onSave={(ticker) => act({ type: "update", patch: { ticker } })} />
          </Card>

          {/* ЗАГРУЗКА ПРЕСЕТА */}
          <Card title="Загрузить пресет">
            <LoadPreset
              presets={presets}
              currentId={tournament.presetId}
              onLoad={(id) =>
                act(
                  { type: "loadPreset", presetId: id },
                  status === "idle" && !tournament.entries
                    ? undefined
                    : "Загрузить новую структуру? Текущий турнир (таймер и игроки) будет сброшен.",
                )
              }
            />
            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
              <Button
                variant="danger"
                disabled={!hasStructure}
                onClick={() =>
                  act(
                    { type: "reset" },
                    tournament.mode === "players"
                      ? "Сбросить турнир к началу? Таймер обнулится, все входы, аддоны и вылеты игроков удалятся (записавшиеся останутся в списке)."
                      : "Сбросить турнир к началу? Таймер и счётчики игроков обнулятся.",
                  )
                }
              >
                Сбросить турнир
              </Button>
              <Button
                disabled={!hasStructure || status === "finished"}
                onClick={async () => {
                  const warning = tournament.mode === "players" ? await fetchDebtWarning() : "";
                  act({ type: "finish" }, warning ? `Завершить турнир?\n\n${warning}` : "Завершить турнир?");
                }}
              >
                Завершить
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Tournament["status"] }) {
  const map = {
    idle: ["Не начат", "border-white/15 text-slate-400"],
    running: ["Идёт", "border-emerald-400/40 text-emerald-300"],
    paused: ["Пауза", "border-amber-300/40 text-amber-300"],
    finished: ["Завершён", "border-white/15 text-slate-400"],
  } as const;
  const [label, cls] = map[status];
  return <span className={`rounded-full border px-3 py-1 text-xs ${cls}`}>{label}</span>;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-bold tabular-nums">{value}</div>
    </div>
  );
}

function SetTime({ onSet }: { onSet: (ms: number) => void }) {
  const [value, setValue] = useState("");
  function submit() {
    const m = value.trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/);
    if (!m) return;
    onSet((Number(m[1]) * 60 + Number(m[2] ?? 0)) * 1000);
    setValue("");
  }
  return (
    <form
      className="flex gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className={`${inputClass} w-24`}
        placeholder="мм:сс"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" disabled={!value}>
        Задать
      </Button>
    </form>
  );
}

function StructureTable({
  tournament,
  currentIndex,
  onGoto,
}: {
  tournament: Tournament;
  currentIndex: number;
  onGoto: (index: number) => void;
}) {
  const steps = tournament.structure?.steps ?? [];
  const levelNumbers: number[] = [];
  steps.reduce((n, s) => {
    const next = s.kind === "level" ? n + 1 : n;
    levelNumbers.push(next);
    return next;
  }, 0);
  return (
    <table className="w-full text-sm tabular-nums">
      <thead className="sticky top-0 bg-[#101923] text-left text-xs text-slate-500">
        <tr>
          <th className="py-2 pr-2 font-normal">#</th>
          <th className="py-2 pr-2 font-normal">Малый</th>
          <th className="py-2 pr-2 font-normal">Большой</th>
          <th className="py-2 pr-2 font-normal">Анте</th>
          <th className="py-2 pr-2 font-normal">Мин</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => {
          const current = i === currentIndex;
          const past = i < currentIndex;
          return (
            <tr
              key={s.id}
              className={`border-t border-white/[0.05] ${
                current ? "bg-amber-300/10 text-amber-200" : past ? "text-slate-600" : "text-slate-300"
              }`}
            >
              {s.kind === "level" ? (
                <>
                  <td className="py-1.5 pr-2 font-bold">{levelNumbers[i]}</td>
                  <td className="py-1.5 pr-2">{formatChips(s.sb)}</td>
                  <td className="py-1.5 pr-2">{formatChips(s.bb)}</td>
                  <td className="py-1.5 pr-2">{s.ante ? formatChips(s.ante) : "—"}</td>
                </>
              ) : (
                <td colSpan={4} className="py-1.5 pr-2 text-sky-300/80">
                  ☕ Перерыв{s.note ? ` · ${s.note}` : ""}
                </td>
              )}
              <td className="py-1.5 pr-2">{Math.round(stepMs(s) / 60000)}</td>
              <td className="py-1.5 text-right">
                {!current && (
                  <button
                    type="button"
                    onClick={() => onGoto(i)}
                    className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                  >
                    перейти
                  </button>
                )}
                {current && <span className="px-2 text-xs">● сейчас</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TournamentInfo({
  tournament,
  onSave,
}: {
  tournament: Tournament;
  onSave: (patch: { name?: string; combination?: string }) => void;
}) {
  const [name, setName] = useState(tournament.name);
  const [combination, setCombination] = useState(tournament.combination);
  const dirty = name !== tournament.name || combination !== tournament.combination;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, combination });
      }}
    >
      <Field label="Название на табло">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Комбинация дня (пусто — скрыть блок)">
        <input
          className={inputClass}
          value={combination}
          placeholder="Например, ФУЛЛ-ХАУС"
          onChange={(e) => setCombination(e.target.value)}
        />
      </Field>
      <Button type="submit" variant={dirty ? "primary" : "default"} disabled={!dirty}>
        Сохранить
      </Button>
    </form>
  );
}

function LoadPreset({
  presets,
  currentId,
  onLoad,
}: {
  presets: Preset[];
  currentId: string | null;
  onLoad: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const value = selected || currentId || presets[0]?.id || "";

  if (presets.length === 0) return <div className="text-sm text-slate-500">Пресетов пока нет.</div>;

  return (
    <div className="flex gap-2">
      <select className={inputClass} value={value} onChange={(e) => setSelected(e.target.value)}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · стек {formatChips(p.startingStack)}
          </option>
        ))}
      </select>
      <Button variant="primary" disabled={!value} onClick={() => onLoad(value)}>
        Загрузить
      </Button>
    </div>
  );
}

function MobileBar({
  status,
  hasStructure,
  label,
  remainingMs,
  playersLeft,
  playersMode,
  onToggle,
  onBust,
}: {
  status: Tournament["status"];
  hasStructure: boolean;
  label: string;
  remainingMs: number;
  playersLeft: number;
  /** Учёт по игрокам: кнопка ведёт к списку игроков вместо «−1 в игре» */
  playersMode: boolean;
  onToggle: () => void;
  onBust: () => void;
}) {
  if (!hasStructure) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0b131c]/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">{label}</div>
          <div
            className={`text-2xl font-black tabular-nums leading-tight ${
              status === "paused" ? "text-slate-500" : status === "running" && remainingMs <= 10_000 ? "text-red-500" : ""
            }`}
          >
            {formatClock(remainingMs)}
          </div>
        </div>
        <Button className="h-12 px-4" onClick={onBust} disabled={!playersMode && playersLeft === 0}>
          {playersMode ? "Игроки" : "✕ Вылет"}
          <span className="text-slate-500 tabular-nums">{playersLeft}</span>
        </Button>
        <Button variant="primary" className="h-12 w-28 text-base" onClick={onToggle}>
          {status === "running" ? "❚❚ Пауза" : "▶ Старт"}
        </Button>
      </div>
    </div>
  );
}

function RebuyAddonBadges({
  tournament,
  rebuyOpen,
  addonOpen,
  addonUpcoming,
}: {
  tournament: Tournament;
  rebuyOpen: boolean;
  addonOpen: boolean;
  addonUpcoming: boolean;
}) {
  const s = tournament.structure;
  if (!s) return null;
  const badge = (label: string, open: boolean, text: string) => (
    <span
      key={label}
      className={`rounded-full border px-2 py-0.5 text-[11px] ${
        open ? "border-emerald-400/40 text-emerald-300" : "border-white/10 text-slate-500"
      }`}
    >
      {label} {text}
    </span>
  );
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {s.rebuyUntilLevel > 0 && badge("Ребай", rebuyOpen, rebuyOpen ? `до ${s.rebuyUntilLevel} ур.` : "закрыт")}
      {s.addonUntilLevel > 0 &&
        badge("Аддон", addonOpen, addonOpen ? "сейчас" : addonUpcoming ? `на перерыве после ${s.addonUntilLevel} ур.` : "закрыт")}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 rounded-full transition ${checked ? "bg-amber-300" : "bg-white/15"}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  );
}

function TickerEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text);
      }}
    >
      <textarea
        className={`${inputClass} min-h-20`}
        placeholder="Например: Каждую пятницу — Friday Night Tournament · Бар открыт до последнего игрока"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit" variant={text !== value ? "primary" : "default"} disabled={text === value}>
        Сохранить текст
      </Button>
    </form>
  );
}

function ModeSwitch({ mode, onChange }: { mode: TournamentMode; onChange: (m: TournamentMode) => void }) {
  const opts: { value: TournamentMode; label: string }[] = [
    { value: "players", label: "По игрокам" },
    { value: "manual", label: "Вручную" },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.04] p-1 text-sm">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-md px-3 py-1.5 ${
            mode === o.value ? "bg-amber-300 font-bold text-[#080e15]" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * До какого уровня в этом турнире открыты ребаи (re-entry) и аддоны. Меняется прямо здесь:
 * правка пресета в «Структурах» на уже загруженный турнир не влияет (у турнира своя копия).
 */
function RulesLine({
  rebuyUntilLevel,
  addonUntilLevel,
  steps,
  onSave,
}: {
  rebuyUntilLevel: number;
  addonUntilLevel: number;
  steps: Step[];
  onSave: (rebuy: number, addon: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rebuy, setRebuy] = useState(String(rebuyUntilLevel));
  const [addon, setAddon] = useState(String(addonUntilLevel));
  const off = rebuyUntilLevel === 0 && addonUntilLevel === 0;
  const text = (n: number) => (n > 0 ? `до конца ${n} ур.` : "нет");
  const addonText = addonUntilLevel > 0 ? `на перерыве после ${addonUntilLevel} ур.` : "нет";

  if (editing) {
    return (
      <div className="mb-4 space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ребаи (re-entry) до конца уровня">
            <input className={inputClass} inputMode="numeric" value={rebuy} onChange={(e) => setRebuy(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Аддон — на перерыве">
            <AddonBreakSelect steps={steps} value={Number(addon) || 0} onChange={(v) => setAddon(String(v))} />
          </Field>
        </div>
        <div className="text-xs text-slate-500">
          Ребаи: 0 — выключены, перерыв после этого уровня тоже считается. Аддон берут только на выбранном перерыве.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setEditing(false)}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(Number(rebuy) || 0, Number(addon) || 0);
              setEditing(false);
            }}
          >
            Сохранить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        off ? "border border-amber-300/30 bg-amber-300/[0.07] text-amber-200" : "bg-white/[0.03] text-slate-400"
      }`}
    >
      <div className="min-w-0 flex-1">
        {off ? (
          <>Ребаи и аддоны в этом турнире выключены — кнопок «Re-entry» и «+А» не будет.</>
        ) : (
          <>
            Ребаи: {text(rebuyUntilLevel)} · Аддон: {addonText}
          </>
        )}
      </div>
      <Button variant={off ? "primary" : "ghost"} onClick={() => setEditing(true)}>
        {off ? "Включить" : "Изменить"}
      </Button>
    </div>
  );
}
