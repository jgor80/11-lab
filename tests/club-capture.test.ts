// Club capture: which responses count, how items and names are read, and that unexpected shapes are skipped.
// Fixture shapes follow past seasons' Web App responses; made-up ids and names, no EA data.
import { describe, expect, it } from "vitest";
import {
  buildClubExport, isClubResponse, isLocalisation, isPlayerNames, mergeClubItems, parseLocalisedNames, parsePlayerNames, summarizeClub,
} from "../src/club/capture.js";
import { isTransferMarketSearch } from "../src/market/capture.js";

const player = (id: number, extra: Record<string, unknown> = {}) => ({
  id, resourceId: 1000 + id, assetId: 500 + id, itemType: "player", rating: 85, preferredPosition: "ST", possiblePositions: ["ST", "CF"],
  teamid: 10, leagueId: 13, nation: 14, rareflag: 1, untradeable: true, loans: 0, attributeArray: [90, 88, 75, 84, 40, 80],
  skillmoves: 3, weakfootabilityrating: 4, ...extra,
});

describe("club capture", () => {
  it("recognises club and squad responses only, separately from the market", () => {
    expect(isClubResponse("https://utas.mob.v1.fut.ea.com/ut/game/fc27/club")).toBe("club");
    expect(isClubResponse("/ut/game/fc27/squad/0")).toBe("squad");
    expect(isClubResponse("/ut/game/fc27/squad/active")).toBe("squad");
    expect(isClubResponse("/ut/game/fc27/transfermarket?num=21")).toBeNull();
    expect(isClubResponse("/ut/game/fc27/club/stats/club")).toBeNull();
    expect(isTransferMarketSearch("/ut/game/fc27/club")).toBe(false);
    expect(isPlayerNames("https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/x/2026/fut/items/web/players.json")).toBe(true);
    expect(isLocalisation("https://www.ea.com/ea-sports-fc/ultimate-team/web-app/loc/en_US.json")).toBe(true);
  });

  it("reads players and managers, skips anything unexpected", () => {
    const items = summarizeClub({ itemData: [player(1), player(2, { untradeable: false, loans: 3 }), { id: 3, resourceId: 77, itemType: "manager", nation: 14, leagueId: 13 },
      { id: 4, resourceId: 88, itemType: "consumable" }, { id: 5 }, null, player(6, { attributeArray: [1, 2, 3], preferredPosition: "striker" })] }, "club");
    expect(items.map((i) => i.item_id)).toEqual([1, 2, 3, 6]);
    expect(items[0]).toMatchObject({ ea_item_id: 1001, asset_id: 501, kind: "player", position: "ST", positions: ["ST", "CF"], team_id: 10, league_id: 13, nation_id: 14, untradeable: true, loan: false, stats: [90, 88, 75, 84, 40, 80] });
    expect(items[1]).toMatchObject({ untradeable: false, loan: true });
    expect(items[2]).toMatchObject({ kind: "manager", rating: null, stats: null });
    expect(items[3]).toMatchObject({ position: null, stats: null });
  });

  it("reads squad responses (players and manager wrapped in itemData)", () => {
    const items = summarizeClub({ players: [{ index: 0, itemData: player(7) }], manager: [{ itemData: { id: 8, resourceId: 99, itemType: "manager" } }] }, "squad");
    expect(items.map((i) => [i.item_id, i.kind, i.seen_in])).toEqual([[7, "player", "squad"], [8, "manager", "squad"]]);
  });

  it("reads names from the Web App's own files", () => {
    expect(parsePlayerNames({ Players: [{ id: 501, f: "Alex", l: "Example" }, { id: 502, f: "Sam", l: "Sample", c: "Sammy" }, { id: "x" }], LegendsPlayers: [{ id: 9, f: "Old", l: "Hand" }] }))
      .toEqual({ 501: "Alex Example", 502: "Sammy", 9: "Old Hand" });
    expect(parseLocalisedNames({ "global.teamFull.2026.10": "Example FC", "global.leagueFull.2026.13": "Example League", "search.nationName.nation14": "Exampleland", "other.key": "x" }))
      .toEqual({ teams: { 10: "Example FC" }, leagues: { 13: "Example League" }, nations: { 14: "Exampleland" } });
    expect(parseLocalisedNames(["not", "an", "object"])).toEqual({ teams: {}, leagues: {}, nations: {} });
  });

  it("keeps the newest copy of each item and exports only the names it needs", () => {
    const a = summarizeClub({ itemData: [player(1, { rating: 80 })] }, "squad");
    const b = summarizeClub({ itemData: [player(1, { rating: 85 }), player(2)] }, "club");
    const merged = mergeClubItems(a, b);
    expect(merged.map((i) => [i.item_id, i.rating, i.seen_in])).toEqual([[1, 85, "club"], [2, 85, "club"]]);
    const out = buildClubExport(merged, { players: { 501: "Alex", 999: "Unused" }, teams: { 10: "Example FC" }, leagues: {}, nations: { 14: "Exampleland", 15: "Other" } }, "2026-11-02T00:00:00Z");
    expect(out).toMatchObject({ format: "xilab-club-capture", version: 1, verified: false, names: { players: { 501: "Alex" }, teams: { 10: "Example FC" }, leagues: {}, nations: { 14: "Exampleland" } } });
  });
});
