-- Passive Web App price capture (Jeff's choice, 2026-11-02).
-- 1. Allow the browser_capture source kind. SQLite can't alter a CHECK, so the small sources table is rebuilt;
--    its rows are copied aside, the table is dropped and recreated under the same name (no RENAME, so the child
--    tables' REFERENCES stay as they are) and the rows are put back. Foreign keys are deferred to the end of the
--    migration's transaction, by which time every referenced id exists again.
-- 2. Seed the web_app_capture source.
-- 3. market_capture_holds: captured prices for EA items not in the card database yet (promos, Icons, Heroes),
--    private to the user, moved into market_price_observations once the card exists. Prices never create cards.
PRAGMA defer_foreign_keys = ON;
CREATE TEMP TABLE market_price_sources_copy AS SELECT * FROM market_price_sources;
DROP TABLE market_price_sources;

CREATE TABLE market_price_sources (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('demo', 'user_import', 'browser_capture', 'licensed_feed', 'official_api')),
  status       TEXT NOT NULL CHECK (status IN ('enabled', 'disabled', 'not_authorized')),
  is_demo      INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  status_note  TEXT NOT NULL,
  -- {"commercial_use":false,"storage":true,"retention_days":null,"display":true,"derived_analytics":true,
  --  "model_training":false,"redistribution":false,"attribution":null}
  permissions  TEXT NOT NULL,
  evidence     TEXT NOT NULL CHECK (evidence IN ('verified', 'game_data', 'estimate', 'hypothesis')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO market_price_sources SELECT * FROM market_price_sources_copy;
DROP TABLE market_price_sources_copy;

INSERT INTO market_price_sources (id, name, kind, status, is_demo, status_note, permissions, evidence) VALUES
  ('web_app_capture', 'Your Web App captures (XI Lab browser helper)', 'browser_capture', 'enabled', 0,
   'Lowest Buy Now prices from transfer-market searches YOU ran in the EA Web App, read from results the Web App already loaded. The helper never searches, clicks or bids. Only the listings you viewed, not the whole market. Private to you. Third-party software on EA''s site carries some account risk (Jeff accepted it on 2026-11-02).',
   '{"commercial_use":false,"storage":true,"retention_days":null,"display":true,"derived_analytics":true,"model_training":false,"redistribution":false,"attribution":null}', 'game_data');

CREATE TABLE market_capture_holds (
  owner_id     TEXT NOT NULL,
  ea_item_id   INTEGER NOT NULL CHECK (ea_item_id > 0),
  asset_id     INTEGER,
  rating       INTEGER CHECK (rating BETWEEN 1 AND 99),
  platform     TEXT NOT NULL CHECK (platform IN ('console', 'pc')),
  observed_at  TEXT NOT NULL,
  details      TEXT,                     -- JSON: EA rare_flag / team_id / league_id / nation_id / position
  observation  TEXT NOT NULL,            -- JSON PriceObservation without card_id
  PRIMARY KEY (owner_id, ea_item_id, platform, observed_at)
);
CREATE INDEX idx_mch_owner ON market_capture_holds(owner_id, ea_item_id);
