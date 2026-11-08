// Passive Web App capture: which responses count, how a results page becomes observations, and how the
// capture CSV is imported against EA item ids. The response fixture is shaped like the Web App's transfer-market
// search payload; field names are unverified against FC 27 until Jeff's first real capture.
import { describe, expect, it } from "vitest";
import {
  CAPTURE_CSV_HEADER,
  MemoryCaptureHoldStore,
  MemoryMarketCardSource,
  MemoryMembershipStore,
  MemoryPriceStore,
  MemoryWatchlistStore,
  captureRowsToCsv,
  createMarketService,
  isTransferMarketSearch,
  summarizeSearch,
  lowestBelievable,
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

  it("skips a lone listing far below the rest (possible coin transfer), but not two that agree", () => {
    expect(lowestBelievable([20_000, 4_000, 21_000, 20_500])).toBe(20_000);
    expect(lowestBelievable([20_000, 4_000, 4_100, 21_000])).toBe(4_000);
    expect(lowestBelievable([20_000, 4_000])).toBe(4_000);
    expect(lowestBelievable([20_000, 12_000, 21_000])).toBe(12_000);
    const [r] = summarizeSearch({ auctionInfo: [listing(239085, 21_000), listing(239085, 900), listing(239085, 20_500)] }, { observed_at: A, platform: "console" });
    expect(r).toMatchObject({ price: 20_500, listings: 3 });
  });

  it("keeps EA's marketAverage and past sale prices (non-zero) per item", () => {
    const [r] = summarizeSearch({ auctionInfo: [
      listing(239085, 5_300, {}, { marketAverage: 4_945, lastSalePrice: 1_200 }), listing(239085, 9_400, {}, { marketAverage: 4_945, lastSalePrice: 0 }),
      listing(239085, 6_000, {}, { marketAverage: 4_945, lastSalePrice: 16_000 }),
    ] }, { observed_at: A, platform: "console" });
    expect(r).toMatchObject({ price: 5_300, market_average: 4_945, last_sales: [1_200, 16_000] });
    expect(captureRowsToCsv([r!]).split("\n")[1]!.endsWith(",4945,1200;16000")).toBe(true);
    const [plain] = summarizeSearch({ auctionInfo: [listing(1, 500)] }, { observed_at: A, platform: "pc" });
    expect(plain!.market_average).toBeUndefined();
    expect(plain!.last_sales).toBeUndefined();
  });

  it("skips non-players, junk and unexpected shapes instead of guessing", () => {
    expect(summarizeSearch({ auctionInfo: [listing(1, 500, {}, { itemType: "contract" }), null, { buyNowPrice: 400 }, listing(2, 1.5)] }, { observed_at: A, platform: "pc" })).toEqual([]);
    expect(summarizeSearch({}, { observed_at: A, platform: "pc" })).toEqual([]);
    expect(summarizeSearch(null, { observed_at: A, platform: "pc" })).toEqual([]);
  });

  it("keeps EA's ids for the item so an unmatched capture can be identified later", () => {
    const [r] = summarizeSearch({ auctionInfo: [listing(50_570_001, 90_000, {}, { rating: 91, rareflag: 3, teamid: 10, leagueId: 13, nation: 14, preferredPosition: "ST" })] }, { observed_at: A, platform: "console" });
    expect(r!.details).toEqual({ rare_flag: 3, team_id: 10, league_id: 13, nation_id: 14, position: "ST" });
    expect(captureRowsToCsv([r!]).split("\n")[1]).toBe(`50570001,570001,91,console,90000,${A},lowest_bin,1,3,10,13,14,ST,,`);
  });

  it("writes the CSV the importer reads", () => {
    const csv = captureRowsToCsv(summarizeSearch({ auctionInfo: [listing(239085, 20_500)] }, { observed_at: A, platform: "pc" }));
    expect(csv.split("\n")).toEqual([CAPTURE_CSV_HEADER, `239085,239085,88,pc,20500,${A},lowest_bin,1,,,,,,,`]);
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

describe("captures for cards not in the database yet", () => {
  it("are held privately, listed for the user, and linked once the card is added", async () => {
    const cards: MarketCard[] = [card("100", { ea_item_id: 239085, rating: 88 })];
    const s = createMarketService({ prices: new MemoryPriceStore(), memberships: new MemoryMembershipStore(), watchlists: new MemoryWatchlistStore(), cards: new MemoryMarketCardSource(cards), holds: new MemoryCaptureHoldStore(), now: () => A });
    const promo = Array.from({ length: 8 }, (_, i) => `50570001,570001,91,console,${90_000 + i * 1_000},${at(8 - i)},lowest_bin,3,3,10,13,14,ST`);
    const res = await s.importPriceHistory("jeff", [CAPTURE_CSV_HEADER, ...promo, `50570001,570001,91,console,abc,${at(1)},lowest_bin,1,3,,,,`].join("\n"));
    expect(res).toMatchObject({ accepted: 0, held: 8 });
    expect(res.rejected).toHaveLength(1); // the bad price is still rejected, not held
    const held = await s.getHeldCaptures("jeff");
    expect(held.items).toHaveLength(1);
    expect(held.items[0]).toMatchObject({ ea_item_id: 50_570_001, rating: 91, special_version: true, observations: 8, latest_price: 97_000 });
    expect((await s.getHeldCaptures("bob")).items).toHaveLength(0);

    cards.push(card("300", { ea_item_id: 50_570_001, rating: 91, category: "promo" }));
    expect(await s.relinkHeldCaptures("jeff")).toEqual({ linked: 8, still_held: 0 });
    const intel = await s.getCardMarketIntelligence("jeff", "300");
    expect(intel.price.latest).toBe(97_000);
    expect((await s.getHeldCaptures("jeff")).items).toHaveLength(0);
    expect((await s.getCardMarketIntelligence("bob", "300")).price.latest).toBeNull();
    // Importing the same file again stores nothing new.
    expect((await s.importPriceHistory("jeff", [CAPTURE_CSV_HEADER, ...promo].join("\n"))).inserted).toBe(0);
  });
});

describe("linking a held capture by hand", () => {
  it("links to a card you pick, only when the rating matches", async () => {
    const cards: MarketCard[] = [card("u1", { rating: 91, name: "My promo" }), card("u2", { rating: 85 })];
    const s = createMarketService({ prices: new MemoryPriceStore(), memberships: new MemoryMembershipStore(), watchlists: new MemoryWatchlistStore(), cards: new MemoryMarketCardSource(cards), holds: new MemoryCaptureHoldStore(), now: () => A });
    const rows = Array.from({ length: 7 }, (_, i) => `50570001,570001,91,pc,${60_000 + i * 500},${at(7 - i)},lowest_bin,2,3,,,,CAM`);
    expect((await s.importPriceHistory("jeff", [CAPTURE_CSV_HEADER, ...rows].join("\n"))).held).toBe(7);
    await expect(s.linkHeldCapture("jeff", 50_570_001, "u2")).rejects.toThrow(/rated 91/);
    await expect(s.linkHeldCapture("jeff", 50_570_001, "nope")).rejects.toThrow(/isn't one of yours/);
    expect(await s.linkHeldCapture("jeff", 50_570_001, "u1")).toEqual({ linked: 7 });
    const intel = await s.getCardMarketIntelligence("jeff", "u1", { platform: "pc" });
    expect(intel.price.latest).toBe(63_000);
    expect((await s.getHeldCaptures("jeff")).items).toHaveLength(0);
  });
});
