import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASKETS,
  DEFAULT_MARKET_RULES as MR,
  DEFAULT_PRICE_SOURCES,
  MemoryMarketCardSource,
  MemoryMembershipStore,
  MemoryPriceStore,
  MemoryWatchlistStore,
  SourceNotAllowedError,
  analyzeTrade,
  assessSignals,
  breakEvenPrice,
  cardUtility,
  change,
  classifyRegime,
  compareInSquad,
  computeIndex,
  createMarketService,
  freshness,
  isValidPrice,
  knownAt,
  meanReversion,
  momentum,
  parsePriceImport,
  rebalance,
  relativeStrength,
  roundToStep,
  rsVerdict,
  toSeries,
  transferTax,
  type MarketCard,
  type PriceObservation,
} from "../src/market/index.js";
import { demoMarketCards, demoMemberships, demoPriceHistory } from "../src/market/demo.js";
import { DEFAULT_RULES, demoSquadFor } from "./market-fixtures.js";

const A = "2026-11-02T12:00:00.000Z";
const H = 3_600_000;
const at = (hoursAgo: number, from = A) => new Date(Date.parse(from) - hoursAgo * H).toISOString();

const card = (id: string, extra: Partial<MarketCard> = {}): MarketCard => ({
  id,
  name: id,
  club: "C",
  league: "L",
  nation: "N",
  positions: ["CM"],
  rating: 86,
  category: "base",
  tradeable: true,
  source: "fixture",
  stats: { pac: 80, sho: 75, pas: 85, dri: 84, def: 70, phy: 75 },
  ...extra,
});

/** Hourly observations for `hours` ending at A, price = f(hoursAgo). */
function hourly(card_id: string, hours: number, f: (h: number) => number, opts: { platform?: "console" | "pc"; delayMin?: number; until?: number } = {}): PriceObservation[] {
  const out: PriceObservation[] = [];
  for (let h = hours; h >= (opts.until ?? 0); h--)
    out.push({
      card_id,
      platform: opts.platform ?? "console",
      price: Math.round(f(h)),
      observed_at: at(h),
      received_at: new Date(Date.parse(at(h)) + (opts.delayMin ?? 5) * 60_000).toISOString(),
      season: "FC27",
      source_id: "user_import",
      evidence: "estimate",
    });
  return out;
}

function service(cards: MarketCard[], rows: PriceObservation[], owner = "u1", membersAt = at(200)) {
  const members = DEFAULT_BASKETS.flatMap((b) => rebalance(b, cards, [], membersAt));
  return createMarketService({
    prices: new MemoryPriceStore([{ owner_id: owner, rows }]),
    memberships: new MemoryMembershipStore(members),
    watchlists: new MemoryWatchlistStore(),
    cards: new MemoryMarketCardSource(cards),
    now: () => A,
  });
}

describe("market rules", () => {
  it("Scenario 6: buy 5,000, sell 6,200 -> 890 profit after the 5% tax", () => {
    expect(transferTax(6200)).toBe(310);
    const r = analyzeTrade({ card_id: "x", platform: "console", quantity: 1, buy_price: 5000, target_price: 6200, downside_price: 4500 });
    expect(r.profit_at_target).toBe(890);
    expect(r.tax_at_target).toBe(310);
  });

  it("tax is configurable as a rules value", () => {
    const r = analyzeTrade({ card_id: "x", platform: "console", quantity: 1, buy_price: 5000, target_price: 6200, downside_price: 4500 }, undefined, { ...MR, id: "t", transfer_tax_rate: 0.1 });
    expect(r.profit_at_target).toBe(6200 - 620 - 5000);
  });

  it("price steps and break-even", () => {
    expect(roundToStep(1234)).toBe(1200);
    expect(roundToStep(9_980, "up")).toBe(10_000);
    expect(roundToStep(10_100, "up")).toBe(10_250);
    expect(isValidPrice(10_250)).toBe(true);
    expect(isValidPrice(10_100)).toBe(false);
    // Lowest valid price that returns >= 5,000 after tax: 5,300 * 0.95 = 5,035; 5,200 -> 4,940.
    expect(breakEvenPrice(5000)).toBe(5300);
    for (const buy of [700, 5000, 12_250, 99_500, 250_000]) {
      const be = breakEvenPrice(buy);
      expect(be - transferTax(be)).toBeGreaterThanOrEqual(buy);
      const lower = roundToStep(be - 1, "down");
      expect(lower - transferTax(lower)).toBeLessThan(buy);
    }
  });
});

describe("trade thesis", () => {
  it("risk/reward, break-even win rate, exposure, no double counting of holdings", () => {
    const r = analyzeTrade({ card_id: "x", platform: "console", quantity: 2, buy_price: 10_000, target_price: 12_000, downside_price: 9_000, coin_balance: 50_000, existing: { quantity: 1, cost_basis: 9_500 } });
    expect(r.investment).toBe(20_000);
    expect(r.profit_at_target).toBe(2 * (11_400 - 10_000));
    expect(r.loss_at_downside).toBe(2 * (8_550 - 10_000));
    expect(r.risk_reward).toBeCloseTo(2800 / 2900, 2);
    expect(r.break_even_win_rate).toBeCloseTo(2900 / 5700, 3);
    expect(r.exposure.of_coins_pct).toBe(40);
    expect(r.exposure.affordable).toBe(true);
    expect(r.exposure.position_after).toEqual({ quantity: 3, cost_basis: 29_500 });
    expect(r.user_scenario_ev).toBeNull();
    expect(r.limitations.join(" ")).toMatch(/Liquidity and execution data are unavailable/);
  });

  it("flags invalid prices, unaffordable trades and a user probability as an assumption", () => {
    const r = analyzeTrade({ card_id: "x", platform: "pc", quantity: 1, buy_price: 10_100, target_price: 12_000, downside_price: 9_000, coin_balance: 5_000, assumed_target_probability: 0.5 });
    expect(r.price_checks.find((c) => c.field === "buy_price")!.valid).toBe(false);
    expect(r.exposure.affordable).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/not coins until sold/);
    expect(r.user_scenario_ev!.label).toMatch(/assumption/);
  });
});

describe("point-in-time series", () => {
  it("Scenario 8: rows received after the as-of time are invisible", () => {
    const rows = [
      ...hourly("a", 10, () => 1000),
      // observed 2h ago but only received now: not known 1h ago
      { ...hourly("a", 2, () => 5000)[0]!, received_at: A },
    ];
    const s1h = toSeries(rows, "a", "console", at(1));
    expect(s1h.every((p) => p.price === 1000)).toBe(true);
    expect(knownAt(rows, at(1)).some((r) => r.price === 5000)).toBe(false);
    const sNow = toSeries(rows, "a", "console", A);
    expect(sNow.some((p) => p.price === 5000)).toBe(true);
  });

  it("change() needs real history, never extrapolates", () => {
    const s = toSeries(hourly("a", 10, (h) => 1000 + (10 - h) * 10, { delayMin: 0 }), "a", "console", A);
    expect(change(s, "6h")).toBeCloseTo(((1100 - 1040) / 1040) * 100, 5);
    expect(change(s, "7d")).toBeNull();
  });

  it("Scenario 7: stale or missing prices are flagged", () => {
    expect(freshness([], A).status).toBe("missing");
    const s = toSeries(hourly("a", 30, () => 1000, { until: 10 }), "a", "console", A);
    const f = freshness(s, A);
    expect(f.status).toBe("stale");
    expect(f.message).toMatch(/No current value/);
  });
});

describe("baskets and indexes", () => {
  it("membership is point-in-time: a card added later doesn't rewrite earlier index values", () => {
    const cards = [card("a"), card("b"), card("c")];
    const rows = [...hourly("a", 48, () => 1000), ...hourly("b", 48, () => 1000), ...hourly("c", 48, (h) => (h > 24 ? 1000 : 3000))];
    const series = new Map(["a", "b", "c"].map((id) => [id, toSeries(rows, id, "console", A)]));
    const def = DEFAULT_BASKETS.find((b) => b.id === "market")!;
    // a and b from the start; c only joins at t-12h (after its spike)
    let m = rebalance(def, cards.slice(0, 2), [], at(48));
    m = rebalance(def, cards, m, at(12));
    const ix = computeIndex("market", "console", m, series, at(48), A);
    // c's spike happened at t-24h, before it joined: the index stays flat.
    expect(ix.points.every((p) => Math.abs(p.value - 100) < 1e-9)).toBe(true);
    expect(ix.points.at(-1)!.constituents).toBe(3);
  });

  it("rebalance closes members that stop matching and keeps their history", () => {
    const def = DEFAULT_BASKETS.find((b) => b.id === "fodder-86")!;
    const m1 = rebalance(def, [card("a"), card("b")], [], at(48));
    const m2 = rebalance(def, [card("a"), card("b", { rating: 87 })], m1, at(10));
    expect(m2.find((m) => m.card_id === "b")!.effective_to).toBe(at(10));
    expect(m2.find((m) => m.card_id === "a")!.effective_to).toBeNull();
  });

  it("regime comes from rules over measured index moves", () => {
    const base = { label: "", description: "", platform: "console" as const, value: 100, volatility_24h: 0.5, constituents_now: 10, distribution: null };
    const ch = (c24: number, c7: number | null) => ({ "1h": 0, "6h": 0, "24h": c24, "72h": 0, "7d": c7 });
    const r = classifyRegime([
      { ...base, basket_id: "market", changes: ch(3, 6), trend: "rising" },
      { ...base, basket_id: "meta", changes: ch(0.5, 1), trend: "sideways" },
      { ...base, basket_id: "fodder-86", label: "86-rated fodder", changes: ch(8, 9), trend: "rising" },
    ]);
    expect(r.primary).toBe("broadly_rising");
    expect(r.flags.map((f) => f.regime)).toContain("sbc_driven_demand");
    expect(r.not_evaluable.map((x) => x.regime)).toContain("high_supply");
    expect(classifyRegime([]).primary).toBe("insufficient_data");
  });
});

describe("signals", () => {
  it("Scenario 1: card +5% while its benchmark +12% is underperforming", () => {
    expect(rsVerdict(5, 12)).toBe("underperforming");
    const s = toSeries(hourly("a", 30, (h) => (h >= 24 ? 10_000 : 10_500)), "a", "console", A);
    const rows = relativeStrength(s, [{ benchmark: "market", peers: 10, changes: { "1h": 0, "6h": 0, "24h": 12, "72h": null, "7d": null } }]);
    const cell = rows[0]!.cells.find((c) => c.window === "24h")!;
    expect(cell.card).toBe(5);
    expect(cell.diff_pp).toBe(-7);
    expect(cell.verdict).toBe("underperforming");
  });

  it("a card holding value while its peers fall shows as outperforming", () => {
    expect(rsVerdict(0, -10)).toBe("outperforming");
  });

  it("Scenario 5: a big rise before the signal is flagged as elevated entry risk, not a buy", () => {
    const s = toSeries(hourly("a", 100, (h) => (h > 72 ? 10_000 : 10_000 * (1 + 0.4 * ((72 - h) / 72)))), "a", "console", A);
    const mom = momentum(s);
    const a = assessSignals({ fresh: freshness(s, A), points: s.length, rs: [], mom, mr: meanReversion(s, []), regime_primary: "sideways" });
    expect(a.entry_risk.elevated).toBe(true);
    expect(a.status).toBe("overheated");
    expect(a.status).not.toBe("favorable_setup");
  });

  it("Scenario 7: stale prices never give a favourable setup", () => {
    const s = toSeries(hourly("a", 100, (h) => 10_000 + (100 - h) * 50, { until: 12 }), "a", "console", A);
    const a = assessSignals({ fresh: freshness(s, A), points: s.length, rs: [], mom: momentum(s), mr: meanReversion(s, []), regime_primary: "broadly_rising" });
    expect(a.status).toBe("insufficient_evidence");
    expect(a.could_be_wrong.length).toBeGreaterThan(0);
  });

  it("a falling card is not automatically a bargain: persistent decline is elevated risk", () => {
    const s = toSeries(hourly("a", 168, (h) => 20_000 * (1 - 0.3 * ((168 - h) / 168))), "a", "console", A);
    const mr = meanReversion(s, []);
    expect(mr.unusually_low).toBe(true);
    expect(mr.pattern).toBe("persistent_decline");
    const a = assessSignals({ fresh: freshness(s, A), points: s.length, rs: [], mom: momentum(s), mr, regime_primary: "sideways" });
    expect(a.status).toBe("elevated_risk");
  });

  it("a sharp dip after a stable week reads as a possible temporary discount", () => {
    const s = toSeries(hourly("a", 168, (h) => (h > 20 ? 20_000 + (h % 2) * 100 : 17_000)), "a", "console", A);
    const mr = meanReversion(s, []);
    expect(mr.pattern).toBe("recent_dislocation");
  });
});

describe("price import", () => {
  const src = DEFAULT_PRICE_SOURCES.find((s) => s.id === "user_import")!;
  it("validates rows and rejects with reasons", () => {
    const csv = [
      "card_id,platform,price,observed_at,kind",
      `a,console,12000,${at(3)},`,
      `a,PS,12250,${at(2)},lowest_bin`,
      `zzz,console,1000,${at(2)},`,
      `a,switch,1000,${at(2)},`,
      `a,console,abc,${at(2)},`,
      `a,console,1000,${at(-5)},`,
      `a,console,12000,${at(3)},`,
      `a,pc,9000,${at(1)},sale`,
    ].join("\n");
    const r = parsePriceImport(csv, { source: src, received_at: A, knownCardIds: new Set(["a"]) });
    expect(r.rows).toHaveLength(3);
    expect(r.duplicates).toBe(1);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/Unknown card_id/),
      expect.stringMatching(/platform/),
      expect.stringMatching(/whole number/),
      expect.stringMatching(/future/),
    ]);
    expect(r.rows[1]!.platform).toBe("console");
    expect(r.rows[2]!.quality?.[0]).toMatch(/can't verify/);
    expect(r.rows.every((x) => x.received_at === A && x.evidence === "estimate")).toBe(true);
  });

  it("refuses sources that aren't authorised", () => {
    const futbin = DEFAULT_PRICE_SOURCES.find((s) => s.id === "futbin")!;
    expect(futbin.status).toBe("not_authorized");
    expect(() => parsePriceImport("card_id,platform,price,observed_at", { source: futbin, knownCardIds: new Set() })).toThrow(SourceNotAllowedError);
  });

  it("imported rows are private to their owner", async () => {
    const cards = [card("a")];
    const svc = createMarketService({ prices: new MemoryPriceStore(), memberships: new MemoryMembershipStore(), watchlists: new MemoryWatchlistStore(), cards: new MemoryMarketCardSource(cards), now: () => A });
    const csv = ["card_id,platform,price,observed_at", ...Array.from({ length: 10 }, (_, i) => `a,console,${10_000 + i * 100},${at(10 - i)}`)].join("\n");
    const res = await svc.importPriceHistory("alice", csv);
    expect(res.accepted).toBe(10);
    expect((await svc.getCardMarketIntelligence("alice", "a")).price.latest).toBe(10_900);
    expect((await svc.getCardMarketIntelligence("bob", "a")).price.latest).toBeNull();
  });
});

describe("market service", () => {
  const cards = [
    card("riser", { positions: ["RM"], rating: 85 }),
    ...Array.from({ length: 5 }, (_, i) => card(`peer${i}`, { positions: ["RM"], rating: 85 })),
    card("stale", { positions: ["RM"], rating: 85 }),
    card("none", { positions: ["RM"], rating: 85 }),
  ];
  const rows = [
    ...hourly("riser", 168, (h) => 10_000 * (1 + 0.3 * ((168 - h) / 168))),
    ...cards.slice(1, 6).flatMap((c, i) => hourly(c.id, 168, (h) => 10_000 + ((h + i) % 3) * 50)),
    ...hourly("stale", 168, () => 9_000, { until: 12 }),
  ];
  const svc = service(cards, rows);

  it("overview: indexes, regime, coverage, no invented events", async () => {
    const o = await svc.getMarketOverview("u1");
    expect(o.indexes.find((i) => i.basket_id === "market")!.value).not.toBeNull();
    expect(o.coverage).toEqual({ cards: 8, fresh: 6, stale: 1, missing: 1 });
    expect(o.upcoming_events.items).toEqual([]);
    expect(o.provenance.demo).toBe(false);
    expect(o.indexes.find((i) => i.basket_id === "evolution")!.trend).toBe("insufficient_data");
  });

  it("Scenario 7: Card Intelligence for stale and missing cards claims no current price", async () => {
    for (const id of ["stale", "none"]) {
      const ci = await svc.getCardMarketIntelligence("u1", id);
      expect(ci.price.latest).toBeNull();
      expect(ci.assessment.status).toBe("insufficient_evidence");
    }
    const t = await svc.analyzeTradeThesis("u1", { card_id: "stale", platform: "console", quantity: 1, buy_price: 9_000, target_price: 10_000, downside_price: 8_500 });
    expect(t.market.latest_price).toBeNull();
    expect(t.warnings.join(" ")).toMatch(/No current price/);
  });

  it("Card Intelligence uses the shared card utility and lists comparables", async () => {
    const ci = await svc.getCardMarketIntelligence("u1", "riser");
    expect(ci.utility).toEqual(cardUtility(cards[0]!));
    expect(ci.comparables.map((c) => c.card_id)).toContain("peer0");
    expect(ci.relative_strength.find((r) => r.benchmark === "position")!.cells.find((c) => c.window === "24h")!.verdict).toBe("outperforming");
    expect(ci.community.note).toMatch(/Stage C/);
  });

  it("Scenario 8: a backtest at an earlier time doesn't see later prices", async () => {
    const early = await svc.getCardMarketIntelligence("u1", "riser", { as_of: at(48) });
    const now = await svc.getCardMarketIntelligence("u1", "riser");
    expect(early.price.history.every((p) => Date.parse(p.t) <= Date.parse(at(48)))).toBe(true);
    expect(early.price.latest!).toBeLessThan(now.price.latest!);
  });

  it("watchlist records the price when added and shows change since", async () => {
    await svc.addToWatchlist("u1", { card_id: "riser", platform: "console", target_sell: 10_500 }, { as_of: at(48) });
    const w = await svc.getWatchlist("u1");
    expect(w.items[0]!.price_at_add).toBeGreaterThan(0);
    expect(w.items[0]!.since_added_pct!).toBeGreaterThan(0);
    expect(w.items[0]!.at_target_sell).toBe(true);
    expect((await svc.getWatchlist("someone-else")).items).toEqual([]);
    await svc.removeFromWatchlist("u1", "riser", "console");
    expect((await svc.getWatchlist("u1")).items).toEqual([]);
  });

  it("scanner returns a status and reasons for every priced card", async () => {
    const r = await svc.findMarketOpportunities("u1");
    expect(r.items.length).toBe(7);
    for (const i of r.items) {
      expect(i.reasons.length).toBeGreaterThan(0);
      expect(i.could_be_wrong.length).toBeGreaterThan(0);
    }
    expect(r.items.find((i) => i.card_id === "stale")!.status).toBe("insufficient_evidence");
  });
});

describe("Scenario 9: Compare in My Squad", () => {
  it("respects locks, ownership and the chemistry engine", () => {
    const { squad, rm, lockedSt } = demoSquadFor();
    const res = compareInSquad(squad, rm, DEFAULT_RULES, { latest_price: 12_000, assessment: null });
    expect(res.options.every((o) => !squad.slots.find((s) => s.slot === o.slot)!.locked)).toBe(true);
    expect(res.options.map((o) => o.slot)).toContain("RM");
    expect(res.cost).toBe(12_000);
    // The engine, not this module, computes chemistry: totals match a fresh evaluation.
    expect(res.options[0]!.chemistry_after).toBeGreaterThanOrEqual(0);
    const st = compareInSquad(squad, lockedSt, DEFAULT_RULES, { latest_price: 50_000, assessment: null });
    expect(st.options).toEqual([]);
    expect(st.skipped_locked.length).toBe(2);
    expect(st.summary).toMatch(/locked/);
    const owned = compareInSquad(squad, { ...rm, owned: true }, DEFAULT_RULES, { latest_price: 12_000, assessment: null });
    expect(owned.cost).toBe(0);
    expect(owned.summary).toMatch(/already own/);
  });

  it("an upgrade after a price spike says waiting or an alternative may be better", () => {
    const { squad, rm } = demoSquadFor();
    const res = compareInSquad(squad, { ...rm, stats: { pac: 97, sho: 90, pas: 92, dri: 95, def: 80, phy: 85 } }, DEFAULT_RULES, {
      latest_price: 60_000,
      assessment: { status: "overheated", categories: [], reasons: [], could_be_wrong: [], entry_risk: { elevated: true, change_72h: 40, note: "" }, evidence: "estimate" },
    });
    expect(res.summary).toMatch(/meaningful upgrade, but its recent price rise/);
  });
});

describe("demo dataset", () => {
  it("is deterministic, labelled demo, and drives every Stage A view", async () => {
    const a = demoPriceHistory(A);
    expect(demoPriceHistory(A)).toEqual(a);
    expect(a.every((r) => r.source_id === "xilab_demo" && r.evidence === "hypothesis")).toBe(true);
    const svc = createMarketService({
      prices: new MemoryPriceStore([{ owner_id: null, rows: a }]),
      memberships: new MemoryMembershipStore(demoMemberships(A)),
      watchlists: new MemoryWatchlistStore(),
      cards: new MemoryMarketCardSource(demoMarketCards()),
      now: () => A,
    });
    const o = await svc.getMarketOverview("u");
    expect(o.provenance.demo).toBe(true);
    expect(o.provenance.evidence).toBe("hypothesis");
    const scan = await svc.findMarketOpportunities("u", { limit: 200 });
    const st = (id: string) => scan.items.find((i) => i.card_id === id)?.status;
    expect(st("demo-m8")).toBe("overheated");
    expect(st("demo-m5")).toBe("elevated_risk");
    expect(st("demo-m6")).toBe("insufficient_evidence");
    expect(st("demo-m3")).toBeUndefined();
    expect(scan.items.find((i) => i.card_id === "demo-m1")!.categories).toContain("confirmed_momentum");
    expect(o.regime.flags.map((f) => f.regime)).toContain("sbc_driven_demand");
  });
});
