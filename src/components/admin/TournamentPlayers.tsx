"use client";

// Игроки текущего турнира: поиск/добавление, «Пришёл», re-entry, аддоны (вылеты — шаг 1.4).
// Списки обновляются, когда меняется турнир (updatedAt) — значит, видно и действия с другого телефона.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ParticipantView, PlayerAction } from "@/lib/db/tournament";
import { formatPlace } from "@/lib/results";
import { phoneTail, searchPlayers, type Player } from "@/lib/players";
import type { Tournament } from "@/lib/types";
import { Button, inputClass } from "./ui";

type Props = {
  tournament: Tournament;
  rebuyOpen: boolean;
  addonOpen: boolean;
  /** Обновить состояние турнира после действия (счётчики, табло) */
  onChanged: () => void;
};

export function TournamentPlayers({ tournament, rebuyOpen, addonOpen, onChanged }: Props) {
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [query, setQuery] = useState("");
  const [newPlayer, setNewPlayer] = useState<{ name: string; phone: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadParticipants = useCallback(async () => {
    const res = await fetch("/api/tournament/players", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setParticipants(data.participants);
    else setError(data.error ?? "Не удалось загрузить участников");
  }, []);

  const loadPlayers = useCallback(async () => {
    const res = await fetch("/api/players", { cache: "no-store" });
    if (res.ok) setPlayers((await res.json()).players);
  }, []);

  // при каждом изменении турнира (в т.ч. с другого устройства) — свежий список участников
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadParticipants();
  }, [loadParticipants, tournament.updatedAt]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPlayers();
  }, [loadPlayers]);

  async function act(action: PlayerAction): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      let res = await post(action);
      let data = await res.json();
      if (res.status === 409 && data.needsForce) {
        if (!window.confirm(`${data.error}. Всё равно?`)) return false;
        res = await post({ ...action, force: true } as PlayerAction);
        data = await res.json();
      }
      if (!res.ok) {
        setError(data.error ?? "Ошибка");
        return false;
      }
      onChanged();
      await loadParticipants();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function createAndThen(kind: "register" | "enter") {
    if (!newPlayer) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPlayer),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Не удалось добавить игрока");
      return;
    }
    const player = data.player as Player;
    setNewPlayer(null);
    setQuery("");
    await loadPlayers();
    await act(kind === "enter" ? { type: "enter", playerId: player.id } : { type: "register", playerId: player.id });
  }

  const inTournament = useMemo(() => new Map(participants.map((p) => [p.playerId, p])), [participants]);
  const found = useMemo(() => (query.trim() ? searchPlayers(players, query, 8) : []), [players, query]);

  const registered = participants.filter((p) => p.status === "registered");
  const playing = participants.filter((p) => p.status === "playing");
  const busted = participants.filter((p) => p.status === "busted");
  const finished = tournament.status === "finished";

  function startNew() {
    const q = query.trim();
    const isPhone = /^[\d\s()+-]+$/.test(q) && q.replace(/\D/g, "").length >= 10;
    setNewPlayer({ name: isPhone ? "" : q, phone: isPhone ? q : "" });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="В игре" value={tournament.playersLeft} />
        <Stat label="Игроков" value={tournament.entries} />
        <Stat label="Re-entry" value={tournament.rebuys} />
        <Stat label="Аддоны" value={tournament.addons + tournament.doubleAddons} />
      </div>

      {/* Поиск и добавление */}
      {!finished && (
        <div>
          <input
            className={inputClass}
            placeholder="Найти или добавить игрока"
            value={query}
            enterKeyHint="search"
            onChange={(e) => {
              setQuery(e.target.value);
              setNewPlayer(null);
            }}
          />
          {query.trim() && !newPlayer && (
            <div className="mt-2 divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
              {found.map((pl) => {
                const p = inTournament.get(pl.id);
                return (
                  <div key={pl.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{pl.name}</div>
                      <div className="text-xs text-slate-500">{phoneTail(pl.phone)}</div>
                    </div>
                    {p && p.status !== "registered" ? (
                      <span className="text-xs text-slate-500">{p.status === "playing" ? "в игре" : "вылетел"}</span>
                    ) : (
                      <>
                        {!p && (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={async () => (await act({ type: "register", playerId: pl.id })) && setQuery("")}
                          >
                            Записать
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={async () => (await act({ type: "enter", playerId: pl.id })) && setQuery("")}
                        >
                          Пришёл
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="block w-full px-3 py-3 text-left text-sm text-amber-300 hover:bg-white/[0.03]"
                onClick={startNew}
              >
                + Новый игрок «{query.trim()}»
              </button>
            </div>
          )}
          {newPlayer && (
            <div className="mt-2 space-y-2 rounded-lg border border-amber-300/30 bg-amber-300/[0.04] p-3">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Новый игрок</div>
              <input
                className={inputClass}
                placeholder="Имя или ник"
                value={newPlayer.name}
                autoFocus={!newPlayer.name}
                onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Телефон"
                type="tel"
                inputMode="tel"
                value={newPlayer.phone}
                autoFocus={!!newPlayer.name}
                onChange={(e) => setNewPlayer({ ...newPlayer, phone: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-2">
                <Button onClick={() => setNewPlayer(null)}>Отмена</Button>
                <Button disabled={busy || !newPlayer.name.trim() || !newPlayer.phone.trim()} onClick={() => createAndThen("register")}>
                  Записать
                </Button>
                <Button
                  variant="primary"
                  disabled={busy || !newPlayer.name.trim() || !newPlayer.phone.trim()}
                  onClick={() => createAndThen("enter")}
                >
                  Пришёл
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {registered.length > 0 && (
        <Section title={`Записались · ${registered.length}`}>
          {registered.map((p) => (
            <Row key={p.id} p={p}>
              <Button variant="ghost" title="Убрать из записи" disabled={busy} onClick={() => act({ type: "unregister", participantId: p.id })}>
                ✕
              </Button>
              {!finished && (
                <Button variant="primary" disabled={busy} onClick={() => act({ type: "enter", participantId: p.id })}>
                  Пришёл
                </Button>
              )}
            </Row>
          ))}
        </Section>
      )}

      <Section title={`В игре · ${playing.length}`}>
        {playing.length === 0 && <div className="py-3 text-sm text-slate-500">Пока никого. Найдите игрока выше и нажмите «Пришёл».</div>}
        {playing.map((p) => (
          <Row key={p.id} p={p}>
            {addonOpen && !finished && (
              <>
                <Button disabled={busy} onClick={() => act({ type: "addon", participantId: p.id })} title="Аддон">
                  +А
                </Button>
                <Button disabled={busy} onClick={() => act({ type: "double_addon", participantId: p.id })} title="Двойной аддон">
                  +2А
                </Button>
              </>
            )}
          </Row>
        ))}
      </Section>

      {busted.length > 0 && (
        <Section title={`Вылетели · ${busted.length}`}>
          {busted.map((p) => (
            <Row key={p.id} p={p} place>
              {rebuyOpen && !finished && (
                <Button disabled={busy} onClick={() => act({ type: "reentry", participantId: p.id })}>
                  Re-entry
                </Button>
              )}
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function post(action: PlayerAction) {
  return fetch("/api/tournament/players", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-1 py-2">
      <div className="text-xl font-black tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{title}</div>
      <div className="divide-y divide-white/[0.06]">{children}</div>
    </div>
  );
}

function Row({ p, place, children }: { p: ParticipantView; place?: boolean; children?: React.ReactNode }) {
  const details = [
    p.entries > 1 && `входов ${p.entries}`,
    p.addons > 0 && `А ${p.addons}`,
    p.doubleAddons > 0 && `2А ${p.doubleAddons}`,
    p.ko > 0 && `KO ${String(p.ko).replace(".", ",")}`,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2 py-2">
      {place && <div className="w-9 shrink-0 text-center font-bold tabular-nums text-slate-400">{formatPlace(p)}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{p.name}</div>
        <div className="truncate text-xs text-slate-500">
          {p.phoneTail}
          {details.length > 0 && ` · ${details.join(" · ")}`}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
  );
}
