// Схема базы SQLite. Каждая миграция — шаг от версии N к N+1 (номер хранится в PRAGMA user_version).
// Уже выпущенные миграции НЕ менять: новые поля и таблицы — только новой миграцией в конец списка.

export const MIGRATIONS: string[] = [
  // 1 — исходная схема: пресеты и табло, игроки, турниры, участники, вылеты/нокауты, периоды и финалы.
  `
  -- Служебное: версия данных, откуда перенесено и т.п.
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Настройки клуба (время экранов рейтинга на табло, N финалистов, сезон/год вкл/выкл ...)
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  -- Версии правил рейтинга (docs/RATING.md). Турнир помнит, по какой версии посчитан.
  CREATE TABLE rating_rules (
    id         INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL,
    rules_json TEXT NOT NULL
  );

  -- Журнал важных действий: закрытие периодов, правки финалистов, исправление итогов
  CREATE TABLE audit_log (
    id           INTEGER PRIMARY KEY,
    at           INTEGER NOT NULL,
    action       TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE presets (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    description        TEXT,
    starting_stack     INTEGER NOT NULL DEFAULT 0,
    rebuy_stack        INTEGER NOT NULL DEFAULT 0,
    addon_stack        INTEGER NOT NULL DEFAULT 0,
    double_addon_stack INTEGER NOT NULL DEFAULT 0,
    rebuy_until_level  INTEGER NOT NULL DEFAULT 0,
    addon_until_level  INTEGER NOT NULL DEFAULT 0,
    steps_json         TEXT NOT NULL,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    updated_at         INTEGER NOT NULL
  );

  -- Настройки табло, не зависящие от турнира (одна строка)
  CREATE TABLE board (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    combination TEXT NOT NULL DEFAULT '',
    ticker      TEXT NOT NULL DEFAULT '',
    ticker_on   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE players (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    phone          TEXT UNIQUE,              -- в виде +79001234567
    note           TEXT NOT NULL DEFAULT '',
    telegram_id    TEXT UNIQUE,              -- на будущее, для бота
    first_visit_at INTEGER,
    elo            REAL NOT NULL DEFAULT 1000,
    elo_games      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    archived_at    INTEGER
  );
  CREATE INDEX players_name ON players (name);

  -- Периоды рейтинга: месяц / сезон / год. closed_at IS NULL — период открыт.
  CREATE TABLE periods (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('month', 'season', 'year')),
    name        TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    closed_at   INTEGER,
    finalists_n INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE tournaments (
    id                 INTEGER PRIMARY KEY,
    name               TEXT NOT NULL,
    kind               TEXT NOT NULL DEFAULT 'regular'
                       CHECK (kind IN ('regular', 'month_final', 'season_final', 'year_final')),
    final_of_period_id INTEGER REFERENCES periods (id),
    -- 'manual' — только счётчики (как раньше), 'players' — учёт по игрокам
    mode               TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'players')),
    preset_id          TEXT,
    structure_json     TEXT,                 -- снимок структуры блайндов
    -- часы турнира (см. src/lib/clock.ts)
    status             TEXT NOT NULL DEFAULT 'idle',
    step_index         INTEGER NOT NULL DEFAULT 0,
    step_ends_at       INTEGER,
    remaining_ms       INTEGER NOT NULL DEFAULT 0,
    elapsed_base_ms    INTEGER NOT NULL DEFAULT 0,
    run_started_at     INTEGER,
    -- ручные счётчики табло
    entries            INTEGER NOT NULL DEFAULT 0,
    players_left       INTEGER NOT NULL DEFAULT 0,
    rebuys             INTEGER NOT NULL DEFAULT 0,
    addons             INTEGER NOT NULL DEFAULT 0,
    double_addons      INTEGER NOT NULL DEFAULT 0,
    is_current         INTEGER NOT NULL DEFAULT 0,  -- турнир, который сейчас на табло
    rules_id           INTEGER REFERENCES rating_rules (id),
    deal               INTEGER NOT NULL DEFAULT 0,  -- места на финальном столе выставлены вручную
    created_at         INTEGER NOT NULL,
    started_at         INTEGER,
    finished_at        INTEGER,
    updated_at         INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX tournaments_one_current ON tournaments (is_current) WHERE is_current = 1;

  -- В какие рейтинги (периоды) идёт турнир
  CREATE TABLE tournament_periods (
    tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
    period_id     INTEGER NOT NULL REFERENCES periods (id) ON DELETE CASCADE,
    PRIMARY KEY (tournament_id, period_id)
  );

  -- Участник турнира: один игрок — одна строка, сколько бы входов он ни сделал
  CREATE TABLE participants (
    id            INTEGER PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
    player_id     INTEGER NOT NULL REFERENCES players (id),
    status        TEXT NOT NULL DEFAULT 'registered'
                  CHECK (status IN ('registered', 'playing', 'busted', 'no_show')),
    registered_at INTEGER NOT NULL,
    arrived_at    INTEGER,
    table_no      INTEGER,
    seat_no       INTEGER,
    -- итоги (заполняются при завершении турнира)
    place         INTEGER,
    place_to      INTEGER,                   -- при дележе мест: place=7, place_to=8
    entries       INTEGER NOT NULL DEFAULT 0,
    ko            REAL NOT NULL DEFAULT 0,
    points        INTEGER,
    elo_before    REAL,
    elo_after     REAL,
    UNIQUE (tournament_id, player_id)
  );

  -- Журнал турнира — источник правды для мест, входов и нокаутов
  CREATE TABLE events (
    id             INTEGER PRIMARY KEY,
    tournament_id  INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
    type           TEXT NOT NULL CHECK (type IN ('entry', 'reentry', 'addon', 'double_addon', 'bust')),
    at             INTEGER NOT NULL,
    level_no       INTEGER NOT NULL DEFAULT 0,
    hand_id        INTEGER,                  -- общий номер для вылетевших в одной раздаче
    hand_order     INTEGER,                  -- 1 — больший стек; одинаковый номер — равные стеки
    cancelled_at   INTEGER                   -- действие отменено
  );
  CREATE INDEX events_tournament ON events (tournament_id, at);

  -- Кто выбил: при делёжке банка — две строки по 0,5
  CREATE TABLE knockouts (
    bust_event_id          INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    knocker_participant_id INTEGER NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
    share                  REAL NOT NULL,
    PRIMARY KEY (bust_event_id, knocker_participant_id)
  );

  -- Замороженная таблица периода на момент закрытия
  CREATE TABLE period_standings (
    period_id   INTEGER NOT NULL REFERENCES periods (id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players (id),
    rank        INTEGER NOT NULL,
    points      INTEGER NOT NULL,
    wins        INTEGER NOT NULL,
    best_place  INTEGER,
    ko          REAL NOT NULL,
    tournaments INTEGER NOT NULL,
    PRIMARY KEY (period_id, player_id)
  );

  -- Ручные правки списка финалистов: wildcard или отказ
  CREATE TABLE finalist_changes (
    id        INTEGER PRIMARY KEY,
    period_id INTEGER NOT NULL REFERENCES periods (id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players (id),
    action    TEXT NOT NULL CHECK (action IN ('add', 'remove')),
    at        INTEGER NOT NULL,
    note      TEXT NOT NULL DEFAULT ''
  );
  `,
  // 2 — цены для кассы в пресете (docs/CASH.md): {"entry", "reentry", "addon", "doubleAddon"} в рублях
  `
  ALTER TABLE presets ADD COLUMN prices_json TEXT NOT NULL DEFAULT '{}';
  `,
];
