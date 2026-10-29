import { describe, expect, it } from "vitest";
import { checkAction, computeResults, formatPlace, knockerShares, type CheckContext, type JournalEvent } from "./results";

// Участники: номера 1..N. Журнал пишем как в турнире — по порядку действий.
function journal() {
  const events: JournalEvent[] = [];
  let id = 0;
  const add = (e: Omit<JournalEvent, "id" | "at">) => {
    id += 1;
    const ev = { ...e, id, at: 1000 * id };
    events.push(ev);
    return ev;
  };
  return {
    events,
    enter: (...ps: number[]) => ps.forEach((p) => add({ participantId: p, type: "entry" })),
    reentry: (p: number) => add({ participantId: p, type: "reentry" }),
    addon: (p: number) => add({ participantId: p, type: "addon" }),
    doubleAddon: (p: number) => add({ participantId: p, type: "double_addon" }),
    bust: (p: number, ...by: number[]) => add({ participantId: p, type: "bust", knockers: knockerShares(by) }),
    /** Вылет нескольких в одной раздаче: busted — [[игрок, порядок по стеку], ...] */
    hand: (handId: number, busted: [number, number][], ...by: number[]) =>
      busted.map(([p, order]) => add({ participantId: p, type: "bust", handId, handOrder: order, knockers: knockerShares(by) })),
  };
}

const places = (events: JournalEvent[], finished = false) => {
  const res = computeResults(events, { finished });
  return Object.fromEntries([...res.participants.values()].map((r) => [r.participantId, formatPlace(r)]));
};

describe("места", () => {
  it("кто вылетел раньше — ниже место; победитель — 1 место после завершения", () => {
    const j = journal();
    j.enter(1, 2, 3, 4, 5);
    j.bust(5, 1); // первым вылетел — 5 место
    j.bust(3, 1);
    j.bust(4, 2);
    j.bust(2, 1);
    expect(places(j.events, true)).toEqual({ 1: "1", 2: "2", 3: "4", 4: "3", 5: "5" });
  });

  it("пока турнир идёт, у оставшихся в игре места нет, у вылетевших — уже есть", () => {
    const j = journal();
    j.enter(1, 2, 3, 4);
    j.bust(4, 1);
    expect(places(j.events)).toEqual({ 1: "", 2: "", 3: "", 4: "4" });
  });

  it("re-entry отменяет прошлое место, засчитывается последний вылет", () => {
    const j = journal();
    j.enter(1, 2, 3, 4);
    j.bust(2, 1); // временно 4 место
    j.reentry(2);
    j.bust(4, 2);
    j.bust(3, 1);
    j.bust(2, 1); // окончательно
    expect(places(j.events, true)).toEqual({ 1: "1", 2: "2", 3: "3", 4: "4" });
  });

  it("поле — разные игроки, а не входы: 4 игрока с 3 re-entry занимают места 1–4", () => {
    const j = journal();
    j.enter(1, 2, 3, 4);
    j.bust(4, 1);
    j.reentry(4);
    j.bust(4, 1);
    j.reentry(4);
    j.bust(3, 2);
    j.reentry(3);
    j.bust(4, 1);
    j.bust(3, 2);
    j.bust(2, 1);
    const res = computeResults(j.events, { finished: true });
    expect(res.fieldSize).toBe(4);
    expect(places(j.events, true)).toEqual({ 1: "1", 2: "2", 3: "3", 4: "4" });
  });

  it("двое в одной раздаче: выше тот, у кого был больший стек", () => {
    const j = journal();
    j.enter(1, 2, 3, 4, 5);
    j.hand(1, [[4, 1], [5, 2]], 1); // у 4-го стек больше
    expect(places(j.events)).toMatchObject({ 4: "4", 5: "5" });
  });

  it("двое в одной раздаче с равными стеками делят места «4–5»", () => {
    const j = journal();
    j.enter(1, 2, 3, 4, 5);
    j.hand(1, [[4, 1], [5, 1]], 1);
    const res = computeResults(j.events);
    expect(places(j.events)).toMatchObject({ 4: "4–5", 5: "4–5" });
    expect(res.participants.get(4)).toMatchObject({ place: 4, placeTo: 5 });
  });

  it("трое в одной раздаче: двое с равными стеками и один с меньшим", () => {
    const j = journal();
    j.enter(1, 2, 3, 4, 5, 6);
    j.hand(7, [[3, 1], [4, 1], [5, 2]], 1);
    // в игре остались трое (1, 2, 6) → вылетевшие занимают 4–6
    expect(places(j.events)).toMatchObject({ 3: "4–5", 4: "4–5", 5: "6" });
  });

  it("если один из той раздачи потом сделал re-entry, остальные считаются как обычно", () => {
    const j = journal();
    j.enter(1, 2, 3, 4, 5);
    j.hand(1, [[4, 1], [5, 2]], 1);
    j.reentry(4);
    expect(places(j.events)).toMatchObject({ 4: "", 5: "5" });
  });

  it("дил: при завершении в игре несколько — их места не выставляются автоматически", () => {
    const j = journal();
    j.enter(1, 2, 3, 4);
    j.bust(4, 1);
    expect(places(j.events, true)).toEqual({ 1: "", 2: "", 3: "", 4: "4" });
  });
});

describe("нокауты", () => {
  it("+1 за каждого выбитого, даже если выбивший сам вылетел позже", () => {
    const j = journal();
    j.enter(1, 2, 3, 4);
    j.bust(4, 3);
    j.bust(2, 3);
    j.bust(3, 1);
    const r = computeResults(j.events).participants;
    expect(r.get(3)!.ko).toBe(2);
    expect(r.get(1)!.ko).toBe(1);
  });

  it("выбивание игрока, который потом сделал re-entry, тоже нокаут", () => {
    const j = journal();
    j.enter(1, 2);
    j.bust(2, 1);
    j.reentry(2);
    j.bust(2, 1);
    expect(computeResults(j.events).participants.get(1)!.ko).toBe(2);
  });

  it("делёж банка — по 0,5 каждому", () => {
    const j = journal();
    j.enter(1, 2, 3);
    j.bust(3, 1, 2);
    const r = computeResults(j.events).participants;
    expect(r.get(1)!.ko).toBe(0.5);
    expect(r.get(2)!.ko).toBe(0.5);
  });

  it("один выбил двоих в одной раздаче — 2 нокаута", () => {
    const j = journal();
    j.enter(1, 2, 3);
    j.hand(1, [[2, 1], [3, 2]], 1);
    expect(computeResults(j.events).participants.get(1)!.ko).toBe(2);
  });

  it("вылет без нокаута (ушёл сам) — нокаут никому", () => {
    const j = journal();
    j.enter(1, 2);
    j.bust(2);
    expect(computeResults(j.events).participants.get(1)!.ko).toBe(0);
  });
});

describe("входы и счётчики табло", () => {
  it("считает входы, re-entry, аддоны и двойные аддоны по каждому игроку", () => {
    const j = journal();
    j.enter(1, 2, 3);
    j.bust(3, 1);
    j.reentry(3);
    j.addon(1);
    j.doubleAddon(2);
    j.addon(3);
    const res = computeResults(j.events);
    expect(res.participants.get(3)).toMatchObject({ entries: 2, reentries: 1, addons: 1, status: "playing" });
    expect(res.counters).toEqual({ entries: 3, playersLeft: 3, rebuys: 1, addons: 2, doubleAddons: 1 });
  });

  it("записавшийся, но не пришедший — не участник и не входит в поле", () => {
    const j = journal();
    j.enter(1, 2);
    const res = computeResults([...j.events]);
    expect(res.participants.get(9)).toBeUndefined();
    expect(res.fieldSize).toBe(2);
  });

  it("отменённое действие не учитывается", () => {
    const j = journal();
    j.enter(1, 2, 3);
    const b = j.bust(3, 1);
    b.cancelled = true;
    const res = computeResults(j.events);
    expect(res.participants.get(3)!.status).toBe("playing");
    expect(res.participants.get(1)!.ko).toBe(0);
    expect(res.playersLeft).toBe(3);
  });

  it("бессмысленные события пропускаются (аддон вылетевшему, двойной вылет)", () => {
    const j = journal();
    j.enter(1, 2);
    j.bust(2, 1);
    j.addon(2);
    j.bust(2, 1);
    const res = computeResults(j.events);
    expect(res.participants.get(2)).toMatchObject({ addons: 0, status: "busted" });
    expect(res.participants.get(1)!.ko).toBe(1);
  });
});

describe("проверка действий админа", () => {
  const open: CheckContext = { reentryOpen: true, addonOpen: true, isFinal: false };
  const names: Record<number, string> = { 1: "Саша", 2: "Ира", 3: "Олег" };
  const name = (id: number) => names[id] ?? `№${id}`;

  function game() {
    const j = journal();
    j.enter(1, 2, 3);
    return j;
  }

  it("вход: нельзя дважды; после закрытия регистрации — только с подтверждением", () => {
    const j = game();
    expect(checkAction(j.events, { type: "entry", participantId: 1 }, open, name)).toBe("Саша уже в турнире");
    expect(checkAction(j.events, { type: "entry", participantId: 9 }, { ...open, reentryOpen: false })).toBe("Регистрация закрыта");
    expect(checkAction(j.events, { type: "entry", participantId: 9 }, { ...open, reentryOpen: false, force: true })).toBeNull();
  });

  it("re-entry: только после вылета, в финале — никогда", () => {
    const j = game();
    expect(checkAction(j.events, { type: "reentry", participantId: 2 }, open, name)).toBe("Ира ещё в игре");
    j.bust(2, 1);
    expect(checkAction(j.events, { type: "reentry", participantId: 2 }, open, name)).toBeNull();
    expect(checkAction(j.events, { type: "reentry", participantId: 2 }, { ...open, isFinal: true }, name)).toBe("В финале re-entry нет");
    expect(checkAction(j.events, { type: "reentry", participantId: 2 }, { ...open, reentryOpen: false }, name)).toBe(
      "Регистрация закрыта",
    );
    expect(checkAction(j.events, { type: "reentry", participantId: 9 }, open, name)).toBe("№9 ещё не входил в турнир");
  });

  it("аддон: только тем, кто в игре, и пока аддоны открыты", () => {
    const j = game();
    j.bust(3, 1);
    expect(checkAction(j.events, { type: "addon", participantId: 3 }, open, name)).toBe("Олег не в игре");
    expect(checkAction(j.events, { type: "double_addon", participantId: 1 }, { ...open, addonOpen: false }, name)).toBe(
      "Аддоны закрыты",
    );
    expect(checkAction(j.events, { type: "addon", participantId: 1 }, open, name)).toBeNull();
  });

  it("вылет: кто выбил — из оставшихся в игре, не сам себя, максимум двое", () => {
    const j = game();
    const bust = (busted: number[], knockers: number[]) =>
      checkAction(j.events, { type: "bust", busted: busted.map((p) => ({ participantId: p, handOrder: 1 })), knockers }, open, name);
    expect(bust([3], [1])).toBeNull();
    expect(bust([3], [])).toBeNull(); // без нокаута
    expect(bust([3], [1, 2])).toBeNull(); // делёж банка
    expect(bust([3], [3])).toBe("Олег не может выбить сам себя");
    expect(bust([2, 3], [3])).toBe("Олег не может выбить сам себя");
    expect(bust([3], [1, 2, 9])).toBe("Выбить могут максимум двое (делёж банка)");
    expect(bust([], [1])).toBe("Не выбран вылетевший игрок");
    expect(bust([1, 2, 3], [])).toBe("Должен остаться хотя бы один игрок");
    j.bust(2, 1);
    expect(bust([2], [1])).toBe("Ира не в игре");
    expect(bust([3], [2])).toBe("Ира не в игре");
  });

  it("отмена: можно отменить последнее действие игрока, но не то, на котором держатся более поздние", () => {
    const j = game();
    const b = j.bust(3, 1);
    expect(checkAction(j.events, { type: "cancel", eventId: b.id }, open)).toBeNull();
    const r = j.reentry(3);
    expect(checkAction(j.events, { type: "cancel", eventId: b.id }, open)).toBe(
      "Сначала отмените более поздние действия этого игрока",
    );
    expect(checkAction(j.events, { type: "cancel", eventId: r.id }, open)).toBeNull();
    r.cancelled = true;
    expect(checkAction(j.events, { type: "cancel", eventId: r.id }, open)).toBe("Это действие уже отменено");
  });

  it("нельзя отменить вход игрока, который уже кого-то выбил", () => {
    const j = game();
    const entryOfSasha = j.events.find((e) => e.participantId === 1 && e.type === "entry")!;
    j.bust(3, 1);
    expect(checkAction(j.events, { type: "cancel", eventId: entryOfSasha.id }, open)).toBe(
      "Сначала отмените более поздние действия этого игрока",
    );
  });
});
