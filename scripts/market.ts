// Market Lab on the local database (e.g. Jeff's server copy with the FC 27 cards).
//   npm run market -- import --file prices.csv [--owner local] [--source user_import]
//   npm run market -- overview [--platform console|pc]
//   npm run market -- card --id 1234
//   npm run market -- scan [--status favorable_setup,research_further]
//   npm run market -- sources
// Price CSV header: card_id,platform,price,observed_at,kind,event_at  (card_id = player_cards.id)
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { migrate, openDb } from "../src/db/sqlite.js";
import { SqliteCaptureHoldStore, SqliteMarketCardSource, SqliteMembershipStore, SqlitePriceStore, SqliteWatchlistStore, loadMarketRules, loadPriceSources } from "../src/db/market-store.js";
import { DEFAULT_BASKETS, createMarketService, type Platform, type SignalStatus } from "../src/market/index.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string", default: "xi-lab.sqlite" },
    file: { type: "string" },
    owner: { type: "string", default: "local" },
    source: { type: "string", default: "user_import" },
    platform: { type: "string", default: "console" },
    id: { type: "string" },
    status: { type: "string" },
    "as-of": { type: "string" },
  },
});

const db = openDb(values.db!);
migrate(db);
const svc = createMarketService({
  prices: new SqlitePriceStore(db),
  memberships: new SqliteMembershipStore(db, DEFAULT_BASKETS),
  watchlists: new SqliteWatchlistStore(db),
  cards: new SqliteMarketCardSource(db),
  holds: new SqliteCaptureHoldStore(db),
  sources: loadPriceSources(db),
  rules: loadMarketRules(db),
});
const owner = values.owner!;
const platform = values.platform as Platform;
const as_of = values["as-of"];
const out = (x: unknown) => console.log(JSON.stringify(x, null, 2));

switch (positionals[0]) {
  case "import": {
    if (!values.file) throw new Error("--file is required");
    const r = await svc.importPriceHistory(owner, readFileSync(values.file, "utf8"), { source_id: values.source });
    console.log(`${r.accepted} accepted, ${r.inserted} new, ${r.skipped} already stored, ${r.duplicates} duplicate rows, ${r.rejected.length} rejected, ${r.held} held for cards not in the database, ${r.linked_from_held} linked from earlier holds.`);
    for (const x of r.rejected.slice(0, 20)) console.log(`  line ${x.line}: ${x.reason}`);
    break;
  }
  case "overview":
    out(await svc.getMarketOverview(owner, { platform, as_of }));
    break;
  case "card":
    if (!values.id) throw new Error("--id is required");
    out(await svc.getCardMarketIntelligence(owner, values.id, { platform, as_of }));
    break;
  case "scan":
    out(await svc.findMarketOpportunities(owner, { platform, as_of, status: values.status?.split(",") as SignalStatus[] | undefined }));
    break;
  case "held":
    out(await svc.getHeldCaptures(owner));
    break;
  case "relink":
    out(await svc.relinkHeldCaptures(owner));
    break;
  case "sources":
    for (const s of svc.getDataSourceStatus()) console.log(`[${s.status}] ${s.name}: ${s.status_note}`);
    break;
  default:
    console.error("Commands: import, overview, card, scan, held, relink, sources");
    process.exit(1);
}
