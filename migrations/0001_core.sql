-- XI Lab core data model. SQLite dialect, compatible with Cloudflare D1.
-- Every imported fact links back to the source it came from and the import run that wrote it.


-- ---------------------------------------------------------------- provenance

CREATE TABLE data_sources (
  id            TEXT PRIMARY KEY,                 -- e.g. 'manual', 'kaggle-mikedpad-fc27'
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('manual', 'official', 'dataset', 'api')),
  url           TEXT,
  terms_status  TEXT NOT NULL CHECK (terms_status IN ('approved', 'pending_review', 'blocked')),
  terms_notes   TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE import_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id         TEXT NOT NULL REFERENCES data_sources(id),
  input_ref         TEXT,                          -- file name or URL that was read
  input_sha256      TEXT,                          -- hash of the input so a run can be reproduced
  source_snapshot_at TEXT,                         -- when the source says its data was taken
  terms_accepted_by TEXT,                          -- who accepted a pending_review source for this run
  started_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at       TEXT,
  status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  records_seen      INTEGER NOT NULL DEFAULT 0,
  records_written   INTEGER NOT NULL DEFAULT 0,
  records_rejected  INTEGER NOT NULL DEFAULT 0,
  notes             TEXT
);

CREATE TABLE import_rejections (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  import_run_id  INTEGER NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  record_ref     TEXT,
  reason         TEXT NOT NULL
);

-- ---------------------------------------------------------------- reference entities

CREATE TABLE nations (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ea_id   INTEGER UNIQUE
);

CREATE TABLE leagues (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ea_id   INTEGER UNIQUE,
  gender  TEXT CHECK (gender IN ('men', 'women'))
);

CREATE TABLE clubs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL COLLATE NOCASE,
  league_id  INTEGER REFERENCES leagues(id),
  ea_id      INTEGER UNIQUE,
  UNIQUE (name, league_id)
);

-- Positions are data, not an enum, so a game update can add or drop one without a migration.
CREATE TABLE positions (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  line        TEXT NOT NULL CHECK (line IN ('GK', 'DEF', 'MID', 'ATT')),
  sort_order  INTEGER NOT NULL
);

CREATE TABLE attribute_defs (
  key         TEXT PRIMARY KEY,                    -- e.g. 'standing_tackle'
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,                       -- pace, shooting, passing, dribbling, defending, physical, goalkeeping, face
  sort_order  INTEGER NOT NULL
);

CREATE TABLE playstyles (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- base name without the '+', e.g. 'Intercept'
  category  TEXT
);

CREATE TABLE roles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  position_code  TEXT NOT NULL REFERENCES positions(code),
  name           TEXT NOT NULL COLLATE NOCASE,
  UNIQUE (position_code, name)
);

-- ---------------------------------------------------------------- players and their cards

-- One row per real footballer. Every card version links to this.
CREATE TABLE players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ea_person_id    INTEGER UNIQUE,
  common_name     TEXT NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  birth_date      TEXT,
  gender          TEXT CHECK (gender IN ('men', 'women')),
  nation_id       INTEGER REFERENCES nations(id),
  height_cm       INTEGER,
  weight_kg       INTEGER,
  preferred_foot  TEXT CHECK (preferred_foot IN ('left', 'right')),
  source_id       TEXT NOT NULL REFERENCES data_sources(id),
  source_person_key TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_id, source_person_key)
);

-- One row per Ultimate Team item (gold rare, TOTW, promo, Evo, Icon...).
CREATE TABLE player_cards (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id          INTEGER NOT NULL REFERENCES players(id),
  ea_item_id         INTEGER UNIQUE,
  season             TEXT NOT NULL,                -- 'FC27'
  version            TEXT NOT NULL,                -- 'base', 'TOTW 3', 'Icon', 'Evolution'...
  rarity             TEXT,                         -- 'gold rare', 'silver common'...
  overall            INTEGER NOT NULL CHECK (overall BETWEEN 1 AND 99),
  nation_id          INTEGER REFERENCES nations(id),
  league_id          INTEGER REFERENCES leagues(id),
  club_id            INTEGER REFERENCES clubs(id),
  is_icon            INTEGER NOT NULL DEFAULT 0 CHECK (is_icon IN (0, 1)),
  is_hero            INTEGER NOT NULL DEFAULT 0 CHECK (is_hero IN (0, 1)),
  skill_moves        INTEGER CHECK (skill_moves BETWEEN 1 AND 5),
  weak_foot          INTEGER CHECK (weak_foot BETWEEN 1 AND 5),
  attacking_work_rate TEXT CHECK (attacking_work_rate IN ('low', 'medium', 'high')),
  defensive_work_rate TEXT CHECK (defensive_work_rate IN ('low', 'medium', 'high')),
  height_cm          INTEGER,                      -- cards can differ from the person (Icons)
  image_url          TEXT,
  availability       TEXT,                         -- 'packable', 'sbc', 'objective', 'untradeable reward'...
  -- Evidence label shown in the UI: how much to trust this row.
  evidence           TEXT NOT NULL CHECK (evidence IN ('verified', 'game_data', 'estimate', 'hypothesis')),
  source_id          TEXT NOT NULL REFERENCES data_sources(id),
  source_card_key    TEXT NOT NULL,
  source_updated_at  TEXT,
  import_run_id      INTEGER REFERENCES import_runs(id),
  imported_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_id, source_card_key)
);
CREATE INDEX idx_cards_player ON player_cards(player_id);
CREATE INDEX idx_cards_overall ON player_cards(season, overall DESC);
CREATE INDEX idx_cards_chem ON player_cards(club_id, league_id, nation_id);

CREATE TABLE card_positions (
  card_id        INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  position_code  TEXT NOT NULL REFERENCES positions(code),
  is_primary     INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (card_id, position_code)
);
CREATE INDEX idx_card_positions_pos ON card_positions(position_code);

CREATE TABLE card_attributes (
  card_id        INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  attribute_key  TEXT NOT NULL REFERENCES attribute_defs(key),
  value          INTEGER NOT NULL CHECK (value BETWEEN 1 AND 99),
  PRIMARY KEY (card_id, attribute_key)
);
CREATE INDEX idx_card_attr_value ON card_attributes(attribute_key, value);

CREATE TABLE card_playstyles (
  card_id      INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  playstyle_id INTEGER NOT NULL REFERENCES playstyles(id),
  is_plus      INTEGER NOT NULL DEFAULT 0 CHECK (is_plus IN (0, 1)),
  PRIMARY KEY (card_id, playstyle_id)
);

CREATE TABLE card_role_familiarity (
  card_id  INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  role_id  INTEGER NOT NULL REFERENCES roles(id),
  level    TEXT NOT NULL CHECK (level IN ('plus', 'plusplus')),
  PRIMARY KEY (card_id, role_id)
);

-- Empty until there is a legitimate price source. Kept so the optimizer's schema is stable.
CREATE TABLE market_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id      INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('playstation', 'xbox', 'pc')),
  price        INTEGER NOT NULL CHECK (price >= 0),
  observed_at  TEXT NOT NULL,
  source_id    TEXT NOT NULL REFERENCES data_sources(id),
  evidence     TEXT NOT NULL CHECK (evidence IN ('verified', 'game_data', 'estimate', 'hypothesis'))
);
CREATE INDEX idx_prices_card ON market_prices(card_id, platform, observed_at DESC);

-- ---------------------------------------------------------------- chemistry rules (versioned, editable)

CREATE TABLE chemistry_rule_versions (
  id            TEXT PRIMARY KEY,                  -- 'fc27-community-v0'
  season        TEXT NOT NULL,
  label         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('unverified', 'verified', 'retired')),
  is_active     INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  source_notes  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_at   TEXT,
  verified_by   TEXT
);
-- Only one active version per season.
CREATE UNIQUE INDEX idx_one_active_rule ON chemistry_rule_versions(season) WHERE is_active = 1;

-- "N players sharing a club gives each of them `points` chemistry."
CREATE TABLE chemistry_thresholds (
  rule_version_id  TEXT NOT NULL REFERENCES chemistry_rule_versions(id) ON DELETE CASCADE,
  link_type        TEXT NOT NULL CHECK (link_type IN ('club', 'league', 'nation')),
  points           INTEGER NOT NULL CHECK (points BETWEEN 1 AND 3),
  players_required INTEGER NOT NULL CHECK (players_required >= 1),
  PRIMARY KEY (rule_version_id, link_type, points)
);

-- Everything that isn't a plain threshold: manager bonus, Icon/Hero contributions, caps.
CREATE TABLE chemistry_modifiers (
  rule_version_id  TEXT NOT NULL REFERENCES chemistry_rule_versions(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,                  -- e.g. 'icon.nation_count'
  value            INTEGER NOT NULL,
  description      TEXT NOT NULL,
  PRIMARY KEY (rule_version_id, key)
);
