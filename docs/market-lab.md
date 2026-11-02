# Market Lab (Stage A)

Market Lab is XI Lab's market research and decision-support section. It is not a trading bot: it never bids,
buys, lists or touches an EA account. Stage A is the market-data foundation: price history, benchmark indexes,
relative strength, momentum, mean reversion, a trade thesis simulator, Card Intelligence and a watchlist.

```
src/market/          pure TypeScript, no DB or Node imports (bundles for Workers and Deno, like src/workspace)
src/intelligence/    Card Intelligence: the one card-utility scorer, shared by the Squad Builder and Market Lab
src/db/market-store.ts   SQLite adapters over migrations/0004_market_lab.sql
scripts/market.ts    CLI on the local card database (npm run market)
web/market.*         the Market Lab screens (Vite, no framework), next to the squad builder
```

## Implementation summary

### Existing infrastructure reused

- **Card identity.** Market Lab uses the same canonical card id as everything else: `player_cards.id` locally,
  `fut.player_cards.id` (UUID) in Gaffer Bot, the workspace card `id` in the browser. No second player database.
  `SqliteMarketCardSource` reads the existing card records (players, positions, face stats, club/league/nation).
- **Squad workspace.** `MarketCard` extends the workspace card. Compare in My Squad calls the workspace's
  `previewAssign`/`evaluateSquad`, so chemistry comes from the chemistry engine (rule `fc27-community-v1`) and
  locked players and owned cards are respected exactly as in the optimizer.
- **Tactical fit.** Card utility uses the workspace's `fitScore` profiles. There is one scoring system
  (`src/intelligence/card.ts`), used by Card Intelligence, the comparable-card view and the "meta" basket.
- **Service pattern.** `createMarketService(deps)` mirrors `createWorkspaceService`: async, owner-scoped storage
  interfaces, so the website, Gaffer Bot's `fut-api` routes and the FUT MCP tools call one service.
- **Import pattern.** The price importer reuses the CSV parser, rejects rows with a reason (never silently), and
  checks source terms before storing, like the card importer.
- **Gaffer Bot.** Accounts, auth (`auth.users` id as owner), the `fut` schema with service-role-only grants and
  RLS, the FUT_ENABLED switch and the MCP server are reused. See "Gaffer Bot" below.

### New database changes

`migrations/0004_market_lab.sql` (SQLite; Gaffer Bot gets the Postgres equivalent in the `fut` schema):

| Table | Holds |
| --- | --- |
| `market_price_sources` | Each provider, its status (`enabled` / `disabled` / `not_authorized`), demo flag and licence permissions (commercial use, storage, retention, display, derived analytics, model training, redistribution, attribution) |
| `market_price_observations` | Point-in-time prices: `observed_at` (provider saw it), `received_at` (XI Lab stored it), `event_at`, season, platform (`console` / `pc`), source, owner (private imports), evidence, quality notes |
| `market_baskets`, `market_basket_members` | Basket rules as JSON and point-in-time membership (`effective_from`/`effective_to`, `backfilled`) |
| `market_index_points` | Cache of computed index points, per rules version |
| `market_rule_versions` | Tax, price steps and scanner thresholds as a versioned JSON row (`fc27-market-v1`, unverified) |
| `market_watchlist` | Per-owner watchlist with targets and the price when added |
| `market_provider_runs` | Provider sync runs and health |

The old empty `market_prices` table is left as it was.

### Data-provider strategy

- **No live feed is connected, because none is authorised.** EA's FC Community API is closed to new partners;
  FUTBIN, FUT.GG and FUTWIZ have no agreement with XI Lab and block automated access. They are listed as
  `not_authorized` on the Data sources screen with the reason, and the service refuses to store or analyse rows
  from them (`assertUsable`).
- **Adapter interface.** `PriceProvider { source, fetchSince(since) }` is the slot for a licensed feed. Adding
  one means: a `market_price_sources` row with its terms, an adapter, and a scheduled job that sets
  `received_at` when storing. Disabling it is one status change.
- **Working import.** CSV or JSON (`card_id,platform,price,observed_at,kind,event_at`), validated, private to
  the importing user. Web: Market Lab > Import prices. CLI: `npm run market -- import --file prices.csv`.
- **Passive Web App capture (Jeff's choice, 2026-11-02).** The XI Lab Price Capture browser extension
  (`extension/`) reads only the transfer-market search results the EA Web App has already downloaded because
  you searched. It sends no requests, never clicks, bids or lists, and does nothing on any other page. Each
  results page becomes one row per item: lowest active Buy Now and the listing count. The popup exports a CSV
  (`ea_item_id,asset_id,rating,platform,price,observed_at,kind,listings`); importing it stores the rows under the
  `web_app_capture` source (evidence `game_data`, private to you), matched on `player_cards.ea_item_id`, or on
  the asset id when the rating also matches. Only the listings you looked at are recorded, so coverage follows
  your searches. Third-party software on EA's site carries some account risk; Jeff accepted it. See
  "Price capture extension" below.
- **Demo dataset.** `src/market/demo.ts` generates made-up hourly prices for the made-up demo cards (and some
  made-up fodder, promo, Icon and Hero cards). It is deterministic, tagged source `xilab_demo` and evidence
  `hypothesis`, regenerated on load rather than stored, and every screen built on it shows a DEMO banner. Its
  price shapes are chosen to exercise each signal, not to look like any real card.

### Routes and UI

`web/market.html` (built next to the squad builder; `XI_BASE=/fut/` for gafferbot.app/fut):

| View | Hash | Shows |
| --- | --- | --- |
| Market overview | `#overview` | Regime with the measurements behind it, index table (now, 1h/6h/24h/72h/7d, volatility, trend, constituents, middle 50% of prices, 7d sparkline), relative-strength leaders and declines, coverage, events placeholder |
| Opportunity radar | `#scanner` | Every priced card with status, categories, reasons, freshness; filters by status, price and category |
| Card Intelligence | `#card/<id>` | Price chart, freshness, signal with reasons and "why this could be wrong", relative strength vs five benchmarks over five windows, momentum, mean reversion, card utility, comparables, trade thesis simulator, Compare in My Squad, watch button |
| Watchlist | `#watchlist` | Price now vs when added, status, targets reached |
| Import prices | `#import` | Paste or upload, per-row rejections |
| Data sources | `#sources` | Every provider, status and permissions |

The squad builder links to Market Lab from the toolbar, and each player panel has **View Market Intelligence**.
Card Intelligence has **Compare in My Squad** against any saved squad.

### Calculation and signal-service architecture

All deterministic. Results carry `provenance` (rules version, engine version, as-of time, sources, demo flag,
evidence label).

1. **Series** (`series.ts`): rows are filtered to what XI Lab had received by `as_of`, de-duplicated, and turned
   into per-card series. `change()` never extrapolates: no history that far back means `null`.
2. **Freshness**: a price older than `stale_after_hours` (6h) is stale. Stale or missing means no current price is
   claimed anywhere (Card Intelligence, thesis, watchlist) and the status is "insufficient evidence".
3. **Baskets and indexes** (`baskets.ts`): 13 baskets (whole market, 84-90 fodder tiers, meta gameplay, promos,
   Icons & Heroes, Evolution candidates, live-upgrade). Rules are data and shown on screen. Membership is
   point-in-time; `rebalance()` closes and opens rows and never rewrites history. The index is a chained,
   equal-weighted geometric mean of hourly price relatives over members with a fresh price at both ends, base 100.
4. **Regime** (`regime.ts`): rule table over index moves. Broadly rising / falling / sideways from the whole-market
   index (24h and 7d thresholds), SBC-driven demand when a fodder tier beats meta gameplay cards by 4pp over 24h,
   promo volatility when the promo basket's volatility is high and 1.5x the market's. High supply is listed as not
   evaluable (needs listing data). Insufficient data when the index has too few fresh points.
5. **Relative strength** (`signals.ts`): card change minus benchmark change (pp) for five benchmarks (same category,
   rating ±1, same primary position, similar tactical fit, whole-market index) over five windows. Peer benchmarks
   use the median peer (needs 3+). ±3pp is the out/under-performance line.
6. **Momentum**: changes per window, 6h vs 24h average, 72h range breakout/breakdown (the last 3 hours must all be
   outside the range), higher highs/lows over three days, acceleration, hourly volatility, volatility-adjusted 24h
   return, 7d max drawdown.
7. **Mean reversion**: z-score vs own 7d prices, position in 7d range, price vs median same-rating same-position
   peer, and a labelled hypothesis on the pattern: recent dislocation (stable week then a 5%+ drop) vs persistent
   decline (already falling and still falling). A persistent decline is risk, not a bargain.
8. **Assessment**: statuses Watch, Research further, Favourable setup, Overheated, Elevated risk, Insufficient
   evidence; categories Confirmed momentum, Possible temporary discount, Relative-value opportunity, Possible
   demand exhaustion, Elevated downside risk. Order of checks: data quality first, then entry risk (up 25%+ in 72h
   = overheated), then downside structure, then positive evidence. Favourable needs two independent positive
   categories and a regime that isn't falling or unknown. Every assessment lists reasons and why it could be wrong.
9. **Trade thesis** (`thesis.ts`): investment, tax (5%, floored, configurable), break-even listing price on valid
   price steps, profit at target, loss at downside, returns, risk/reward, the win rate needed to break even (pure
   arithmetic), the user's own probability shown as their assumption, share of coins, position after the trade
   (holdings are never counted as coins), price-step validity, and buy price vs latest fresh price.

### Stage A delivered

1. Integration with existing FUT card records (canonical ids; SQLite and browser card sources).
2. Price-history adapter interface (`PriceProvider`) and provider registry with permissions.
3. Historical price storage (three clocks) and freshness checks.
4. Market baskets and benchmark indexes with point-in-time membership.
5. Relative Strength Scanner (Opportunity radar + per-card table).
6. Momentum and mean-reversion calculations.
7. Trade Thesis Simulator with configurable transfer tax.
8. Card Intelligence page.
9. Market Overview.
10. Watchlist.
11. Data-source status screen.
12. Test fixtures and automated validation (`tests/market.test.ts`, `tests/market-sqlite.test.ts`).

### Automated tests

Mapped to section 17:

| Scenario | Test |
| --- | --- |
| 1 Market-relative performance (+5% vs index +12% = underperforming) | `signals > Scenario 1` |
| 5 Already priced in | `signals > Scenario 5` (overheated, never favourable) and the demo test |
| 6 Trading tax (5,000 -> 6,200 = 890) | `market rules > Scenario 6` |
| 7 Missing or stale data | `point-in-time series > Scenario 7`, `signals > Scenario 7`, `market service > Scenario 7` |
| 8 Future-data leakage | `point-in-time series > Scenario 8`, `market service > Scenario 8` |
| 9 Squad integration (locks, ownership, chemistry engine) | `Scenario 9: Compare in My Squad` |
| 2, 3, 4 (SBC, Evolution, social hype) | Deferred with Stages B and C; nothing pretends to do them |

Also covered: price steps and break-even, thesis exposure and no double counting, index composition bias, basket
rebalancing, regime rules, persistent decline vs recent dip, import validation and rejection reasons, refusal of
unauthorised sources, private imports per owner, watchlist, SQLite adapters, and seeded rules/sources matching
the code.

### Known limitations and missing data

- No authorised live price feed, so out of the box only the demo dataset and user imports have prices.
- No listing depth, completed sales or supply data: liquidity and execution are labelled unavailable everywhere.
- Price-step bands and the 5% tax are community knowledge (`fc27-market-v1`, unverified).
- Scanner thresholds are defaults, not validated against outcomes; that needs Stage D backtesting.
- Fit is a face-stat estimate. PlayStyles, Role+ and sub-attributes aren't weighted yet.
- With the demo switched on, cards you add yourself aren't in the demo's baskets; switch the demo off to build
  baskets from your own cards and imports.
- Imported history backfills basket membership from today's card list; the overview says so because early index
  points can carry survivorship bias.
- Browser build stores imports and the watchlist in localStorage (this device only). Gaffer Bot stores them per
  account.

### Deferred to later stages

- **Stage B**: SBC and Evolution event records, event-to-card mapping, SBC cost solver, Evolution outcome
  validation, SBC/Evolution/scarcity utility models, substitution graph, catalyst calendar, priced-in detection
  around known announcement times, event-driven signals (scenarios 2 and 3).
- **Stage C**: first-party reviews, Bayesian-adjusted ratings, permitted social connectors, mention matching,
  sentiment and intent, duplicate/coordination discounting, Hype Radar, Demand Intent Index (scenario 4).
- **Stage D**: forecast records, outcomes at 1h/6h/24h/72h/7d, walk-forward backtests and model comparison,
  calibration, risk-aware rankings, alerts, Strategy Performance, My Portfolio (holdings, transactions,
  realised/unrealised P&L). The point-in-time clocks in Stage A are what make these leak-free later.

## Gaffer Bot

The same service runs inside Gaffer Bot (`scripts/sync-xilab.mjs` copies `src/market` and `src/intelligence`
into `supabase/functions/_shared/fut/xilab/`). Gaffer Bot adds the `fut` market tables with RLS, Postgres
adapters for these interfaces, `/v1/market/*` routes on `fut-api`, and read-only MCP tools with "fut" in the
name (`get_fut_market_overview`, `get_fut_card_market_intelligence`, `find_fut_market_opportunities`,
`compare_fut_card_relative_value`, `analyze_fut_trade_thesis`). All of it stays off until `FUT_ENABLED=true`.

## Price capture extension

Build and load (Chrome or Edge):

```sh
npm run build:extension        # writes extension/dist
```

1. Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and pick the `extension/` folder.
2. In the popup, choose your market (Console or PC).
3. Use the Web App as normal. Every transfer-market search you run is recorded.
4. **Download CSV**, then import it in Market Lab > Import prices or with `npm run market -- import --file`.

The response format is checked defensively (`src/market/capture.ts`): anything that doesn't look like a
transfer-market search result is skipped, never guessed. The field names follow the Web App's known payload and
weren't verified against FC 27 from the build sandbox, so the first real capture confirms them. Promo, Icon and
Hero items only match once those cards exist in the card database. Until then their captured prices are **held**,
privately (`market_capture_holds`, migration 0005), with EA's ids for the item (rare flag, club, league, nation,
position) so you can tell what they are. They link automatically on a later import once a card with that EA item id
exists (the manual card CSV takes an optional `ea_item_id` column), or by hand from Import prices > "Captured items
not in your cards yet" (only cards with the same rating are offered). `npm run market -- held` lists them and
`npm run market -- relink` links what it can. Linked rows keep their original capture times and say how they were
linked.

## Use it

```sh
npm run dev                                   # http://localhost:5173/market.html
npm run market -- sources                     # providers and their status
npm run market -- import --file prices.csv    # card_id = player_cards.id
npm run market -- overview --platform console
npm run market -- card --id 1234
npm run market -- scan --status research_further,favorable_setup
```
