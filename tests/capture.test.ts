// Passive Web App capture: which responses count, how a results page becomes observations, and how the
// capture CSV is imported against EA item ids. The response fixture is shaped like the Web App's transfer-market
// search payload; field names are unverified against FC 27 until Jeff's first real capture.
import { describe, expect, it } from "vitest";
import {
  CAPTURE_CSV_HEADER,
  MemoryMarketCardSource,
  MemoryMembershipStore,
  MemoryPriceStore,
  MemoryWatchlistStore,
  captureRowsToCsv,
  createMarketService,
  isTransferMarketSearch,
  summarizeSearch,
  type MarketCard,
} from "../src/market/index.js";
import { mergeRows } from "../extension/src/store.js";

const A = "2026-11-02T12:00:00.000Z";
const at = (h: number) => new Date(Date.parse(A) - h * 3_600_000).toISOString();

const card = (id: string, extra: Partial<MarketCard> = {}): MarketCard => ({
  id, name: id, club: "C", league: "L", nation: "N", positions: ["ST"], rating: 88, category: "base", tradeable: true, source: "fixture", stats: {}, ...extra,
});

const listing = (resourceId: number, buyNowPrice: number, extra: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  tradeState: "active", buyNowPrice, startingBid: 150, ...extra, itemData: { resourceId, assetId: resourceId % 1_000_000, rating: 88, itemType: "player", ...item },
});

describe("which Web App responses are captured", () => {
  it("only transfer-market searches", () => {
    expect(isTransferMarketSearch("https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc27/transfermarket?num=21&start=0&type=player&maskedDefId=239085")).toBe(true);
    expect(isTransferMarketSearch("/ut/game/fc26/transfermarket?type=player")).toBe(true);
    expect(isTransferMarketSearch("https://x/ut/game/fc27/tradepile")).toBe(false);
    expect(isTransferMarketSearch("https://x/ut/game/fc27/watchlist")).toBe(false);
    expect(isTransferMarketSearch("https://x/ut/game/fc27/trade/123/bid")).toBe(false);
    expect(isTransferMarketSearch("https://x/ut/game/fc27/transfermarket/extra")).toBe(false);
  });
});

describe("summarizeSearch", () => {
  it("one row per item: lowest active Buy Now and listing count", () => {
    const rows = summarizeSearch(
      { auctionInfo: [listing(239085, 21_000), listing(239085, 20_500), listing(239085, 19_000, { tradeState: "closed" }), listing(50_331_648 + 1, 900), listing(7, 0)] },
      { observed_at: A, platform: "console" },
    );
    expect(rows).toEqual([
      { ea_item_id: 239085, asset_id: 239085, rating: 88, platform: "console", price: 20_500, listings: 2, observed_at: A },
      { ea_item_id: 50_331_649, asset_id: 331_649, rating: 88, platform: "console", price: 900, listings: 1, observed_at: A },
    ]);
  });

  it("skips non-players, junk and unexpected shapes instead of guessing", () => {
    expect(summarizeSearch({ auctionInfo: [listing(1, 500, {}, { itemType: "contract" }), null, { buyNowPrice: 400 }, listing(2, 1.5)] }, { observed_at: A, platform: "pc" })).toEqual([]);
    expect(summarizeSearch({}, { observed_at: A, platform: "pc" })).toEqual([]);
    expect(summarizeSearch(null, { observed_at: A, platform: "pc" })).toEqual([]);
  });

  it("writes the CSV the importer reads", () => {
    const csv = captureRowsToCsv(summarizeSearch({ auctionInfo: [listing(239085, 20_500)] }, { observed_at: A, platform: "pc" }));
    expect(csv.split("\n")).toEqual([CAPTURE_CSV_HEADER, `239085,239085,88,pc,20500,${A},lowest_bin,1`]);
  });
});

describe("extension storage", () => {
  it("dedupes re-fetches within a minute, keeps the lowest price", () => {
    const r = { ea_item_id: 1, asset_id: 1, rating: 88, platform: "console" as const, price: 1000, listings: 3, observed_at: "2026-11-02T10:00:05.000Z" };
    const merged = mergeRows([r], [{ ...r, price: 950, listings: 2, observed_at: "2026-11-02T10:00:40.000Z" }, { ...r, observed_at: "2026-11-02T10:01:00.000Z" }, { ...r, platform: "pc" }]);
    expect(merged).toHaveLength(3);
    expect(merged.find((x) => x.platform === "console" && x.observed_at.startsWith("2026-11-02T10:00"))).toMatchObject({ price: 950, listings: 3 });
  });
});

describe("importing a capture file", () => {
  const cards = [card("100", { ea_item_id: 239085, rating: 88 }), card("200", { ea_item_id: 1234, rating: 84 })];
  const svc = () =>
    createMarketService({ prices: new MemoryPriceStore(), memberships: new MemoryMembershipStore(), watchlists: new MemoryWatchlistStore(), cards: new MemoryMarketCardSource(cards), now: () => A });

  it("matches EA item ids, stores as Web App captures, rejects what it can't match", async () => {
    const s = svc();
    const csv = [
      CAPTURE_CSV_HEADER,
      ...Array.from({ length: 8 }, (_, i) => `239085,239085,88,console,${20_000 + i * 250},${at(8 - i)},lowest_bin,5`),
      `50570000,1234,84,console,3000,${at(1)},lowest_bin,2`, // unknown item id, but asset id + rating match base card 200
      `50570001,1234,91,console,90000,${at(1)},lowest_bin,1`, // a promo version we don't have: asset matches, rating doesn't
      `999999,,,console,500,${at(1)},lowest_bin,1`,
    ].join("\n");
    const res = await s.importPriceHistory("jeff", csv);
    expect(res.accepted).toBe(9);
    expect(res.rejected).toHaveLength(2);
    const intel = await s.getCardMarketIntelligence("jeff", "100");
    expect(intel.price.latest).toBe(21_750);
    const sources = await s.getDataSourceStatus();
    expect(JSON.stringify(sources)).toMatch(/web_app_capture/);
    expect((await s.getCardMarketIntelligence("someone-else", "100")).price.latest).toBeNull();
  });
});
