"use client";

// Записавшиеся на турнир в расписании админки (docs/SITE.md, шаг 4): кто идёт, кто с гостями, лист ожидания;
// админ может записать игрока из базы и снять любую запись.

import { useState } from "react";
import type { AdminSignup } from "@/lib/db/signups";
import { searchPlayers, type Player } from "@/lib/players";
import { MAX_GUESTS } from "@/lib/signup";
import { PasteList } from "./PasteList";
import { Button, inputClass } from "./ui";

export function ScheduleSignups({
  scheduleId,
  title,
  onImported,
  signups,
  seatLimit,
  players,
  busy,
  onAdd,
  onRemove,
}: {
  scheduleId: number;
  title: string;
  /** Список из Google-таблицы записан — обновить расписание */
  onImported: (message: string) => void;
  signups: AdminSignup[];
  seatLimit: number | null;
  players: Player[];
  busy: boolean;
  onAdd: (playerId: number, guests: number) => void;
  onRemove: (s: AdminSignup) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [guests, setGuests] = useState(0);

  const going = signups.filter((s) => s.state === "going");
  const waiting = signups.filter((s) => s.state === "waiting");
  const seats = going.reduce((n, s) => n + 1 + s.guests, 0);
  const taken = new Set(signups.map((s) => s.playerId));
  const found = query.trim() ? searchPlayers(players, query, 6).filter((p) => !taken.has(p.id)) : [];

  const row = (s: AdminSignup) => (
    <div key={s.id} className="flex items-center gap-2 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{s.name}</span>
        {s.guests > 0 && (
          <span className="ml-2 rounded-md bg-amber-300/15 px-1.5 py-0.5 text-xs font-bold text-amber-300">
            +{s.guests}
            {s.guestNames.length > 0 && `: ${s.guestNames.join(", ")}`}
          </span>
        )}
        {s.playerId == null && <span className="ml-2 text-xs text-amber-200">заявка на вход не подтверждена</span>}
        {s.byAdmin && <span className="ml-2 text-xs text-slate-500">записал админ</span>}
      </div>
      <Button variant="ghost" disabled={busy} onClick={() => onRemove(s)}>
        Снять
      </Button>
    </div>
  );

  return (
    <div className="basis-full">
      <button type="button" onClick={() => setOpen(!open)} className="text-sm text-slate-300 hover:text-amber-200">
        {signups.length === 0 ? "Записей нет" : `Записалось: ${going.length}${seats > going.length ? ` (с гостями ${seats})` : ""}`}
        {seatLimit != null && ` из ${seatLimit} мест`}
        {waiting.length > 0 && ` · в ожидании ${waiting.length}`} {open ? "↑" : "↓"}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
          {going.length > 0 && <div className="divide-y divide-white/[0.06]">{going.map(row)}</div>}
          {waiting.length > 0 && (
            <>
              <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">Лист ожидания</div>
              <div className="divide-y divide-white/[0.06]">{waiting.map(row)}</div>
            </>
          )}
          <div className="mt-3 border-t border-white/[0.07] pt-3">
            <div className="flex flex-wrap gap-2">
              <input className={`${inputClass} min-w-0 flex-1 basis-40`} placeholder="Записать игрока: имя или цифры телефона" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select className={`${inputClass} w-auto`} value={guests} onChange={(e) => setGuests(Number(e.target.value))} aria-label="Гостей">
                {Array.from({ length: MAX_GUESTS + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "один" : `+${n} гостя`}
                  </option>
                ))}
              </select>
            </div>
            {found.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                className="mt-1 block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-white/[0.06]"
                onClick={() => {
                  onAdd(p.id, guests);
                  setQuery("");
                  setGuests(0);
                }}
              >
                + {p.name}
              </button>
            ))}
            {query.trim() && found.length === 0 && <div className="mt-2 text-sm text-slate-500">Никого не нашлось (или игрок уже записан).</div>}
            <div className="mt-2">
              <PasteList target={{ kind: "schedule", id: scheduleId }} title={title} onDone={onImported} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
