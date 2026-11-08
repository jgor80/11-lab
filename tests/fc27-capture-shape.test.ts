// Pins the helper's parsers to the FC 27 Web App traffic captured on 2026-11-08 (docs/web-app-endpoints.md).
// URLs and field names are real; seller fields and ids are replaced, prices are from the capture.
import { describe, expect, it } from "vitest";
import { isTransferMarketSearch, summarizeSearch } from "../src/market/capture.js";
import { learnTemplate } from "../src/market/pricecheck.js";

const HOST = "https://utas.mob.v1.prd.futc-ext.gcp.ea.com:443/ut/game/fc27";
const SEARCH = `${HOST}/transfermarket?num=21&start=0&type=player&maskedDefId=256079&zone=midfield&lev=gold&maxb=7000`;
const POLL = `${HOST}/trade/status/lite?tradeIds=621470383242,621470389042`;

const listing = (tradeId: number, buyNowPrice: number, lastSalePrice: number) => ({
  tradeId, tradeIdStr: String(tradeId), tradeState: "active", bidState: "none", buyNowPrice, startingBid: buyNowPrice - 100,
  currentBid: 0, offers: 0, expires: 45, watched: false, tradeOwner: false, confidenceValue: 100,
  sellerName: "REDACTED", sellerId: 0, sellerEstablished: 0,
  itemData: {
    id: tradeId + 1, resourceId: 256079, assetId: 256079, rating: 86, itemType: "player", rareflag: 0, preferredPosition: "CDM",
    possiblePositions: ["CDM", "CM"], teamid: 5, leagueId: 13, nation: 1, gender: 0, resourceGameYear: 2027, itemState: "forSale",
    untradeable: false, marketAverage: 4945, lastSalePrice, discardValue: 344,
  },
});

describe("FC 27 Web App capture (2026-11-08)", () => {
  it("recognises the real search URL (explicit :443) and ignores the results-screen poll", () => {
    expect(isTransferMarketSearch(SEARCH)).toBe(true);
    expect(isTransferMarketSearch(POLL)).toBe(false);
  });

  it("reads the real response shape: lowest active Buy Now per card", () => {
    const json = { auctionInfo: [listing(1, 6200, 5300), listing(2, 5400, 0), listing(3, 6800, 16000)], bidTokens: {} };
    const [r] = summarizeSearch(json, { observed_at: "2026-11-08T00:55:00Z", platform: "console" });
    expect(r).toMatchObject({ ea_item_id: 256079, asset_id: 256079, rating: 86, price: 5400, listings: 3 });
    expect(r?.details).toMatchObject({ rare_flag: 0, team_id: 5, league_id: 13, nation_id: 1, position: "CDM" });
  });

  it("skips poll rows, whose itemData is stripped", () => {
    const poll = { auctionInfo: [{ tradeId: 1, tradeState: "active", buyNowPrice: 6200, expires: 30, itemData: { resourceId: 0 } }] };
    expect(summarizeSearch(poll, { observed_at: "2026-11-08T00:55:00Z", platform: "console" })).toEqual([]);
  });

  it("learns a template from the real name search, dropping the price filter", () => {
    const t = learnTemplate(SEARCH)!;
    const u = new URL(t);
    expect(u.searchParams.get("maskedDefId")).toBe("256079");
    expect(u.searchParams.get("lev")).toBe("gold");
    expect(u.searchParams.has("maxb")).toBe(false);
    expect(u.searchParams.get("start")).toBe("0");
  });
});
