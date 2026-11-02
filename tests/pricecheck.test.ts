import { describe, expect, it } from "vitest";
import { buildQueue, cooldownUntil, DAILY_CAP, dailyCapFor, delayBefore, FIRST_DAY_CAP, HOURLY_CAP, inCooldown, isSafeSearch, isThrottle, learnTemplate, pruneLog, remainingToday, runLimit, searchBudget, searchUrlFor, SESSION_LENGTH, stopReason } from "../src/market/pricecheck.js";
import type { ClubItem } from "../src/club/capture.js";
import type { CaptureRow } from "../src/market/capture.js";

const BASE = "https://utas.mob.v4.prd.futc-ext.gcp.ea.com/ut/game/fc27/transfermarket";
const item = (ea: number, extra: Partial<ClubItem> = {}): ClubItem => ({
  item_id: ea * 10, ea_item_id: ea, asset_id: ea + 1, kind: "player", rating: 80, position: "ST", positions: ["ST"],
  team_id: 1, league_id: 2, nation_id: 3, rare_flag: 1, untradeable: false, loan: false, stats: null, skill_moves: null,
  weak_foot: null, seen_in: "club", ...extra,
});

describe("price check", () => {
  it("learns a template only from a GET search for one player, and drops price filters", () => {
    expect(learnTemplate(`${BASE}?num=21&start=40&type=player&maskedDefId=9&minb=200&macr=5000`)).toBe(`${BASE}?num=21&start=0&type=player&maskedDefId=9`);
    expect(learnTemplate(`${BASE}?num=21&type=player&lev=gold`)).toBeNull();
    expect(learnTemplate(`${BASE}?definitionId=5`, "PUT")).toBeNull();
    expect(learnTemplate(`${BASE.replace("transfermarket", "trade/1/bid")}?definitionId=5`)).toBeNull();
  });

  it("puts the card in the template by the id it uses", () => {
    expect(searchUrlFor(`${BASE}?definitionId=1&num=21`, item(500))).toBe(`${BASE}?definitionId=500&num=21`);
    expect(searchUrlFor(`${BASE}?maskedDefId=1`, item(500))).toBe(`${BASE}?maskedDefId=501`);
    expect(searchUrlFor(`${BASE}?maskedDefId=1`, item(500, { asset_id: null }))).toBeNull();
  });

  it("only ever allows GET searches", () => {
    expect(isSafeSearch(`${BASE}?definitionId=1`, "GET")).toBe(true);
    expect(isSafeSearch(`${BASE}?definitionId=1`, "POST")).toBe(false);
    expect(isSafeSearch(`${BASE.replace("transfermarket", "trade/123/bid")}`, "PUT")).toBe(false);
    expect(isSafeSearch(`${BASE.replace("transfermarket", "watchlist")}`, "GET")).toBe(false);
  });

  it("queues unpriced club players, tradeable first, no loans or managers", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    const rows: CaptureRow[] = [{ ea_item_id: 2, asset_id: null, rating: 80, platform: "console", price: 900, listings: 1, observed_at: "2026-11-03T10:00:00Z" }];
    const q = buildQueue([
      item(1, { untradeable: true, rating: 90 }), item(2), item(3, { rating: 85 }), item(4, { loan: true }), item(5, { kind: "manager" }), item(3),
    ], rows, now, 10);
    expect(q.map((i: ClubItem) => i.ea_item_id)).toEqual([3, 1]);
    expect(buildQueue([item(1), item(3)], [], now, 1)).toHaveLength(1);
  });

  it("caps searches per UTC day", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(remainingToday("2026-11-03", 30, now)).toBe(DAILY_CAP - 30);
    expect(remainingToday("2026-11-02", 100, now)).toBe(DAILY_CAP);
    expect(remainingToday("2026-11-03", 500, now)).toBe(0);
  });

  it("paces 10-20 s, with a 4-8 minute break each sitting", () => {
    expect(delayBefore(0)).toBe(0);
    expect(delayBefore(1, () => 0)).toBe(10_000);
    expect(delayBefore(1, () => 1)).toBe(20_000);
    expect(delayBefore(SESSION_LENGTH, () => 0)).toBe(240_000);
  });

  it("stops on anything but a normal results page", () => {
    expect(stopReason(200, { auctionInfo: [] })).toBeNull();
    expect(stopReason(458, null)).toMatch(/captcha/);
    expect(stopReason(429, null)).toMatch(/too many/);
    expect(stopReason(200, { code: 1 })).toMatch(/Unexpected/);
    expect(stopReason(500, null)).toMatch(/500/);
  });
});

describe("price check safety caps", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("ramps the daily cap from 30 by 10 a day to 100", () => {
    expect(dailyCapFor(undefined, now)).toBe(FIRST_DAY_CAP);
    expect(dailyCapFor("2026-11-05", now)).toBe(30);
    expect(dailyCapFor("2026-11-03", now)).toBe(50);
    expect(dailyCapFor("2026-10-01", now)).toBe(DAILY_CAP);
  });

  it("limits a run by the rolling hour as well as the day", () => {
    const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
    const log = [...Array.from({ length: 15 }, (_, i) => ago(10 + i)), ago(200), ago(2000)];
    expect(searchBudget(log, now)).toEqual({ h1: 15, h3: 15, h24: 16 });
    expect(pruneLog(log, now)).toHaveLength(16);
    expect(runLimit({ day: "2026-11-05", count: 15, firstDay: "2026-10-01", log }, now)).toBe(HOURLY_CAP - 15);
    expect(runLimit({ day: "2026-11-05", count: 28, firstDay: "2026-11-05", log: [] }, now)).toBe(2);
  });

  it("cools down for a day after EA throttles or checks the account", () => {
    expect(isThrottle(429) && isThrottle(458) && isThrottle(512) && isThrottle(494)).toBe(true);
    expect(isThrottle(200) || isThrottle(401) || isThrottle(500)).toBe(false);
    const until = cooldownUntil(now);
    expect(inCooldown(until, new Date(now.getTime() + 23 * 3600_000))).toBe(true);
    expect(inCooldown(until, new Date(now.getTime() + 25 * 3600_000))).toBe(false);
    expect(inCooldown(null, now)).toBe(false);
  });
});
