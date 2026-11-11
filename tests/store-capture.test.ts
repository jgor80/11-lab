import { describe, expect, it } from "vitest";
import {
  isOwnedPackOpen, isPackOpen, isPurchasedItems, isStoreLike, isStoreResponse, mergeOdds, mergePacks, mergePulls, mergeSeen, packIdFromBody, parseOdds, parseStoreStrings,
  nameStoredPacks, packText, storeSeen, storePath, storeShape, summarizeOddsOnly, summarizePulls, summarizeStore,
} from "../src/store/capture.js";
import { buildStoreExport, packPlan, PULL_BATCH } from "../src/market/upload.js";

const HOST = "https://utas.mob.v1.prd.futc-ext.gcp.ea.com:443/ut/game/fc27";
const NOW = Date.UTC(2026, 10, 9, 18, 0);

// The FC 26 shape community clients read (purchase[] with packContentInfo and packOdds). Values made up.
const store = {
  id: "all", timestamp: 1, packOddsAvailabilityState: "AVAILABLE",
  purchase: [
    {
      id: 101, state: "available", type: "pack", nameLoc: "FUT_STORE_PACK_101_NAME", descriptionLoc: "FUT_STORE_PACK_101_DESC",
      coins: 7500, points: 100, untradeable: false, purchaseLimit: 0, purchaseCount: 0, secondsUntilEnd: 3600, packType: "GOLD",
      packContentInfo: { itemQuantity: 12, goldQuantity: 12, silverQuantity: 0, bronzeQuantity: 0, rareQuantity: 3, contentType: "players" },
      packOdds: [
        { packId: 101, tierId: 1, categoryId: 5, oddsFormatted: "12%", packOddsCategory: { categoryId: 5, tierId: 1, description: "Player 84+ OVR", qualityId: 3, packOddsRules: [{ ruleType: 1, ruleValue: 84 }] } },
        { packId: 101, tierId: 1, categoryId: 6, oddsFormatted: "100%", packOddsCategory: { categoryId: 6, tierId: 1, description: "Rare Gold Player 75+", packOddsRules: [] } },
        { packId: 101, tierId: 1, categoryId: 7, oddsFormatted: "<1%", packOddsCategory: { categoryId: 7, description: "Special Item (TOTW)", packOddsRules: [] } },
      ],
    },
    { id: 102, type: "pack", nameLoc: "FUT_STORE_PACK_102_NAME", points: 300, untradeable: true, packContentInfo: { itemQuantity: 5 }, packOdds: [], end: 1794268800 },
    { id: 900, type: "bundle", nameLoc: "FC_POINTS_1050", points: 0 },
  ],
};

describe("pack store capture", () => {
  it("knows the store, pack-open and pile addresses", () => {
    expect(isStoreResponse(`${HOST}/store/purchaseGroup/all?ppInfo=true&categoryInfo=true`)).toBe(true);
    expect(isStoreResponse(`${HOST}/transfermarket?num=21`)).toBe(false);
    expect(isPackOpen(`${HOST}/store/purchaseGroup/cardpack`)).toBe(true);
    expect(isOwnedPackOpen(`${HOST}/purchased/items/12345`)).toBe(true);
    expect(isPurchasedItems(`${HOST}/purchased/items`)).toBe(true);
  });

  it("reads EA's odds text", () => {
    expect(parseOdds("12%")).toBeCloseTo(0.12);
    expect(parseOdds("<1%")).toBeCloseTo(0.005);
    expect(parseOdds("100 %")).toBe(1);
    expect(parseOdds("1 in 20")).toBeCloseTo(0.05);
    expect(parseOdds("0.25")).toBeCloseTo(0.25);
    expect(parseOdds("rare")).toBeNull();
  });

  it("summarizes packs with prices, contents and odds, and skips non-packs", () => {
    const packs = summarizeStore(store, { FUT_STORE_PACK_101_NAME: "Rare Gold Pack" }, NOW);
    expect(packs.map((p) => p.pack_id)).toEqual([101, 102]);
    const p = packs[0]!;
    expect(p).toMatchObject({ name: "Rare Gold Pack", coins: 7500, points: 100, untradeable: false, item_count: 12, rare: 3, gold: 12 });
    expect(p.end_at).toBe(new Date(NOW + 3600_000).toISOString());
    expect(p.odds[0]).toMatchObject({ label: "Player 84+ OVR", probability: 0.12, min_rating: 84, max_rating: null, special: false });
    expect(p.odds[1]).toMatchObject({ min_rating: 75, probability: 1 });
    expect(p.odds[2]).toMatchObject({ special: true, probability: 0.005 });
    expect(packs[1]).toMatchObject({ name: null, name_key: "FUT_STORE_PACK_102_NAME", coins: null, points: 300, untradeable: true, end_at: new Date(1794268800_000).toISOString() });
  });

  it("reads the older purchaseGroup shape too", () => {
    const old = { purchaseGroup: [{ packs: [{ id: 5, coins: 5000, packContentInfo: { itemQuantity: 12 } }] }] };
    expect(summarizeStore(old).map((p) => p.coins)).toEqual([5000]);
  });

  it("keeps field names only for the shape check", () => {
    const shape = storeShape(store);
    expect(shape.pack_keys).toContain("packOdds");
    expect(shape.odds_keys).toContain("oddsFormatted");
    expect(shape.category_keys).toContain("packOddsRules");
    expect(JSON.stringify(shape)).not.toContain("7500");
  });

  it("keeps only store-looking strings", () => {
    expect(parseStoreStrings({ FUT_STORE_PACK_101_NAME: "Rare Gold Pack", "global.teamFull.2027.1": "Arsenal" })).toEqual({ FUT_STORE_PACK_101_NAME: "Rare Gold Pack" });
  });

  it("credits pulls to the opened pack and merges them once per item", () => {
    expect(packIdFromBody('{"packId":101,"currency":"COINS"}')).toBe(101);
    expect(packIdFromBody(null)).toBeNull();
    const pulls = summarizePulls({ itemList: [{ id: 1, resourceId: 50_000, rating: 86, rareflag: 1, untradeable: false, itemType: "player" }, { id: 2 }] }, 101, "2026-11-09T18:00:00.000Z");
    expect(pulls).toEqual([{ item_id: 1, ea_item_id: 50_000, item_type: "player", rating: 86, rare_flag: 1, untradeable: false, pack_id: 101, opened_at: "2026-11-09T18:00:00.000Z" }]);
    const again = summarizePulls({ itemData: [{ id: 1, resourceId: 50_000 }] }, null, "2026-11-09T18:01:00.000Z");
    expect(mergePulls(pulls, again)).toHaveLength(1);
    expect(mergePulls(pulls, again)[0]!.pack_id).toBe(101);
  });

  it("keeps the newest copy of each pack and drops stale ones", () => {
    const [a] = summarizeStore(store, {}, NOW);
    const old = { ...a!, pack_id: 77, seen_at: "2026-10-01T00:00:00.000Z" };
    const merged = mergePacks([old], [{ ...a!, coins: 8000 }], "2026-11-09T18:00:00.000Z");
    expect(merged.map((p) => [p.pack_id, p.coins])).toEqual([[101, 8000]]);
  });

  it("plans pack uploads: the store when it changed, pulls not sent yet", () => {
    const pull = (m: number) => ({ item_id: m, ea_item_id: 9, item_type: null, rating: 80, rare_flag: 1, untradeable: false, pack_id: null, opened_at: new Date(NOW + m * 60_000).toISOString() });
    expect(packPlan({})).toEqual({ store: false, seen: false, pulls: [] });
    expect(packPlan({ last_store: "a", store_sent: "a", pulls: [pull(1), pull(2)], pulls_sent_until: pull(1).opened_at })).toEqual({ store: false, seen: false, pulls: [pull(2)] });
    expect(packPlan({ last_store_seen: "b", store_seen_sent: "a" }).seen).toBe(true);
    expect(packPlan({ last_store: "b", store_sent: "a" }).store).toBe(true);
    expect(packPlan({ pulls: Array.from({ length: PULL_BATCH + 5 }, (_, i) => pull(i)) }).pulls).toHaveLength(PULL_BATCH);
    const file = buildStoreExport([{ ...summarizeStore(store, {}, NOW)[0]!, seen_at: "x" }], [], null, "console", "t");
    expect(file).toMatchObject({ format: "xilab-store-capture", platform: "console", captured_at: "t" });
    expect((file.packs[0] as { seen_at?: string }).seen_at).toBe("x");
  });

  it("reads other store, pack and odds addresses and logs them without values", () => {
    expect(isStoreLike(`${HOST}/store/purchaseGroup/all?ppInfo=true`)).toBe(true);
    expect(isStoreLike(`${HOST}/store/packodds/101`)).toBe(true);
    expect(isStoreLike(`${HOST}/packs/available`)).toBe(true);
    expect(isStoreLike(`${HOST}/store/purchaseGroup/cardpack`)).toBe(false);
    expect(isStoreLike(`${HOST}/club?type=player`)).toBe(false);
    expect(storePath(`${HOST}/store/packodds/101?x=1`)).toBe("/store/packodds/N");
    const seen = storeSeen(`${HOST}/store/v2/list`, { groups: [], secret: 5 }, 0, 0, "t");
    expect(seen).toEqual({ path: "/store/vN/list", keys: ["groups", "secret"], packs: 0, odds: 0, at: "t" });
    expect(mergeSeen([{ ...seen, at: "old" }, { ...seen, path: "/x" }], seen).map((x) => [x.path, x.at])).toEqual([["/store/vN/list", "t"], ["/x", "t"]]);
  });

  it("finds packs nested in an unfamiliar answer, with id or packId and other odds list names", () => {
    const nested = { data: { sections: [{ title: "Gold", items: [
      { packId: 555, coins: 5000, packContentInfo: { itemQuantity: 12 }, odds: [{ oddsFormatted: "5%", packOddsCategory: { description: "Player 84+ OVR" } }] },
      { packId: 556, currencies: [{ name: "COINS", finalFunds: 2000 }] },
      { packId: 557, type: "bundle", currencies: [{ name: "COINS", finalFunds: 2000 }] },
    ] }] } };
    const packs = summarizeStore(nested, {}, NOW);
    expect(packs.map((p) => [p.pack_id, p.coins, p.odds.length])).toEqual([[555, 5000, 1], [556, 2000, 0]]);
    expect(packs[0]!.odds[0]!.min_rating).toBe(84);
  });

  it("takes odds that come on their own and fills them in on the pack", () => {
    const odds = summarizeOddsOnly({ packOdds: [{ oddsFormatted: "<1%", packOddsCategory: { description: "Icon" } }] }, `${HOST}/store/packodds/101`);
    expect(odds?.pack_id).toBe(101);
    expect(odds?.odds[0]!.special).toBe(true);
    const [a] = summarizeStore(store, {}, NOW);
    const bare = { ...a!, odds: [], seen_at: "s" };
    const held = mergeOdds([], undefined, [odds!]);
    expect(held.held["101"]).toHaveLength(1);
    const later = mergeOdds([bare], held.held, []);
    expect(later.packs[0]!.odds).toHaveLength(1);
    expect(later.held).toEqual({});
  });

  it("a later copy without a price or odds keeps what the older one had", () => {
    const [a] = summarizeStore(store, {}, NOW);
    const merged = mergePacks([{ ...a!, seen_at: "2026-11-09T17:00:00.000Z" }], [{ ...a!, coins: null, odds: [] }], "2026-11-09T18:00:00.000Z");
    expect(merged[0]!.coins).toBe(7500);
    expect(merged[0]!.odds.length).toBe(a!.odds.length);
  });

  it("names packs from display text, the Web App's strings or EA's usual store keys", () => {
    expect(packText({ name: "Rare Gold Pack" }, 1).name).toBe("Rare Gold Pack");
    expect(packText({ nameLoc: "FUT_X_NAME" }, 1, { FUT_X_NAME: "Gold Pack" })).toMatchObject({ name: "Gold Pack", name_key: "FUT_X_NAME" });
    expect(packText({}, 101, { FUT_STORE_PACK_101_NAME: "Premium Gold", FUT_STORE_PACK_101_DESC: "12 gold items" })).toEqual({ name: "Premium Gold", name_key: "FUT_STORE_PACK_101_NAME", description: "12 gold items" });
    expect(packText({ assetId: 7 }, 101, { FUT_STORE_PACK_7_NAME: "By art id" }).name).toBe("By art id");
    expect(packText({ nameLoc: "FUT_UNKNOWN" }, 1)).toMatchObject({ name: null, name_key: "FUT_UNKNOWN" });
    const [later] = nameStoredPacks([{ ...summarizeStore({ purchase: [{ id: 55, coins: 100 }] }, {}, NOW)[0]!, seen_at: "s" }], { FUT_STORE_PACK_55_NAME: "Late name" });
    expect(later!.name).toBe("Late name");
  });

  it("keeps a picture address and art id from the store item", () => {
    const [p] = summarizeStore({ purchase: [{ id: 9, coins: 100, assetId: 3021, imageUrl: "https://www.ea.com/x/packs/pack_3021.png?v=2" }] }, {}, NOW);
    expect(p).toMatchObject({ asset_id: 3021, image_url: "https://www.ea.com/x/packs/pack_3021.png" });
    expect(summarizeStore({ purchase: [{ id: 9, coins: 100, imageUrl: "https://evil.example/p.png" }] }, {}, NOW)[0]!.image_url).toBeNull();
  });

  it("reads when a pack leaves the store from a countdown, an epoch or a date", () => {
    const at = (x: Record<string, unknown>) => summarizeStore({ purchase: [{ id: 1, coins: 100, ...x }] }, {}, NOW)[0]!.end_at;
    expect(at({ secondsUntilEnd: 3600 })).toBe(new Date(NOW + 3_600_000).toISOString());
    expect(at({ expiryTime: Math.floor(NOW / 1000) + 60 })).toBe(new Date(NOW + 60_000).toISOString());
    expect(at({ availability: { endDate: "2026-11-14T18:00:00Z" } })).toBe("2026-11-14T18:00:00.000Z");
    expect(at({ end: "soon" })).toBeNull();
  });
});
