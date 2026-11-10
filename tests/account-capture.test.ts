import { describe, expect, it } from "vitest";
import {
  accountKind, accountStamp, buildAccountExport, mergeAccount, readAccountResponse, readBalance, readMassInfo, readObjectives, readSbcSets,
  readSeason, readTradeList, readUnassigned,
} from "../src/account/capture.js";
import { accountDue } from "../src/market/upload.js";

const HOST = "https://utas.mob.v1.prd.futc-ext.gcp.ea.com:443/ut/game/fc27";
const NOW = Date.UTC(2026, 10, 9, 20, 0);
const item = (id: number, resourceId: number, rating = 84, extra: Record<string, unknown> = {}) => ({ id, resourceId, assetId: resourceId, rating, itemType: "player", rareflag: 1, untradeable: false, ...extra });

describe("account capture", () => {
  it("knows which Web App answers are account data, GET only", () => {
    expect(accountKind(`${HOST}/usermassinfo`)).toBe("massinfo");
    expect(accountKind(`${HOST}/user/credits`)).toBe("credits");
    expect(accountKind(`${HOST}/tradepile`)).toBe("tradepile");
    expect(accountKind(`${HOST}/watchlist`)).toBe("watchlist");
    expect(accountKind(`${HOST}/purchased/items`)).toBe("unassigned");
    expect(accountKind(`${HOST}/sbs/sets`)).toBe("sbcs");
    expect(accountKind(`${HOST}/scmp/campaign?type=2`)).toBe("objectives");
    expect(accountKind(`${HOST}/scmp/data/lite`)).toBe("season");
    expect(accountKind("https://fcas.mob.v1.prd.futc-ext.gcp.ea.com:443/fc/user/season/lite")).toBe("season");
    expect(accountKind(`${HOST}/transfermarket?num=21`)).toBeNull();
    expect(accountKind(`${HOST}/purchased/items/123`)).toBeNull();
    expect(accountKind(`${HOST}/tradepile`, "DELETE")).toBeNull();
    expect(accountKind(`${HOST}/watchlist`, "PUT")).toBeNull();
  });

  it("reads coins, FC Points, draft tokens and any other currency", () => {
    const b = readBalance({ credits: 999, currencies: [{ name: "COINS", funds: 120_500, finalFunds: 120_000 }, { name: "POINTS", funds: 1050, finalFunds: 1050 }, { name: "DRAFT_TOKEN", funds: 2, finalFunds: 2 }, { name: "SEASON_POINTS", finalFunds: 40 }] })!;
    expect(b).toMatchObject({ coins: 120_000, points: 1050, draft_tokens: 2 });
    expect(b.currencies.map((c) => c.name)).toEqual(["COINS", "POINTS", "DRAFT_TOKEN", "SEASON_POINTS"]);
    expect(readBalance({ credits: 5000 })).toMatchObject({ coins: 5000, points: null, currencies: [] });
    expect(readBalance({ foo: 1 })).toBeNull();
  });

  it("reads the sign-in summary without personal ids", () => {
    const { profile, balance } = readMassInfo({
      userInfo: { personaId: 123456, personaName: "JeffFC", clubName: "Gaffer United", clubAbbr: "GAF", established: "2026-09-26", won: 50, loss: 20, draw: 5, trophies: 3,
        divisionOnline: 4, credits: 7000, currencies: [{ name: "COINS", finalFunds: 7000 }, { name: "POINTS", finalFunds: 300 }], unopenedPacks: { preOrderPacks: 1, recoveredPacks: 2 }, unassignedPileSize: 7 },
      pileSizeClientData: { entries: [{ key: 2, value: 100 }, { key: 4, value: 50 }] },
    });
    expect(profile).toMatchObject({ persona_name: "JeffFC", club_name: "Gaffer United", won: 50, lost: 20, draw: 5, division_online: 4, unopened_packs: 3, unassigned_count: 7, tradepile_max: 100, watchlist_max: 50 });
    expect(JSON.stringify(profile)).not.toContain("123456");
    expect(balance).toMatchObject({ coins: 7000, points: 300 });
    const patch = readAccountResponse("massinfo", { userInfo: { personaId: 1, clubName: "X" } }, NOW);
    expect(patch.shape!.massinfo_user).toEqual(["clubName"]);
  });

  it("reads the transfer list states and watchlist bids", () => {
    const pile = readTradeList({ credits: 8000, auctionInfo: [
      { tradeId: 11, tradeState: "active", buyNowPrice: 12_000, startingBid: 10_000, currentBid: 0, expires: 3600, itemData: item(1, 500, 85) },
      { tradeId: 12, tradeState: "closed", buyNowPrice: 9_000, currentBid: 9_000, expires: 0, itemData: item(2, 501) },
      { tradeId: 13, tradeState: "expired", buyNowPrice: 30_000, expires: -1, itemData: item(3, 502) },
      { tradeId: 0, tradeState: null, itemData: item(4, 503) },
      { tradeId: 14, tradeState: "active", itemData: { id: 5 } },
    ] }, false, NOW)!;
    expect(pile.map((t) => t.state)).toEqual(["listed", "sold", "expired", "unlisted"]);
    expect(pile[0]).toMatchObject({ trade_id: "11", ea_item_id: 500, rating: 85, buy_now: 12_000, starting_bid: 10_000, current_bid: null, expires_at: new Date(NOW + 3600_000).toISOString() });
    expect(pile[1]!.expires_at).toBeNull();
    const watch = readTradeList({ auctionInfo: [
      { tradeId: 21, tradeState: "active", bidState: "highest", currentBid: 4000, expires: 60, itemData: item(6, 600) },
      { tradeId: 22, tradeState: "active", bidState: "outbid", itemData: item(7, 601) },
      { tradeId: 23, tradeState: "closed", bidState: "highest", itemData: item(8, 602) },
      { tradeId: 24, tradeState: "closed", bidState: "outbid", itemData: item(9, 603) },
      { tradeId: 25, tradeState: "active", bidState: "none", sellerName: "someone", itemData: item(10, 604) },
    ] }, true, NOW)!;
    expect(watch.map((t) => t.state)).toEqual(["winning", "outbid", "won", "lost", "watching"]);
    expect(JSON.stringify(watch)).not.toContain("someone");
    expect(readTradeList({ nope: 1 }, false)).toBeNull();
    const patch = readAccountResponse("tradepile", { credits: 8000, auctionInfo: [] }, NOW);
    expect(patch.tradepile!.data).toEqual([]);
    expect(patch.balance!.data.coins).toBe(8000);
  });

  it("reads the unassigned pile with duplicates", () => {
    const u = readUnassigned({ itemData: [item(1, 500), item(2, 501, 70, { untradeable: true }), { id: 3 }], duplicateItemIdList: [{ itemId: 2, duplicateItemId: 99 }] })!;
    expect(u).toHaveLength(2);
    expect(u[1]).toMatchObject({ item_id: 2, untradeable: true, duplicate: true });
    expect(u[0]!.duplicate).toBe(false);
  });

  it("reads SBC sets with progress, end time and rewards", () => {
    const sets = readSbcSets({ categories: [
      { name: "Upgrades", sets: [
        { setId: 1, name: "84+ Upgrade", challengesCount: 1, challengesCompletedCount: 0, timesCompleted: 2, repeatabilityMode: "UNLIMITED", endTime: 86_400, awards: [{ type: "pack", value: 777, count: 1, untradeable: true }] },
        { setId: 2, name: "Hidden", hidden: true },
      ] },
      { name: "Players", sets: [{ setId: 3, name: "POTM", challengesCount: 3, challengesCompletedCount: 1, repeatabilityMode: "NON_REPEATABLE" }, { setId: 1, name: "dupe" }] },
    ] }, NOW)!;
    expect(sets.map((s) => s.set_id)).toEqual([1, 3]);
    expect(sets[0]).toMatchObject({ category: "Upgrades", repeatable: true, times_completed: 2, end_at: new Date(NOW + 86_400_000).toISOString(), awards: [{ type: "pack", value: 777, untradeable: true }] });
    expect(sets[1]).toMatchObject({ repeatable: false, challenges: 3, completed: 1 });
  });

  it("finds objectives by name and progress in an unknown layout", () => {
    const list = readObjectives({ groups: [{ name: "Daily", objectives: [
      { id: 1, description: "Win 2 games", progress: 1, target: 2, xp: 300, endTime: 3600 },
      { id: 2, description: "Score 5 goals", progressValue: 5, targetValue: 5 },
    ] }, { title: "Season XP", entries: [{ name: "Play 10 matches", currentValue: 10, targetValue: 10, state: "REDEEMED" }] }] }, NOW)!;
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: 1, name: "Win 2 games", group: "Daily", progress: 1, target: 2, done: false, xp: 300, end_at: new Date(NOW + 3600_000).toISOString() });
    expect(list[1]!.done).toBe(true);
    expect(list[2]).toMatchObject({ group: "Season XP", done: true });
    expect(readObjectives({ nothing: true })).toEqual([]);
  });

  it("reads season numbers and leaves ids out", () => {
    expect(readSeason({ seasonLevel: 12, seasonXp: 4500, personaId: 5, nested: { tierId: 3, xpToNextLevel: 500 }, name: "x" }))
      .toEqual({ seasonLevel: 12, seasonXp: 4500, "nested.xpToNextLevel": 500 });
    expect(readSeason({ a: 1 })).toBeNull();
  });

  it("merges newer sections, combines objective tabs and knows when to upload", () => {
    const t1 = NOW, t2 = NOW + 60_000;
    let s = mergeAccount(undefined, readAccountResponse("credits", { credits: 100 }, t1));
    s = mergeAccount(s, readAccountResponse("objectives", { list: [{ name: "A", progress: 0, target: 1 }] }, t1));
    s = mergeAccount(s, readAccountResponse("objectives", { list: [{ name: "B", progress: 1, target: 1 }] }, t2));
    s = mergeAccount(s, readAccountResponse("objectives", { list: [] }, t2));
    expect(s.objectives!.data.map((o) => o.name)).toEqual(["A", "B"]);
    s = mergeAccount(s, { balance: { seen_at: new Date(t1 - 1).toISOString(), data: { coins: 1, points: null, draft_tokens: null, currencies: [] } } });
    expect(s.balance!.data.coins).toBe(100);
    expect(accountStamp(s)).toBe(new Date(t2).toISOString());
    expect(s.shape).toHaveProperty("credits");
    expect(accountDue({ last_account: accountStamp(s)!, account_sent: "" })).toBe(true);
    expect(accountDue({ last_account: accountStamp(s)!, account_sent: accountStamp(s)! })).toBe(false);
    expect(buildAccountExport(s, "2026-11-09T20:00:00.000Z")).toMatchObject({ format: "xilab-account-capture", version: 1, verified: false });
  });
});

describe("SBC challenges (opened set)", () => {
  const URL_ = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc27/sbs/setId/4242/challenges";
  const answer = { challenges: [{
    challengeId: 9001, name: "Top Form", description: "Hand in a squad", formation: "f4231", status: "NOT_STARTED", elgOperation: "AND",
    elgReq: [
      { type: "TEAM_RATING", eligibilitySlot: -1, eligibilityValue: 84, count: -1, scope: "GREATER" },
      { type: "LEAGUE_ID", eligibilityValues: [13, "16"], count: 2, scope: 0 },
      { nothing: true },
    ],
    awards: [{ type: "pack", value: 555, count: 1, untradeable: true }],
  }, { name: "no id" }] };

  it("reads the set id from the address and each challenge's requirements", () => {
    expect(accountKind(URL_)).toBe("sbc_challenges");
    expect(accountKind(URL_, "PUT")).toBeNull();
    const patch = readAccountResponse("sbc_challenges", answer, Date.UTC(2026, 10, 10), URL_);
    const list = patch.sbc_challenges!.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ set_id: 4242, challenge_id: 9001, formation: "f4231", operation: "AND" });
    expect(list[0]!.requirements).toEqual([
      { type: "TEAM_RATING", scope: "GREATER", values: [84], count: -1, slot: -1 },
      { type: "LEAGUE_ID", scope: "GREATER", values: [13, 16], count: 2, slot: null },
    ]);
    expect(patch.shape!.sbc_requirement).toContain("eligibilityValue");
  });

  it("keeps challenges from several opened sets, a reopened set replacing its own", () => {
    const at = (t: number, set: number, id: number) => ({ sbc_challenges: { seen_at: new Date(t).toISOString(), data: [{ set_id: set, challenge_id: id, name: `c${id}`, description: null, formation: null, status: null, operation: null, requirements: [], awards: [], end_at: null }] } });
    let s = mergeAccount(undefined, at(1000, 1, 10));
    s = mergeAccount(s, at(2000, 2, 20));
    s = mergeAccount(s, at(3000, 1, 11));
    expect(s.sbc_challenges!.data.map((c) => c.challenge_id)).toEqual([11, 20]);
    expect(accountStamp(s)).toBe(new Date(3000).toISOString());
  });
});

describe("Evolutions (academy answers)", () => {
  const HUB = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc27/academy/hub";
  const answer = { slots: [{
    academyId: 31, name: "Midfield Maestro", description: "Turn a CM into a playmaker", endTime: 86_400, price: { coins: 15000, points: 0 },
    eligibilityRequirements: [{ type: "OVR", value: 82, scope: "LOWER" }, { attribute: "POSITION", values: ["CM", "CDM"] }],
    levels: [{ upgrades: [{ attribute: "OVR", value: 2 }, { attribute: "PASSING", value: 3 }] }, { upgrades: [{ type: "PLAYSTYLE", value: "Incisive Pass" }] }],
  }, { academyId: 32, name: "No rules or levels" }] };

  it("reads evolutions with requirements and level upgrades from any academy answer", () => {
    expect(accountKind(HUB)).toBe("evolutions");
    expect(accountKind(HUB.replace("hub", "slot/31"))).toBe("evolutions");
    const patch = readAccountResponse("evolutions", answer, Date.UTC(2026, 10, 10), HUB);
    const list = patch.evolutions!.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ evo_id: 31, name: "Midfield Maestro", coins: 15000 });
    expect(list[0]!.requirements).toEqual([{ type: "OVR", values: [82], scope: "LOWER" }, { type: "POSITION", values: ["CM", "CDM"], scope: null }]);
    expect(list[0]!.levels).toEqual([
      { upgrades: [{ type: "OVR", values: [2], scope: null }, { type: "PASSING", values: [3], scope: null }] },
      { upgrades: [{ type: "PLAYSTYLE", values: ["Incisive Pass"], scope: null }] },
    ]);
    expect(patch.shape!.evolution).toContain("eligibilityRequirements");
    expect(patch.shape!.evolution_upgrade).toContain("attribute");
  });

  it("adds evolutions from several answers and drops ended ones", () => {
    const evo = (id: number, end: string | null) => ({ evo_id: id, name: `e${id}`, description: null, end_at: end, coins: null, points: null, status: null, requirements: [], levels: [] });
    let s = mergeAccount(undefined, { evolutions: { seen_at: "2026-11-10T00:00:00.000Z", data: [evo(1, "2026-11-10T01:00:00.000Z"), evo(2, null)] } });
    s = mergeAccount(s, { evolutions: { seen_at: "2026-11-10T02:00:00.000Z", data: [evo(3, null)] } });
    expect(s.evolutions!.data.map((e) => e.evo_id)).toEqual([2, 3]);
  });
});
