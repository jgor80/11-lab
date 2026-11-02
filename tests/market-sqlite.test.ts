import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrate, openDb } from "../src/db/sqlite.js";
import { readManualCsv } from "../src/import/adapters/manual.js";
import { importRecords } from "../src/import/writer.js";
import { SqliteCaptureHoldStore, SqliteMarketCardSource, SqliteMembershipStore, SqlitePriceStore, SqliteWatchlistStore, categoryOf, loadMarketRules, loadPriceSources } from "../src/db/market-store.js";
import { DEFAULT_BASKETS, DEFAULT_PRICE_SOURCES, FC27_MARKET_V1, createMarketService } from "../src/market/index.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

describe("Market Lab on the SQLite card database", () => {
  it("0005 adds the capture source to a database that already has prices, keeping them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xilab-mig-"));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < "0005")) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const db = openDb(":memory:");
    migrate(db, dir);
    importRecords(db, readManualCsv(fixture("manual-cards.csv")), { sourceId: "manual" });
    const id = Number((db.prepare("SELECT id FROM player_cards LIMIT 1").get() as { id: number }).id);
    db.prepare("INSERT INTO market_price_observations (card_id, platform, price, observed_at, received_at, source_id, owner_id, evidence) VALUES (?, 'console', 1000, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'user_import', 'jeff', 'estimate')").run(id);
    db.prepare("INSERT INTO market_provider_runs (source_id, started_at, status) VALUES ('user_import', '2026-11-01T00:00:00Z', 'succeeded')").run();
    expect(migrate(db)).toEqual(["0005_market_capture.sql"]);
    expect(db.prepare("SELECT count(*) AS n FROM market_price_observations").get()).toEqual({ n: 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => db.prepare("INSERT INTO market_price_observations (card_id, platform, price, observed_at, received_at, source_id, evidence) VALUES (?, 'pc', 1000, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'nope', 'estimate')").run(id)).toThrow(/FOREIGN KEY/);
    expect(loadPriceSources(db).find((s) => s.id === "web_app_capture")?.kind).toBe("browser_capture");

    // A manual card can carry EA's item id, so captures of it match on import.
    importRecords(db, readManualCsv("card_key,name,version,overall,positions,nation,ea_item_id\npromo-1,Promo Test,TOTW,91,ST,Testland,50570001\n"), { sourceId: "manual" });
    expect((await new SqliteMarketCardSource(db).list()).find((c) => c.name === "Promo Test")?.ea_item_id).toBe(50_570_001);

    const holds = new SqliteCaptureHoldStore(db);
    const obs = { card_id: "", platform: "pc" as const, price: 5000, observed_at: "2026-11-02T00:00:00.000Z", received_at: "2026-11-02T00:01:00.000Z", season: "FC27", source_id: "web_app_capture", evidence: "game_data" as const };
    const h = { ea_item_id: 50_570_001, asset_id: 570_001, rating: 91, details: { rare_flag: 3 }, observation: obs };
    expect(await holds.hold("jeff", [h, h])).toEqual({ held: 1, skipped: 1 });
    expect(await holds.list("jeff")).toEqual([h]);
    expect(await holds.list("bob")).toEqual([]);
    await holds.release("jeff", [h]);
    expect(await holds.list("jeff")).toEqual([]);
  });


  it("seeded rules and sources match the code defaults", () => {
    const db = openDb(":memory:");
    migrate(db);
    const { notes: _a, ...dbRules } = loadMarketRules(db);
    const { notes: _b, ...codeRules } = FC27_MARKET_V1;
    expect(dbRules).toEqual(codeRules);
    const seeded = loadPriceSources(db).map((s) => [s.id, s.status, s.is_demo, s.permissions]);
    const code = [...DEFAULT_PRICE_SOURCES].sort((a, b) => a.id.localeCompare(b.id)).map((s) => [s.id, s.status, s.is_demo, s.permissions]);
    expect(seeded).toEqual(code);
  });

  it("uses the existing card records, imports prices privately and keeps a watchlist", async () => {
    const db = openDb(":memory:");
    migrate(db);
    importRecords(db, readManualCsv(fixture("manual-cards.csv")), { sourceId: "manual" });
    const cards = new SqliteMarketCardSource(db);
    const list = await cards.list();
    expect(list.length).toBe(2);
    const id = list[0]!.id;
    expect(list[0]!.positions.length).toBeGreaterThan(0);
    const A = "2026-11-02T12:00:00.000Z";
    const svc = createMarketService({
      prices: new SqlitePriceStore(db),
      memberships: new SqliteMembershipStore(db, DEFAULT_BASKETS),
      watchlists: new SqliteWatchlistStore(db),
      cards,
      sources: loadPriceSources(db),
      rules: loadMarketRules(db),
      now: () => A,
    });
    const csv = ["card_id,platform,price,observed_at", ...Array.from({ length: 12 }, (_, i) => `${id},console,${20_000 + i * 250},${new Date(Date.parse(A) - (12 - i) * 3_600_000).toISOString()}`), `99999,console,1000,${A}`].join("\n");
    const r = await svc.importPriceHistory("jeff", csv);
    expect(r).toMatchObject({ accepted: 12, inserted: 12 });
    expect(r.rejected[0]!.reason).toMatch(/Unknown card_id/);
    expect((await svc.importPriceHistory("jeff", csv)).inserted).toBe(0);
    const ci = await svc.getCardMarketIntelligence("jeff", id);
    expect(ci.price.latest).toBe(22_750);
    expect((await svc.getCardMarketIntelligence("other", id)).price.latest).toBeNull();
    await svc.addToWatchlist("jeff", { card_id: id, platform: "console", target_buy: 21_000 });
    expect((await svc.getWatchlist("jeff")).items[0]!.price_at_add).toBe(22_750);
    const members = await new SqliteMembershipStore(db, DEFAULT_BASKETS).list("market");
    expect(members.every((m) => m.backfilled)).toBe(true);
  });

  it("maps card versions to categories", () => {
    expect(categoryOf("base", false, false)).toBe("base");
    expect(categoryOf("TOTW 3", false, false)).toBe("promo");
    expect(categoryOf("Icon", true, false)).toBe("icon");
    expect(categoryOf("Evolution", false, false)).toBe("evolution");
  });
});
