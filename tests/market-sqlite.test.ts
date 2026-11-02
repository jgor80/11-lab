import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db/sqlite.js";
import { readManualCsv } from "../src/import/adapters/manual.js";
import { importRecords } from "../src/import/writer.js";
import { SqliteMarketCardSource, SqliteMembershipStore, SqlitePriceStore, SqliteWatchlistStore, categoryOf, loadMarketRules, loadPriceSources } from "../src/db/market-store.js";
import { DEFAULT_BASKETS, DEFAULT_PRICE_SOURCES, FC27_MARKET_V1, createMarketService } from "../src/market/index.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

describe("Market Lab on the SQLite card database", () => {
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
