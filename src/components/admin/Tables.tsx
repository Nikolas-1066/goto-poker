"use client";

// Экран «Столы» (рассадка): столы как в онлайн-покере — зелёный овал, вокруг места с именем,
// стеком и нокаутами. Нажатие на игрока — меню действий (вылет, аддон, пересадить, стек, оплата).
// Сверху — подсказки «Закройте стол» / «Пересадите» (после старта) и игроки без места.

import { useState, type ReactNode } from "react";
import type { ParticipantView, PlayerAction } from "@/lib/db/tournament";
import {
  MAX_SEATS,
  MAX_TABLES,
  playersCount,
  seatingHint,
  shortChips,
  type SeatingHint,
  type SeatingSettings,
} from "@/lib/seating";
import { Button, inputClass } from "./ui";

type Props = {
  /** Все участники, кроме вылетевших (записавшиеся с местом тоже видны за столом) */
  people: ParticipantView[];
  seating: SeatingSettings;
  addonOpen: boolean;
  canBust: boolean;
  busy: boolean;
  act: (action: PlayerAction) => Promise<boolean>;
  onBust: (p: ParticipantView) => void;
  onEnter: (p: ParticipantView) => void;
  /** Окно оплаты игрока (то же, что в списке) */
  cashPanel: (p: ParticipantView) => ReactNode;
  onToggleCash: (p: ParticipantView) => void;
};

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "игрок" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "игрока" : "игроков");

export function TablesView({ people, seating, addonOpen, canBust, busy, act, onBust, onEnter, cashPanel, onToggleCash }: Props) {
  const seated = people.filter((p) => p.tableNo != null && p.seatNo != null);
  const playingSeated = seated.filter((p) => p.status === "playing");
  const unseated = people.filter((p) => p.status === "playing" && (p.tableNo == null || p.seatNo == null));
  const count = (t: number) => playingSeated.filter((p) => p.tableNo === t).length;
  const firstWithPlayers = [1, 2, 3].find((t) => count(t) > 0) ?? 1;
  const [table, setTable] = useState<number | null>(null);
  const current = table ?? firstWithPlayers;
  const [selected, setSelected] = useState<number | null>(null);
  /** Пересадка: выбран игрок — следующим нажатием на свободное место (на любом столе) */
  const [moving, setMoving] = useState<number | null>(null);

  // подсказка — и до старта: стол 1 заполнен, пришедшего посадили за стол 2 → «пересадите N за стол 2»
  const hint: SeatingHint | null = seatingHint(
    playingSeated.map((p) => ({ tableNo: p.tableNo! })),
    seating.seatsPerTable,
  );

  const sel = people.find((p) => p.id === selected) ?? null;
  const mover = people.find((p) => p.id === moving) ?? null;

  async function moveTo(seatNo: number) {
    if (!mover) return;
    if (await act({ type: "seat", participantId: mover.id, tableNo: current, seatNo })) {
      setMoving(null);
      setSelected(mover.id);
    }
  }

  return (
    <div className="space-y-3">
      {hint && <HintBox hint={hint} />}

      {unseated.length > 0 && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2 text-sm">
          <div className="mb-1 text-xs text-slate-400">
            Без места: {unseated.length} {plural(unseated.length)}
          </div>
          <div className="flex flex-wrap gap-1">
            {unseated.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-lg bg-black/20 py-1 pl-2 pr-1">
                <span className="max-w-[9rem] truncate font-semibold">{p.name}</span>
                <Button variant="ghost" disabled={busy} onClick={() => act({ type: "autoSeat", participantId: p.id })} title="Посадить автоматически">
                  Посадить
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setMoving(p.id);
                    setSelected(null);
                  }}
                  title="Выбрать место на схеме"
                >
                  ✋
                </Button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* вкладки столов */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.03] p-1">
        {Array.from({ length: MAX_TABLES }, (_, i) => i + 1).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTable(t)}
            className={`rounded-lg px-2 py-2 text-sm ${
              current === t ? "bg-amber-300 font-bold text-[#080e15]" : count(t) ? "text-slate-200" : "text-slate-500"
            }`}
          >
            Стол {t} · {count(t)}
          </button>
        ))}
      </div>

      {mover && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-300/[0.08] px-3 py-2 text-sm text-amber-100">
          <span className="min-w-0 flex-1">
            Пересадка: <b>{mover.name}</b> — нажмите на свободное место (можно переключить стол)
          </span>
          <Button variant="ghost" onClick={() => setMoving(null)}>
            Отмена
          </Button>
        </div>
      )}

      <TableFelt
        tableNo={current}
        seats={Math.max(seating.seatsPerTable, ...seated.filter((p) => p.tableNo === current).map((p) => p.seatNo!))}
        people={seated.filter((p) => p.tableNo === current)}
        selectedId={selected}
        moving={!!mover}
        onPlayer={(p) => {
          setMoving(null);
          setSelected(selected === p.id ? null : p.id);
        }}
        onFreeSeat={moveTo}
      />

      {sel && !mover && (
        <PlayerMenu
          key={sel.id}
          p={sel}
          addonOpen={addonOpen}
          canBust={canBust}
          busy={busy}
          act={act}
          onBust={() => onBust(sel)}
          onEnter={() => onEnter(sel)}
          onMove={() => {
            setMoving(sel.id);
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
          cash={cashPanel(sel)}
          onToggleCash={() => onToggleCash(sel)}
        />
      )}
    </div>
  );
}

/** Подсказка «Закройте стол» / «Пересадите»: сколько игроков с какого стола за какой. Кого — решает админ. */
function HintBox({ hint }: { hint: SeatingHint }) {
  return (
    <div className="rounded-lg border border-amber-300/40 bg-amber-300/[0.08] p-3 text-sm text-amber-100">
      <div className="font-bold text-amber-300">
        {hint.kind === "close" ? `Можно закрыть стол ${hint.tableNo} — пересадите:` : "За столами неровно — пересадите:"}
      </div>
      <ul className="mt-1 space-y-0.5">
        {hint.moves.map((m) => (
          <li key={`${m.from}-${m.to}`} className="tabular-nums">
            со стола {m.from} за стол {m.to} — <b>{playersCount(m.count)}</b>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-xs text-amber-100/60">Нажмите на игрока → «Пересадить» → свободное место.</div>
    </div>
  );
}

/** Позиция места на овале: место 1 — внизу по центру, дальше по часовой стрелке */
function seatPos(i: number, n: number) {
  const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { left: `${50 + 43 * Math.cos(a)}%`, top: `${50 + 40 * Math.sin(a)}%` };
}

function TableFelt({
  tableNo,
  seats,
  people,
  selectedId,
  moving,
  onPlayer,
  onFreeSeat,
}: {
  tableNo: number;
  seats: number;
  people: ParticipantView[];
  selectedId: number | null;
  moving: boolean;
  onPlayer: (p: ParticipantView) => void;
  onFreeSeat: (seatNo: number) => void;
}) {
  const bySeat = new Map(people.map((p) => [p.seatNo!, p]));
  const playing = people.filter((p) => p.status === "playing");
  const avg = playing.length ? Math.round(playing.reduce((s, p) => s + p.stack.value, 0) / playing.length) : 0;
  const n = Math.min(MAX_SEATS, Math.max(2, seats));

  return (
    <div className="relative mx-auto aspect-[4/3] w-full max-w-xl sm:aspect-[16/10]">
      {/* борт и сукно */}
      <div className="absolute inset-x-[11%] inset-y-[15%] rounded-[50%] border-[10px] border-[#3b2a1a] bg-[radial-gradient(ellipse_at_center,#1f7a4d_0%,#13573a_60%,#0d3f2a_100%)] shadow-[inset_0_0_30px_rgba(0,0,0,0.5),0_10px_30px_rgba(0,0,0,0.5)]" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-100/70">Стол {tableNo}</div>
        <div className="text-2xl font-black tabular-nums text-white/90">
          {playing.length}
          <span className="text-base text-white/50"> / {n}</span>
        </div>
        {avg > 0 && <div className="text-[11px] text-emerald-100/70">средний {shortChips(avg)}</div>}
      </div>

      {Array.from({ length: n }, (_, i) => i + 1).map((seatNo) => {
        const p = bySeat.get(seatNo);
        const pos = seatPos(seatNo - 1, n);
        if (!p) {
          return (
            <button
              key={seatNo}
              type="button"
              disabled={!moving}
              onClick={() => onFreeSeat(seatNo)}
              style={pos}
              className={`absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed text-xs tabular-nums sm:h-12 sm:w-12 ${
                moving ? "animate-pulse border-amber-300 bg-amber-300/20 font-bold text-amber-200" : "border-white/15 text-white/30"
              }`}
              title={moving ? `Пересадить на место ${seatNo}` : `Место ${seatNo} свободно`}
            >
              {seatNo}
            </button>
          );
        }
        const registered = p.status === "registered";
        const active = selectedId === p.id;
        return (
          <button
            key={seatNo}
            type="button"
            onClick={() => onPlayer(p)}
            style={pos}
            className={`absolute w-[4.6rem] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-1 py-1 text-center shadow-lg sm:w-24 ${
              active ? "border-amber-300 bg-[#2a2310]" : registered ? "border-white/10 bg-[#101923]/80 opacity-60" : "border-white/15 bg-[#101923]"
            }`}
          >
            <span className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[9px] font-bold tabular-nums text-slate-300">
              {seatNo}
            </span>
            <div className="truncate text-[11px] font-bold leading-tight sm:text-xs">{p.name}</div>
            {registered ? (
              <div className="text-[10px] leading-tight text-slate-500">записан</div>
            ) : (
              <>
                <div className={`text-[11px] font-semibold tabular-nums leading-tight ${p.stack.counted ? "text-white" : "text-slate-400"}`}>
                  {shortChips(p.stack.value)}
                </div>
                <div className="flex justify-center gap-1 text-[9px] font-bold leading-tight">
                  {p.ko > 0 && <span className="text-amber-300">KO {String(p.ko).replace(".", ",")}</span>}
                  {p.reentries > 0 && <span className="text-sky-300">RE{p.reentries > 1 ? p.reentries : ""}</span>}
                  {p.addons + p.doubleAddons > 0 && <span className="text-emerald-300">{p.doubleAddons ? "2А" : "А"}</span>}
                </div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

const time = (ts: number) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Меню игрока за столом */
function PlayerMenu({
  p,
  addonOpen,
  canBust,
  busy,
  act,
  onBust,
  onEnter,
  onMove,
  onClose,
  cash,
  onToggleCash,
}: {
  p: ParticipantView;
  addonOpen: boolean;
  canBust: boolean;
  busy: boolean;
  act: (action: PlayerAction) => Promise<boolean>;
  onBust: () => void;
  onEnter: () => void;
  onMove: () => void;
  onClose: () => void;
  cash: ReactNode;
  onToggleCash: () => void;
}) {
  const [editStack, setEditStack] = useState(false);
  const [stack, setStack] = useState(String(p.stack.value || ""));
  const registered = p.status === "registered";

  return (
    <div className="space-y-2 rounded-xl border border-amber-300/30 bg-[#101923] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold">{p.name}</div>
          <div className="text-xs text-slate-400">
            Стол {p.tableNo}, место {p.seatNo}
            {!registered && (
              <>
                {" · стек "}
                <b className="tabular-nums text-slate-200">{p.stack.value.toLocaleString("ru-RU")}</b>
                {p.stack.counted && p.stack.countedAt ? ` (посчитано в ${time(p.stack.countedAt)})` : " (расчётный)"}
                {p.ko > 0 && ` · KO ${String(p.ko).replace(".", ",")}`}
                {p.entries > 1 && ` · входов ${p.entries}`}
              </>
            )}
          </div>
        </div>
        <Button variant="ghost" onClick={onClose} title="Закрыть">
          ✕
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {registered ? (
          <Button variant="primary" disabled={busy} onClick={onEnter}>
            Пришёл
          </Button>
        ) : (
          <>
            {canBust && (
              <Button variant="danger" disabled={busy} onClick={onBust}>
                Вылет
              </Button>
            )}
            {addonOpen && p.addons + p.doubleAddons === 0 && (
              <>
                <Button disabled={busy} onClick={() => act({ type: "addon", participantId: p.id })}>
                  +А аддон
                </Button>
                <Button disabled={busy} onClick={() => act({ type: "double_addon", participantId: p.id })}>
                  +2А двойной
                </Button>
              </>
            )}
            <Button disabled={busy} onClick={() => setEditStack(!editStack)}>
              Стек
            </Button>
            <Button disabled={busy} onClick={onToggleCash}>
              Оплата
            </Button>
          </>
        )}
        <Button disabled={busy} onClick={onMove}>
          Пересадить
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => act({ type: "seat", participantId: p.id, tableNo: null, seatNo: null })}>
          Встать из-за стола
        </Button>
      </div>

      {editStack && (
        <form
          className="space-y-2 rounded-lg bg-black/20 p-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act({ type: "setStack", participantId: p.id, stack: Number(stack.replace(/\D/g, "")) || 0 })) setEditStack(false);
          }}
        >
          <div className="text-xs text-slate-400">Сколько фишек сейчас у игрока (посчитали):</div>
          <div className="flex gap-2">
            <input
              className={inputClass}
              inputMode="numeric"
              autoFocus
              value={stack}
              onChange={(e) => setStack(e.target.value.replace(/\D/g, ""))}
            />
            <Button type="submit" variant="primary" disabled={busy || !stack}>
              Сохранить
            </Button>
          </div>
          {p.stack.counted && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => (await act({ type: "setStack", participantId: p.id, stack: null })) && setEditStack(false)}
            >
              Снова считать автоматически
            </Button>
          )}
        </form>
      )}

      {cash}
    </div>
  );
}

/** Строка «Столы: по 10 мест · автопосадка вкл» с правкой (настройка клуба, общая для турниров) */
export function SeatingLine({ seating, busy, act }: { seating: SeatingSettings; busy: boolean; act: (a: PlayerAction) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-slate-400">
        <div className="min-w-0 flex-1">
          Столы: по {seating.seatsPerTable} мест · автопосадка {seating.autoSeat ? "вкл" : "выкл"}
        </div>
        <Button variant="ghost" onClick={() => setEditing(true)}>
          Изменить
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-3 text-sm">
      <div className="text-xs text-slate-400">Мест за столом (сначала заполняется стол 1, потом 2 и 3):</div>
      <div className="grid grid-cols-5 gap-1">
        {[6, 7, 8, 9, 10].map((n) => (
          <Button key={n} variant={seating.seatsPerTable === n ? "primary" : "default"} disabled={busy} onClick={() => act({ type: "setSeating", seatsPerTable: n })}>
            {n}
          </Button>
        ))}
      </div>
      <label className="flex items-center gap-2 py-1">
        <input
          type="checkbox"
          className="h-5 w-5 accent-amber-300"
          checked={seating.autoSeat}
          disabled={busy}
          onChange={(e) => act({ type: "setSeating", autoSeat: e.target.checked })}
        />
        <span>Автопосадка при «Пришёл» и re-entry (случайное свободное место)</span>
      </label>
      <Button className="w-full" onClick={() => setEditing(false)}>
        Готово
      </Button>
    </div>
  );
}
