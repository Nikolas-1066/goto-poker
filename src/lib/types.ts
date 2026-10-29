// Общие типы для структур блайндов и состояния турнира.

export type LevelStep = {
  id: string;
  kind: "level";
  sb: number;
  bb: number;
  ante: number;
  minutes: number;
};

export type BreakStep = {
  id: string;
  kind: "break";
  minutes: number;
  /** Подпись на табло, например «Укрупнение фишек 100» */
  note?: string;
};

export type Step = LevelStep | BreakStep;

/** Пресет турнира: структура блайндов + параметры стека. */
export type Preset = {
  id: string;
  name: string;
  description?: string;
  startingStack: number;
  rebuyStack: number;
  addonStack: number;
  /** Стек двойного аддона */
  doubleAddonStack: number;
  /** Ребаи разрешены до конца этого уровня (включая перерыв после него); 0 — без ребаев */
  rebuyUntilLevel: number;
  /** Аддоны (обычный и двойной) — до конца этого уровня и перерыва после него; 0 — без аддонов */
  addonUntilLevel: number;
  steps: Step[];
  updatedAt: number;
};

export type TournamentStatus = "idle" | "running" | "paused" | "finished";

/** Как считаются игроки: вручную счётчиками или по участникам (журнал входов и вылетов) */
export type TournamentMode = "manual" | "players";

export type Tournament = {
  name: string;
  /** Из какого пресета загружена структура (для информации) */
  presetId: string | null;
  /** Снимок структуры: правки пресета не ломают идущий турнир */
  structure: Omit<Preset, "updatedAt"> | null;

  /** В режиме players счётчики ниже считает сервер по участникам — вручную их не меняют */
  mode: TournamentMode;

  status: TournamentStatus;
  stepIndex: number;
  /** Когда закончится текущий шаг (только в статусе running), epoch ms */
  stepEndsAt: number | null;
  /** Остаток времени шага в статусах idle / paused / finished, ms */
  remainingMs: number;

  /** Накопленное время игры до текущего отрезка running, ms */
  elapsedBaseMs: number;
  /** Начало текущего отрезка running, epoch ms */
  runStartedAt: number | null;

  entries: number;
  playersLeft: number;
  rebuys: number;
  addons: number;
  doubleAddons: number;

  /** «Комбинация дня»; пустая строка — блок скрыт */
  combination: string;

  /** Бегущая строка внизу табло */
  ticker: string;
  tickerOn: boolean;

  updatedAt: number;
};

export type Db = {
  version: 1;
  presets: Preset[];
  tournament: Tournament;
};

export type TournamentAction =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; index: number }
  | { type: "restartStep" }
  | { type: "adjustTime"; deltaMs: number }
  | { type: "setTime"; remainingMs: number }
  | { type: "loadPreset"; presetId: string }
  | { type: "reset" }
  | { type: "finish" }
  /** Поменять у идущего турнира, до какого уровня открыты ребаи (re-entry) и аддоны; 0 — нет */
  | { type: "setRules"; rebuyUntilLevel: number; addonUntilLevel: number }
  | {
      type: "update";
      patch: Partial<
        Pick<
          Tournament,
          "name" | "entries" | "playersLeft" | "rebuys" | "addons" | "doubleAddons" | "combination" | "ticker" | "tickerOn"
        >
      >;
    };
