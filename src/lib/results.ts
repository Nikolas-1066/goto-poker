// Итоги турнира по журналу событий (таблица events + knockouts в базе).
// Чистые функции: места, входы, нокауты, счётчики табло и проверка действий админа.
// Правила — docs/RATING.md, разделы 1, 6 и 7а.

export type EventType = "entry" | "reentry" | "addon" | "double_addon" | "bust";

export type Knocker = { participantId: number; share: number };

export type JournalEvent = {
  id: number;
  participantId: number;
  type: EventType;
  at: number;
  /** Общий номер для вылетевших в одной раздаче */
  handId?: number | null;
  /** Порядок в раздаче: 1 — был больший стек; одинаковый номер — равные стеки */
  handOrder?: number | null;
  /** Кто выбил (только для bust): один — share 1, делёж банка — двое по 0,5 */
  knockers?: Knocker[];
  /** Действие отменено — в расчётах не участвует */
  cancelled?: boolean;
};

export type ParticipantResult = {
  participantId: number;
  /** Сколько раз входил: первый вход + re-entry */
  entries: number;
  reentries: number;
  addons: number;
  doubleAddons: number;
  /** null — ещё ни разу не входил (записался, но не пришёл) */
  status: "playing" | "busted" | null;
  /** Нокауты, с долями 0,5 */
  ko: number;
  /** Место; null — ещё в игре (или итоги финального стола выставляются вручную) */
  place: number | null;
  /** При дележе мест (равные стеки в одной раздаче): place = 7, placeTo = 8 */
  placeTo: number | null;
  /** Событие последнего вылета (если сейчас вылетел) */
  lastBustId: number | null;
  /** Событие аддона (обычного или двойного) — чтобы его можно было отменить */
  addonEventId: number | null;
};

export type TournamentResults = {
  participants: Map<number, ParticipantResult>;
  /** Поле N — число разных игроков, которые вошли в турнир */
  fieldSize: number;
  playersLeft: number;
  /** Счётчики табло в старом формате: entries — первые входы, rebuys — re-entry */
  counters: { entries: number; playersLeft: number; rebuys: number; addons: number; doubleAddons: number };
};

const active = (events: JournalEvent[]) =>
  events.filter((e) => !e.cancelled).sort((a, b) => a.at - b.at || a.id - b.id);

function blank(participantId: number): ParticipantResult {
  return {
    participantId,
    entries: 0,
    reentries: 0,
    addons: 0,
    doubleAddons: 0,
    status: null,
    ko: 0,
    place: null,
    placeTo: null,
    lastBustId: null,
    addonEventId: null,
  };
}

/**
 * Посчитать итоги по журналу. `finished` — турнир завершён: если в игре остался один,
 * он получает 1 место. Если в игре больше одного (дил), их места выставляются вручную.
 * Журнал должен быть корректным (см. checkAction); бессмысленные события пропускаются.
 */
export function computeResults(events: JournalEvent[], opts: { finished?: boolean } = {}): TournamentResults {
  const map = new Map<number, ParticipantResult>();
  const get = (id: number) => {
    let r = map.get(id);
    if (!r) map.set(id, (r = blank(id)));
    return r;
  };
  const busts = new Map<number, JournalEvent>(); // последний вылет каждого вылетевшего

  for (const e of active(events)) {
    const r = get(e.participantId);
    switch (e.type) {
      case "entry":
        if (r.status !== null) break;
        r.entries = 1;
        r.status = "playing";
        break;
      case "reentry":
        if (r.status !== "busted") break;
        r.entries += 1;
        r.reentries += 1;
        r.status = "playing";
        r.lastBustId = null;
        busts.delete(r.participantId);
        break;
      case "addon":
      case "double_addon":
        if (r.status !== "playing") break;
        if (e.type === "addon") r.addons += 1;
        else r.doubleAddons += 1;
        r.addonEventId = e.id;
        break;
      case "bust":
        if (r.status !== "playing") break;
        r.status = "busted";
        r.lastBustId = e.id;
        busts.set(r.participantId, e);
        // Нокаут засчитывается, даже если выбитый потом сделает re-entry
        for (const k of e.knockers ?? []) get(k.participantId).ko += k.share;
        break;
    }
  }

  const all = [...map.values()].filter((r) => r.status !== null);
  const playing = all.filter((r) => r.status === "playing");
  assignPlaces([...busts.values()], playing.length, map);
  if (opts.finished && playing.length === 1) playing[0].place = 1;

  return {
    participants: map,
    fieldSize: all.length,
    playersLeft: playing.length,
    counters: {
      entries: all.length,
      playersLeft: playing.length,
      rebuys: all.reduce((s, r) => s + r.reentries, 0),
      addons: all.reduce((s, r) => s + r.addons, 0),
      doubleAddons: all.reduce((s, r) => s + r.doubleAddons, 0),
    },
  };
}

/**
 * Места вылетевших: кто вылетел позже — выше. Вылетевшие в одной раздаче — по стеку
 * (handOrder), при равных стеках делят места («7–8»).
 */
function assignPlaces(finalBusts: JournalEvent[], playingCount: number, map: Map<number, ParticipantResult>) {
  // Группы «одна раздача»: события с одинаковым handId, без handId — каждое отдельно
  const groups = new Map<string, JournalEvent[]>();
  for (const e of finalBusts) {
    const key = e.handId != null ? `h${e.handId}` : `e${e.id}`;
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }
  const groupTime = (g: JournalEvent[]) => Math.max(...g.map((e) => e.at));
  const groupId = (g: JournalEvent[]) => Math.max(...g.map((e) => e.id));
  const ordered = [...groups.values()].sort((a, b) => groupTime(b) - groupTime(a) || groupId(b) - groupId(a));

  let next = playingCount + 1;
  for (const g of ordered) {
    // внутри раздачи: меньший handOrder (больший стек) — выше
    const byOrder = new Map<number, JournalEvent[]>();
    for (const e of g) {
      const o = e.handOrder ?? 1;
      byOrder.set(o, [...(byOrder.get(o) ?? []), e]);
    }
    for (const o of [...byOrder.keys()].sort((a, b) => a - b)) {
      const same = byOrder.get(o)!;
      for (const e of same) {
        const r = map.get(e.participantId)!;
        r.place = next;
        r.placeTo = same.length > 1 ? next + same.length - 1 : null;
      }
      next += same.length;
    }
  }
}

/** «7» или «7–8» */
export function formatPlace(r: Pick<ParticipantResult, "place" | "placeTo">) {
  if (r.place == null) return "";
  return r.placeTo ? `${r.place}–${r.placeTo}` : String(r.place);
}

// ---------- Проверка действий админа ----------

export type ActionCheck =
  | { type: "entry"; participantId: number }
  | { type: "reentry"; participantId: number }
  | { type: "addon" | "double_addon"; participantId: number }
  | {
      type: "bust";
      /** Кто вылетел в этой раздаче (один или несколько), в порядке стека: [больший, ...] */
      busted: { participantId: number; handOrder: number }[];
      /** Кто выбил: 0 (без нокаута), 1 или 2 (делёж банка) */
      knockers: number[];
    }
  | { type: "cancel"; eventId: number };

export type CheckContext = {
  /** Открыта ли сейчас поздняя регистрация / re-entry по пресету */
  reentryOpen: boolean;
  addonOpen: boolean;
  /** Финальный турнир: re-entry запрещён всегда (RATING.md 7а, п. 9) */
  isFinal: boolean;
  /** Подтверждение «регистрация закрыта, всё равно?» уже получено */
  force?: boolean;
};

/** null — действие можно выполнить; иначе — текст для админа. */
export function checkAction(
  events: JournalEvent[],
  action: ActionCheck,
  ctx: CheckContext,
  name: (participantId: number) => string = (id) => `Игрок ${id}`,
): string | null {
  const res = computeResults(events);
  const r = (id: number) => res.participants.get(id) ?? blank(id);

  switch (action.type) {
    case "entry": {
      if (r(action.participantId).status !== null) return `${name(action.participantId)} уже в турнире`;
      if (!ctx.reentryOpen && !ctx.force) return "Регистрация закрыта";
      return null;
    }
    case "reentry": {
      const p = r(action.participantId);
      if (ctx.isFinal) return "В финале re-entry нет";
      if (p.status === "playing") return `${name(action.participantId)} ещё в игре`;
      if (p.status !== "busted") return `${name(action.participantId)} ещё не входил в турнир`;
      if (!ctx.reentryOpen && !ctx.force) return "Регистрация закрыта";
      return null;
    }
    case "addon":
    case "double_addon": {
      const p = r(action.participantId);
      if (p.status !== "playing") return `${name(action.participantId)} не в игре`;
      // Один аддон на игрока за турнир — обычный или двойной (RATING.md 7а, п. 11)
      if (p.addons + p.doubleAddons > 0) return `${name(action.participantId)} уже брал(а) аддон`;
      if (!ctx.addonOpen && !ctx.force) return "Аддоны закрыты";
      return null;
    }
    case "bust": {
      const ids = action.busted.map((b) => b.participantId);
      if (ids.length === 0) return "Не выбран вылетевший игрок";
      if (new Set(ids).size !== ids.length) return "Игрок указан дважды";
      for (const id of ids) if (r(id).status !== "playing") return `${name(id)} не в игре`;
      if (action.knockers.length > 2) return "Выбить могут максимум двое (делёж банка)";
      if (new Set(action.knockers).size !== action.knockers.length) return "Выбивший указан дважды";
      for (const k of action.knockers) {
        if (ids.includes(k)) return `${name(k)} не может выбить сам себя`;
        if (r(k).status !== "playing") return `${name(k)} не в игре`;
      }
      if (res.playersLeft - ids.length < 1) return "Должен остаться хотя бы один игрок";
      return null;
    }
    case "cancel": {
      const e = events.find((x) => x.id === action.eventId);
      if (!e || e.cancelled) return "Это действие уже отменено";
      // Аддон ни на что не влияет — его можно отменить в любой момент (админ перепутал игрока)
      if (e.type === "addon" || e.type === "double_addon") return null;
      // Нельзя отменить действие, на котором держатся более поздние действия того же игрока
      // (например, вход, после которого он уже вылетел): сначала отмените их.
      const later = active(events).filter(
        (x) =>
          x.id !== e.id &&
          (x.at > e.at || (x.at === e.at && x.id > e.id)) &&
          (x.participantId === e.participantId || (x.knockers ?? []).some((k) => k.participantId === e.participantId)),
      );
      if (later.length > 0) return "Сначала отмените более поздние действия этого игрока";
      return null;
    }
  }
}

/** Доли нокаута для выбранных выбивших: один — 1, двое — по 0,5. */
export function knockerShares(knockers: number[]): Knocker[] {
  const share = knockers.length === 2 ? 0.5 : 1;
  return knockers.map((participantId) => ({ participantId, share }));
}
