"use client";

// Игроки текущего турнира: поиск/добавление, «Пришёл», re-entry, аддоны, вылет с «кто выбил», отмена.
// Списки обновляются, когда меняется турнир (updatedAt) — значит, видно и действия с другого телефона.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ParticipantView, PlayerAction, finalInfo } from "@/lib/db/tournament";
import { debtWarning, formatRub, type CashSummary, type PayMethod } from "@/lib/cash";
import { formatEloDelta } from "@/lib/rating/elo";
import { formatPlace } from "@/lib/results";
import { phoneTail, searchPlayers, type Player } from "@/lib/players";
import { formatSeat, MAX_SEATS, MAX_TABLES } from "@/lib/seating";
import type { Tournament } from "@/lib/types";
import { CashLine, CashPanel, EnterButtons, OldDebtBadge, OldDebtsPanel, PayBadge } from "./Cash";
import { ReportBlock } from "./Report";
import { Button, inputClass } from "./ui";

type FinalInfo = ReturnType<typeof finalInfo>;

type Props = {
  tournament: Tournament;
  rebuyOpen: boolean;
  addonOpen: boolean;
  /** Обновить состояние турнира после действия (счётчики, табло) */
  onChanged: () => void;
};

export function TournamentPlayers({ tournament, rebuyOpen, addonOpen, onChanged }: Props) {
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  /** Финал ли это и по каким закрытым периодам можно сделать финал */
  const [final, setFinal] = useState<FinalInfo | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  /** Долги игроков по всем турнирам — видно уже при поиске */
  const [debts, setDebts] = useState<Record<number, number>>({});
  const [query, setQuery] = useState("");
  const [newPlayer, setNewPlayer] = useState<{ name: string; phone: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Кого сейчас выбивают (открыт экран вылета) */
  const [bustOf, setBustOf] = useState<ParticipantView | null>(null);
  /** Открыт экран дила (места оставшихся расставляются вручную) */
  const [dealOpen, setDealOpen] = useState(false);
  /** У кого открыт выбор стола и места */
  const [seatOf, setSeatOf] = useState<number | null>(null);
  /** У кого открыто окно оплаты; итог кассы турнира */
  const [cashOf, setCashOf] = useState<number | null>(null);
  /** У кого открыт долг с прошлых турниров */
  const [oldDebtOf, setOldDebtOf] = useState<number | null>(null);
  const [cashSummary, setCashSummary] = useState<CashSummary | null>(null);
  /** Есть цена входа — показываем «Пришёл + оплатил» */
  const withPay = (tournament.structure?.prices?.entry ?? 0) > 0;
  const enter = (target: { participantId: number } | { playerId: number }, pay?: PayMethod) =>
    act({ type: "enter", ...target, ...(pay ? { pay } : {}) });

  /** Плашка оплаты и окно оплаты под строкой игрока */
  const cashable = (p: ParticipantView) => ({
    badge: (
      <div className="flex flex-wrap gap-1">
        <PayBadge cash={p.cash} open={cashOf === p.id} onClick={() => setCashOf(cashOf === p.id ? null : p.id)} />
        <OldDebtBadge debts={p.oldDebts} open={oldDebtOf === p.id} onClick={() => setOldDebtOf(oldDebtOf === p.id ? null : p.id)} />
      </div>
    ),
    cashPanel: (
      <>
        {oldDebtOf === p.id && (
          <OldDebtsPanel
            debts={p.oldDebts}
            busy={busy}
            onPay={(tournamentId, amount, method) => act({ type: "pay", participantId: p.id, amount, method, tournamentId })}
          />
        )}
        {cashOf === p.id && (
        <CashPanel
          key={`${p.cash.debt}-${p.cash.payments.length}`}
          name={p.name}
          cash={p.cash}
          busy={busy}
          onPay={(amount, method) => act({ type: "pay", participantId: p.id, amount, method })}
          onCancelPayment={(paymentId) => act({ type: "cancelPayment", paymentId })}
          onSetFree={(eventId, free) => act({ type: "setFree", eventId, free })}
          />
        )}
      </>
    ),
  });

  /** Строка игрока с выбором стола по нажатию на имя */
  const seatable = (p: ParticipantView) => ({
    onPick: () => setSeatOf(seatOf === p.id ? null : p.id),
    seatEditor:
      seatOf === p.id ? (
        <SeatEditor
          p={p}
          others={participants.filter((o) => o.id !== p.id && o.status !== "busted")}
          busy={busy}
          onSeat={async (tableNo, seatNo) => {
            if (await act({ type: "seat", participantId: p.id, tableNo, seatNo })) setSeatOf(null);
          }}
        />
      ) : null,
  });
  /** Подсказка после действия с кнопкой «Отменить» (10 секунд) */
  const [toast, setToast] = useState<{ message: string; undoEventId: number | null } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, undoEventId: number | null) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message ? { message, undoEventId } : null);
    toastTimer.current = setTimeout(() => setToast(null), 10_000);
  }

  const loadParticipants = useCallback(async () => {
    const res = await fetch("/api/tournament/players", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setParticipants(data.participants);
      setFinal(data.final ?? null);
      setCashSummary(data.cash ?? null);
    }
    else setError(data.error ?? "Не удалось загрузить участников");
  }, []);

  const loadPlayers = useCallback(async () => {
    const res = await fetch("/api/players", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setPlayers(data.players);
      setDebts(data.debts ?? {});
    }
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
      showToast(data.message ?? "", action.type === "cancel" ? null : (data.undoEventId ?? null));
      onChanged();
      await loadParticipants();
      return true;
    } finally {
      setBusy(false);
    }
  }

  /** Завершить турнир; если кто-то не доплатил — предупредить (завершить всё равно можно) */
  async function finish(dealOrder?: number[]) {
    const warning = debtWarning(cashSummary);
    if (warning && !window.confirm(`${warning}\n\nЗавершить турнир?`)) return false;
    return act(dealOrder ? { type: "finish", dealOrder } : { type: "finish" });
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
      {toast && (
        <div className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-white/10 bg-[#16212d] px-4 py-3 shadow-2xl lg:bottom-6">
          <div className="min-w-0 flex-1 text-sm">{toast.message}</div>
          {toast.undoEventId != null && (
            <Button
              variant="ghost"
              className="text-amber-300"
              disabled={busy}
              onClick={() => act({ type: "cancel", eventId: toast.undoEventId! })}
            >
              Отменить
            </Button>
          )}
        </div>
      )}

      {bustOf && (
        <BustPanel
          first={bustOf}
          playing={playing}
          busy={busy}
          onCancel={() => setBustOf(null)}
          onSubmit={async (action) => {
            if (await act(action)) setBustOf(null);
          }}
        />
      )}

      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="В игре" value={tournament.playersLeft} />
        <Stat label="Игроков" value={tournament.entries} />
        <Stat label="Re-entry" value={tournament.rebuys} />
        <Stat label="Аддоны" value={tournament.addons + tournament.doubleAddons} />
      </div>

      {cashSummary && <CashLine summary={cashSummary} />}

      {final && !finished && (
        <FinalBlock
          final={final}
          canChange={tournament.status === "idle" && participants.every((p) => p.status === "registered")}
          busy={busy}
          onSet={(periodId) => act({ type: "setFinal", periodId })}
          onRegisterAll={() => act({ type: "registerFinalists" })}
        />
      )}

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
                      <div className="text-xs text-slate-500">
                        {phoneTail(pl.phone)}
                        {debts[pl.id] > 0 && <span className="font-semibold text-red-300"> · долг {formatRub(debts[pl.id])}</span>}
                      </div>
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
                        <EnterButtons
                          busy={busy}
                          withPay={withPay}
                          onEnter={async (pay) => (await enter({ playerId: pl.id }, pay)) && setQuery("")}
                        />
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

      {finished && (
        <Section title="Итоги турнира">
          <div className="py-2">
            <ReportBlock remind />
          </div>
          {participants
            .filter((p) => p.status !== "registered")
            .map((p) => (
              <Row key={p.id} p={p} place {...cashable(p)} />
            ))}
          <a href="/admin/history" className="block py-3 text-sm text-amber-300 hover:underline">
            Открыть в истории — там можно исправить итоги →
          </a>
        </Section>
      )}

      {!finished && registered.length > 0 && (
        <Section title={`Записались · ${registered.length}`}>
          {registered.map((p) => (
            <Row key={p.id} p={p} {...seatable(p)} {...cashable(p)}>
              <Button variant="ghost" title="Убрать из записи" disabled={busy} onClick={() => act({ type: "unregister", participantId: p.id })}>
                ✕
              </Button>
              {!finished && <EnterButtons busy={busy} withPay={withPay} onEnter={(pay) => enter({ participantId: p.id }, pay)} />}
            </Row>
          ))}
        </Section>
      )}

      {!finished && (
        <Section title={`В игре · ${playing.length}`}>
          {playing.length === 0 && <div className="py-3 text-sm text-slate-500">Пока никого. Найдите игрока выше и нажмите «Пришёл».</div>}
          {!finished && playing.length === 1 && busted.length > 0 && (
            <div className="py-2">
              <Button variant="primary" className="w-full py-3" disabled={busy} onClick={() => finish()}>
                Завершить турнир — победитель {playing[0].name}
              </Button>
            </div>
          )}
          {!finished && playing.length > 1 && busted.length > 0 && !dealOpen && (
            <div className="py-2 text-right">
              <Button variant="ghost" disabled={busy} onClick={() => setDealOpen(true)}>
                Завершить с дилом…
              </Button>
            </div>
          )}
          {!finished && dealOpen && playing.length > 1 && (
            <DealPanel
              playing={playing}
              busy={busy}
              onCancel={() => setDealOpen(false)}
              onSubmit={async (dealOrder) => {
                if (await finish(dealOrder)) setDealOpen(false);
              }}
            />
          )}
          {playing.map((p) => (
            <Row key={p.id} p={p} {...seatable(p)} {...cashable(p)}>
              {!finished && playing.length > 1 && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    setBustOf(p);
                    setError("");
                    window.scrollTo({ top: (document.getElementById("players")?.offsetTop ?? 0) - 60, behavior: "smooth" });
                  }}
                >
                  Вылет
                </Button>
              )}
              {!finished && p.addonEventId != null && <UndoAddon p={p} busy={busy} onCancel={(eventId) => act({ type: "cancel", eventId })} />}
            {addonOpen && !finished && p.addons + p.doubleAddons === 0 && (
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
      )}

      {!finished && busted.length > 0 && (
        <Section title={`Вылетели · ${busted.length}`}>
          {busted.map((p) => (
            <Row key={p.id} p={p} place {...cashable(p)}>
              {!finished && p.addonEventId != null && <UndoAddon p={p} busy={busy} onCancel={(eventId) => act({ type: "cancel", eventId })} />}
              {p.lastBustEventId != null && !finished && (
                <Button
                  variant="ghost"
                  title="Отменить вылет"
                  disabled={busy}
                  onClick={() =>
                    window.confirm(`Отменить вылет: ${p.name}? Игрок вернётся в игру.`) &&
                    act({ type: "cancel", eventId: p.lastBustEventId! })
                  }
                >
                  ↺
                </Button>
              )}
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

function Row({
  p,
  place,
  children,
  onPick,
  seatEditor,
  badge,
  cashPanel,
}: {
  p: ParticipantView;
  place?: boolean;
  children?: React.ReactNode;
  /** Нажатие на имя — открыть выбор стола */
  onPick?: () => void;
  seatEditor?: React.ReactNode;
  /** Плашка оплаты под именем и окно оплаты */
  badge?: React.ReactNode;
  cashPanel?: React.ReactNode;
}) {
  const seat = formatSeat(p.tableNo, p.seatNo);
  const details = [
    p.status !== "busted" && seat,
    p.entries > 1 && `входов ${p.entries}`,
    p.addons > 0 && `А ${p.addons}`,
    p.doubleAddons > 0 && `2А ${p.doubleAddons}`,
    p.ko > 0 && `KO ${String(p.ko).replace(".", ",")}`,
    p.status === "busted" && p.knockedOutBy.length > 0 && `выбил ${p.knockedOutBy.join(" и ")}`,
    p.points != null && `${p.points} очк.`,
    p.eloAfter != null && `ELO ${formatEloDelta(p.eloBefore, p.eloAfter)}`,
  ].filter(Boolean);
  const info = (
    <>
      <div className="truncate font-semibold">{p.name}</div>
      <div className="truncate text-xs text-slate-500">
        {p.phoneTail}
        {details.length > 0 && ` · ${details.join(" · ")}`}
        {onPick && !seat && <span className="text-slate-600"> · стол?</span>}
      </div>
    </>
  );
  return (
    <div className="py-2">
      <div className="flex items-center gap-2">
        {place && <div className="w-9 shrink-0 text-center font-bold tabular-nums text-slate-400">{formatPlace(p)}</div>}
        <div className="min-w-0 flex-1">
          {onPick ? (
            <button type="button" className="block w-full min-w-0 text-left" onClick={onPick} title="Стол и место">
              {info}
            </button>
          ) : (
            info
          )}
          {badge}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">{children}</div>
      </div>
      {seatEditor}
      {cashPanel}
    </div>
  );
}

/** Выбор стола (1–3) и места (1–10). Занятые места других игроков — недоступны. */
function SeatEditor({
  p,
  others,
  busy,
  onSeat,
}: {
  p: ParticipantView;
  others: ParticipantView[];
  busy: boolean;
  onSeat: (tableNo: number | null, seatNo: number | null) => void;
}) {
  const [table, setTable] = useState<number | null>(p.tableNo ?? null);
  const taken = new Map(others.filter((o) => o.tableNo === table && o.seatNo != null).map((o) => [o.seatNo!, o.name]));
  const tables = Array.from({ length: MAX_TABLES }, (_, i) => i + 1);
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => i + 1);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-2">
      <div className="flex flex-wrap gap-1">
        {tables.map((n) => (
          <Button key={n} variant={table === n ? "primary" : "default"} onClick={() => setTable(n)}>
            Стол {n}
          </Button>
        ))}
        {p.tableNo != null && (
          <Button variant="ghost" disabled={busy} onClick={() => onSeat(null, null)}>
            Без стола
          </Button>
        )}
      </div>
      {table != null && (
        <>
          <div className="text-xs text-slate-500">Место за столом {table}:</div>
          <div className="grid grid-cols-5 gap-1">
            {seats.map((n) => {
              const who = taken.get(n);
              const mine = p.tableNo === table && p.seatNo === n;
              return (
                <Button
                  key={n}
                  variant={mine ? "primary" : "default"}
                  disabled={busy || !!who}
                  title={who ? `Занято: ${who}` : undefined}
                  onClick={() => onSeat(table, n)}
                >
                  {n}
                </Button>
              );
            })}
          </div>
          <Button variant="ghost" className="w-full" disabled={busy} onClick={() => onSeat(table, null)}>
            Стол {table}, место не важно
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Экран вылета: обычно два касания — «Вылет» у игрока → кто выбил.
 * Дополнительно: делёж банка (двое по 0,5 KO), несколько вылетевших в одной раздаче, без нокаута.
 */
function BustPanel({
  first,
  playing,
  busy,
  onCancel,
  onSubmit,
}: {
  first: ParticipantView;
  playing: ParticipantView[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (action: PlayerAction) => void;
}) {
  /** Вылетевшие в этой раздаче — по стеку перед раздачей, сверху больший */
  const [busted, setBusted] = useState<number[]>([first.id]);
  /** Кто из них с тем же стеком, что предыдущий (делят место) */
  const [sameAsPrev, setSameAsPrev] = useState<Set<number>>(new Set());
  const [split, setSplit] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [addingBusted, setAddingBusted] = useState(false);

  const byId = new Map(playing.map((p) => [p.id, p]));
  // сначала — игроки с того же стола, что и вылетевший
  const table = first.tableNo;
  const candidates = playing
    .filter((p) => !busted.includes(p.id))
    .sort((a, b) => Number(table != null && b.tableNo === table) - Number(table != null && a.tableNo === table));
  const left = playing.length;
  const from = left - busted.length + 1;
  const placeText = busted.length === 1 ? `${left} место` : `места ${from}–${left}`;

  function submit(knockers: number[]) {
    let order = 1;
    const list = busted.map((id, i) => {
      if (i > 0 && !sameAsPrev.has(id)) order += 1;
      return { participantId: id, handOrder: order };
    });
    onSubmit({ type: "bust", busted: list, knockers });
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...busted];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setBusted(next);
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-400/30 bg-red-500/[0.06] p-3">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">Вылет</div>
        <div className="mt-1 text-lg font-bold">{busted.map((id) => byId.get(id)?.name).join(", ")}</div>
        <div className="text-sm text-slate-400">Займёт {placeText}</div>
      </div>

      {busted.length > 1 && (
        <div className="rounded-lg bg-black/20 p-2">
          <div className="mb-1 text-xs text-slate-400">Порядок по стеку перед раздачей: сверху — больший</div>
          {busted.map((id, i) => (
            <div key={id} className="flex flex-wrap items-center gap-x-2 py-1">
              <div className="min-w-0 flex-1 basis-32 truncate font-semibold">{byId.get(id)?.name}</div>
              {i > 0 && (
                <>
                  <label className="flex items-center gap-1 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={sameAsPrev.has(id)}
                      onChange={(e) => {
                        const next = new Set(sameAsPrev);
                        if (e.target.checked) next.add(id);
                        else next.delete(id);
                        setSameAsPrev(next);
                      }}
                    />
                    стек равный
                  </label>
                  <Button variant="ghost" title="Выше" onClick={() => moveUp(i)}>
                    ↑
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                title="Убрать"
                onClick={() => setBusted(busted.filter((x) => x !== id))}
                disabled={busted.length === 1}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}

      {addingBusted ? (
        <div>
          <div className="mb-1 text-sm font-semibold">Кто ещё вылетел в этой раздаче?</div>
          <div className="divide-y divide-white/[0.06]">
            {candidates.map((p) => (
              <button
                key={p.id}
                type="button"
                className="block w-full py-3 text-left font-semibold hover:bg-white/[0.03]"
                onClick={() => {
                  setBusted([...busted, p.id]);
                  setAddingBusted(false);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <Button className="mt-2 w-full" onClick={() => setAddingBusted(false)}>
            Назад
          </Button>
        </div>
      ) : (
        <>
          <div className="text-sm font-semibold">{split ? "Кто делил банк? Выберите двоих" : "Кто выбил?"}</div>
          <div className="grid grid-cols-2 gap-2">
            {candidates.map((p) => {
              const on = picked.includes(p.id);
              return (
                <Button
                  key={p.id}
                  variant={on ? "primary" : "default"}
                  className="justify-start py-3 text-left"
                  disabled={busy}
                  onClick={() => {
                    if (!split) return submit([p.id]);
                    setPicked(on ? picked.filter((x) => x !== p.id) : [...picked, p.id].slice(-2));
                  }}
                >
                  <span className="truncate">{p.name}</span>
                  {p.tableNo != null && <span className="ml-auto shrink-0 text-xs opacity-60">ст. {p.tableNo}</span>}
                </Button>
              );
            })}
          </div>
          {split && (
            <Button variant="primary" className="w-full" disabled={busy || picked.length !== 2} onClick={() => submit(picked)}>
              Готово — по 0,5 нокаута
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-3 text-sm">
            <Button
              onClick={() => {
                setSplit(!split);
                setPicked([]);
              }}
            >
              {split ? "Выбил один" : "Делили банк"}
            </Button>
            <Button disabled={candidates.length < 2} onClick={() => setAddingBusted(true)}>
              + Ещё вылетел
            </Button>
            <Button disabled={busy} onClick={() => submit([])}>
              Без нокаута
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Отмена
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Дил на финальном столе: администратор расставляет места оставшихся (сверху — 1 место). */
function DealPanel({
  playing,
  busy,
  onCancel,
  onSubmit,
}: {
  playing: ParticipantView[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (order: number[]) => void;
}) {
  const [order, setOrder] = useState(playing.map((p) => p.id));
  const byId = new Map(playing.map((p) => [p.id, p]));
  const up = (i: number) => {
    if (i === 0) return;
    const next = [...order];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setOrder(next);
  };
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-amber-300/30 bg-amber-300/[0.05] p-3">
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Дил — места оставшихся</div>
      <div className="text-sm text-slate-400">Расставьте по договорённости: сверху — 1 место. Очки пойдут по этим местам.</div>
      {order.map((id, i) => (
        <div key={id} className="flex items-center gap-2">
          <div className="w-7 text-center font-bold tabular-nums text-amber-200">{i + 1}</div>
          <div className="min-w-0 flex-1 truncate font-semibold">{byId.get(id)?.name}</div>
          {i > 0 && (
            <Button variant="ghost" title="Выше" onClick={() => up(i)}>
              ↑
            </Button>
          )}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button onClick={onCancel}>Отмена</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => window.confirm("Завершить турнир с этими местами?") && onSubmit(order)}
        >
          Завершить
        </Button>
      </div>
    </div>
  );
}

/** Отменить аддон в любой момент — если админ отметил не тому игроку */
function UndoAddon({ p, busy, onCancel }: { p: ParticipantView; busy: boolean; onCancel: (eventId: number) => void }) {
  const what = p.doubleAddons > 0 ? "двойной аддон" : "аддон";
  return (
    <Button
      variant="ghost"
      title={`Отменить ${what}`}
      disabled={busy}
      onClick={() => window.confirm(`Отменить ${what} у игрока ${p.name}?`) && onCancel(p.addonEventId!)}
    >
      ↺ {p.doubleAddons > 0 ? "2А" : "А"}
    </Button>
  );
}

/**
 * Тип турнира: обычный или финал закрытого периода. Менять можно до старта, пока никто не вошёл.
 * В финал записываются только финалисты, re-entry нет, очки — с повышенным коэффициентом.
 */
function FinalBlock({
  final,
  canChange,
  busy,
  onSet,
  onRegisterAll,
}: {
  final: FinalInfo;
  canChange: boolean;
  busy: boolean;
  onSet: (periodId: number | null) => void;
  onRegisterAll: () => void;
}) {
  if (!final.final && final.options.length === 0) return null;
  return (
    <div
      className={`rounded-lg p-3 text-sm ${
        final.final ? "border border-amber-300/40 bg-amber-300/[0.08] text-amber-100" : "bg-white/[0.03] text-slate-400"
      }`}
    >
      {canChange ? (
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Тип турнира</span>
          <select
            className={inputClass}
            disabled={busy}
            value={final.final?.periodId ?? ""}
            onChange={(e) => onSet(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Обычный турнир</option>
            {final.final && <option value={final.final.periodId}>{final.final.label}</option>}
            {final.options.map((o) => (
              <option key={o.periodId} value={o.periodId}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        final.final && <div className="font-bold">{final.final.label}</div>
      )}
      {final.final && (
        <div className="mt-2 space-y-1">
          <div className="text-xs text-amber-200/80">Только финалисты · без re-entry · очки с коэффициентом финала</div>
          <Button variant="ghost" className="-ml-3" disabled={busy} onClick={onRegisterAll}>
            + Записать недостающих финалистов
          </Button>
        </div>
      )}
    </div>
  );
}
