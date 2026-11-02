-- Market Lab, Stage A. Point-in-time price history, basket membership, index cache, watchlists, providers.
-- market_prices (0001) stays as it was, empty; market_price_observations replaces it because FUT has one
-- console market (PS + Xbox) and one PC market, and every row needs three clocks for leak-free backtests.
-- Prices are never created by importing cards and cards are never created by importing prices.

-- Price providers and what their terms allow. A provider without authorisation stays listed and disabled.
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

CREATE TABLE market_price_observations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id      INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('console', 'pc')),
  price        INTEGER NOT NULL CHECK (price > 0),
  kind         TEXT NOT NULL DEFAULT 'lowest_bin' CHECK (kind IN ('lowest_bin', 'sale', 'user_quote')),
  observed_at  TEXT NOT NULL,                     -- when the provider saw it
  received_at  TEXT NOT NULL,                     -- when XI Lab stored it; backtests cut on this
  event_at     TEXT,                              -- when the underlying event happened, if different
  season       TEXT NOT NULL DEFAULT 'FC27',
  source_id    TEXT NOT NULL REFERENCES market_price_sources(id),
  owner_id     TEXT NOT NULL DEFAULT '',          -- '' = shared source; otherwise private to that user
  evidence     TEXT NOT NULL CHECK (evidence IN ('verified', 'game_data', 'estimate', 'hypothesis')),
  quality      TEXT,                              -- JSON array of notes / missing fields
  import_run   TEXT,
  CHECK (received_at >= observed_at),
  UNIQUE (owner_id, source_id, card_id, platform, observed_at)
);
CREATE INDEX idx_mpo_card ON market_price_observations(card_id, platform, observed_at DESC);
CREATE INDEX idx_mpo_received ON market_price_observations(platform, received_at);

-- Transparent basket rules (JSON) and point-in-time membership.
CREATE TABLE market_baskets (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  grp          TEXT NOT NULL,
  description  TEXT NOT NULL,
  rule         TEXT NOT NULL
);

CREATE TABLE market_basket_members (
  basket_id       TEXT NOT NULL REFERENCES market_baskets(id) ON DELETE CASCADE,
  card_id         INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  effective_from  TEXT NOT NULL,
  effective_to    TEXT,
  backfilled      INTEGER NOT NULL DEFAULT 0 CHECK (backfilled IN (0, 1)),
  PRIMARY KEY (basket_id, card_id, effective_from)
);

-- Cache of computed index points (recomputable from observations + membership).
CREATE TABLE market_index_points (
  basket_id     TEXT NOT NULL REFERENCES market_baskets(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('console', 'pc')),
  t             TEXT NOT NULL,
  value         REAL NOT NULL,
  constituents  INTEGER NOT NULL,
  rules_version TEXT NOT NULL,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (basket_id, platform, t, rules_version)
);

-- Versioned market rules (tax, price steps, thresholds) as JSON, like chemistry rules.
CREATE TABLE market_rule_versions (
  id         TEXT PRIMARY KEY,
  status     TEXT NOT NULL CHECK (status IN ('unverified', 'verified', 'retired')),
  is_active  INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  notes      TEXT NOT NULL,
  body       TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_one_active_market_rule ON market_rule_versions(is_active) WHERE is_active = 1;

CREATE TABLE market_watchlist (
  owner_id      TEXT NOT NULL,
  card_id       INTEGER NOT NULL REFERENCES player_cards(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('console', 'pc')),
  added_at      TEXT NOT NULL,
  note          TEXT,
  target_buy    INTEGER,
  target_sell   INTEGER,
  price_at_add  INTEGER,
  price_at_add_observed_at TEXT,
  PRIMARY KEY (owner_id, card_id, platform)
);

-- Provider sync runs and health, so the Data sources panel can show freshness per provider.
CREATE TABLE market_provider_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT NOT NULL REFERENCES market_price_sources(id),
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  accepted     INTEGER NOT NULL DEFAULT 0,
  rejected     INTEGER NOT NULL DEFAULT 0,
  message      TEXT
);

INSERT INTO market_price_sources (id, name, kind, status, is_demo, status_note, permissions, evidence) VALUES
  ('xilab_demo', 'XI Lab demo dataset', 'demo', 'enabled', 1,
   'Made-up prices for made-up cards. Not market data.',
   '{"commercial_use":false,"storage":true,"retention_days":null,"display":true,"derived_analytics":true,"model_training":false,"redistribution":false,"attribution":null}', 'hypothesis'),
  ('user_import', 'Your imported price history', 'user_import', 'enabled', 0,
   'Prices you import yourself. Private to you; XI Lab does not check where they came from.',
   '{"commercial_use":false,"storage":true,"retention_days":null,"display":true,"derived_analytics":true,"model_training":false,"redistribution":false,"attribution":null}', 'estimate'),
  ('web_app_capture', 'Your Web App captures (XI Lab browser helper)', 'browser_capture', 'enabled', 0,
   'Lowest Buy Now prices from transfer-market searches YOU ran in the EA Web App, read from results the Web App already loaded. The helper never searches, clicks or bids. Only the listings you viewed, not the whole market. Private to you. Third-party software on EA''s site carries some account risk (Jeff accepted it on 2026-11-02).',
   '{"commercial_use":false,"storage":true,"retention_days":null,"display":true,"derived_analytics":true,"model_training":false,"redistribution":false,"attribution":null}', 'game_data'),
  ('ea_fc_community_api', 'EA FC Community API', 'official_api', 'not_authorized', 0,
   'Closed to new partners as of 2026-11-02. Not connected.',
   '{"commercial_use":false,"storage":false,"retention_days":null,"display":false,"derived_analytics":false,"model_training":false,"redistribution":false,"attribution":null}', 'verified'),
  ('futbin', 'FUTBIN', 'licensed_feed', 'not_authorized', 0,
   'No licence or API agreement. Blocks automated access; not scraped.',
   '{"commercial_use":false,"storage":false,"retention_days":null,"display":false,"derived_analytics":false,"model_training":false,"redistribution":false,"attribution":null}', 'game_data'),
  ('futgg', 'FUT.GG', 'licensed_feed', 'not_authorized', 0,
   'No licence or API agreement. Blocks automated access; not scraped.',
   '{"commercial_use":false,"storage":false,"retention_days":null,"display":false,"derived_analytics":false,"model_training":false,"redistribution":false,"attribution":null}', 'game_data'),
  ('futwiz', 'FUTWIZ', 'licensed_feed', 'not_authorized', 0,
   'No licence or API agreement. Blocks automated access; not scraped.',
   '{"commercial_use":false,"storage":false,"retention_days":null,"display":false,"derived_analytics":false,"model_training":false,"redistribution":false,"attribution":null}', 'game_data');

INSERT INTO market_rule_versions (id, status, is_active, notes, body) VALUES
  ('fc27-market-v1', 'unverified', 1,
   'Transfer tax 5% of the sale price (floored) and price bands are community knowledge as of 2026-11-02, not confirmed by EA. Scanner thresholds are XI Lab defaults, not validated against outcomes.',
   '{"transfer_tax_rate":0.05,"price_steps":[{"from":0,"step":50},{"from":1000,"step":100},{"from":10000,"step":250},{"from":50000,"step":500},{"from":100000,"step":1000}],"min_price":200,"stale_after_hours":6,"min_points":6,"thresholds":{"relative_strength_pp":3,"regime_trend_24h":2,"regime_trend_7d":4,"high_volatility":2.5,"sbc_spread_pp":4,"priced_in_72h":25,"mean_reversion_z":-1.5}}');
