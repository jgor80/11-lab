// Relative strength, momentum and mean reversion. Deterministic, explainable, and always supporting evidence:
// nothing here is a forecast. Each function returns the numbers it used so the UI can show its working.
import { bestFit } from "./baskets.js";
import { DEFAULT_MARKET_RULES, type MarketRules } from "./rules.js";
import { change, freshness, maxDrawdown, mean, median, ms, pct, round, sma, stdev, volatility, window, type Point } from "./series.js";
import { WINDOWS, type FreshnessCheck, type MarketCard, type Window } from "./types.js";

// ---------------------------------------------------------------- relative strength

export type Benchmark = "category" | "rating" | "position" | "utility" | "market";
export const BENCHMARKS: readonly Benchmark[] = ["category", "rating", "position", "utility", "market"];

export const BENCHMARK_LABEL: Record<Benchmark, string> = {
  category: "Same card category",
  rating: "Similar overall (±1)",
  position: "Same primary position",
  utility: "Similar tactical fit (±3, same position line)",
  market: "Whole-market index",
};

const LINE: Record<string, string> = { GK: "GK", CB: "DEF", LB: "DEF", RB: "DEF", CDM: "MID", CM: "MID", CAM: "MID", LM: "MID", RM: "MID", LW: "ATT", RW: "ATT", ST: "ATT" };

/** Peer rule for each benchmark, applied to cards other than the subject. Shown to the user. */
export function isPeer(b: Exclude<Benchmark, "market">, card: MarketCard, other: MarketCard): boolean {
  if (other.id === card.id) return false;
  switch (b) {
    case "category":
      return other.category === card.category;
    case "rating":
      return Math.abs(other.rating - card.rating) <= 1;
    case "position":
      return other.positions[0] === card.positions[0];
    case "utility": {
      const a = bestFit(card);
      const o = bestFit(other);
      return a !== null && o !== null && Math.abs(a - o) <= 3 && LINE[other.positions[0] ?? ""] === LINE[card.positions[0] ?? ""];
    }
  }
}

/**
 * The value isPeer compares for a benchmark, so cards can be grouped once instead of compared pair by pair.
 * category and position: peers have the same key. rating: the rating (peers are within 1). utility:
 * "line|best fit" (peers share the line and are within 3 fit points). null = the card has no peers for it.
 */
export function peerGroupKey(b: Exclude<Benchmark, "market">, card: MarketCard): string | null {
  switch (b) {
    case "category":
      return String(card.category);
    case "rating":
      return String(card.rating);
    case "position":
      return String(card.positions[0]);
    case "utility": {
      const fit = bestFit(card);
      return fit === null ? null : `${LINE[card.positions[0] ?? ""]}|${fit}`;
    }
  }
}

export type RsVerdict = "outperforming" | "underperforming" | "in_line" | "insufficient_data";

export interface RsCell {
  window: Window;
  card: number | null;
  benchmark: number | null;
  /** Card minus benchmark, percentage points. */
  diff_pp: number | null;
  verdict: RsVerdict;
}

export interface RsRow {
  benchmark: Benchmark;
  label: string;
  /** Peers with a usable change in the 24h window (market: index constituents). */
  peers: number;
  cells: RsCell[];
}

export function rsVerdict(card: number | null, bench: number | null, rules: MarketRules = DEFAULT_MARKET_RULES): RsCell["verdict"] {
  if (card === null || bench === null) return "insufficient_data";
  const d = card - bench;
  return d >= rules.thresholds.relative_strength_pp ? "outperforming" : d <= -rules.thresholds.relative_strength_pp ? "underperforming" : "in_line";
}

/** Median peer change per window: robust to one peer spiking. Needs at least 3 peers. */
export function peerChanges(peerSeries: Point[][]): Record<Window, { value: number | null; n: number }> {
  const out = {} as Record<Window, { value: number | null; n: number }>;
  for (const w of WINDOWS) {
    const xs = peerSeries.map((s) => change(s, w)).filter((x): x is number => x !== null);
    out[w] = { value: xs.length >= 3 ? median(xs) : null, n: xs.length };
  }
  return out;
}

export function relativeStrength(
  cardSeries: Point[],
  benchmarks: { benchmark: Benchmark; changes: Record<Window, number | null>; peers: number }[],
  rules: MarketRules = DEFAULT_MARKET_RULES,
): RsRow[] {
  return benchmarks.map((b) => ({
    benchmark: b.benchmark,
    label: BENCHMARK_LABEL[b.benchmark],
    peers: b.peers,
    cells: WINDOWS.map((w) => {
      const c = change(cardSeries, w);
      const bv = b.changes[w];
      return { window: w, card: r(c), benchmark: r(bv), diff_pp: c === null || bv === null ? null : round(c - bv), verdict: rsVerdict(c, bv, rules) };
    }),
  }));
}

// ---------------------------------------------------------------- momentum

export interface Momentum {
  changes: Record<Window, number | null>;
  sma_6h: number | null;
  sma_24h: number | null;
  /** Short average above long average. */
  short_above_long: boolean | null;
  /** The last 3h vs the 72h before them: all above the high = breakout, all below the low = breakdown. */
  breakout: "breakout" | "breakdown" | "inside_range" | null;
  structure: "higher_highs_higher_lows" | "lower_highs_lower_lows" | "mixed" | null;
  /** 24h change vs the average daily change over 72h. */
  acceleration: "accelerating" | "decelerating" | "steady" | null;
  volatility_24h: number | null;
  /** 24h log return divided by (hourly volatility × √24). Roughly "how many typical days' moves". */
  vol_adjusted_24h: number | null;
  max_drawdown_7d: number | null;
}

export function momentum(s: Point[]): Momentum {
  const changes = Object.fromEntries(WINDOWS.map((w) => [w, r(change(s, w))])) as Record<Window, number | null>;
  const s6 = sma(s, 6);
  const s24 = sma(s, 24);
  const last = s.at(-1);
  let breakout: Momentum["breakout"] = null;
  if (last) {
    // The last 3 hours must all sit outside the previous 72h range: one tick of noise is not a breakout.
    const recent = s.filter((p) => p.t > last.t - 3 * 3_600_000);
    const prior = window(s, 72).filter((p) => p.t <= last.t - 3 * 3_600_000);
    if (prior.length >= 6 && recent.length >= 2) {
      const hi = Math.max(...prior.map((p) => p.price));
      const lo = Math.min(...prior.map((p) => p.price));
      breakout = Math.min(...recent.map((p) => p.price)) > hi ? "breakout" : Math.max(...recent.map((p) => p.price)) < lo ? "breakdown" : "inside_range";
    }
  }
  let structure: Momentum["structure"] = null;
  if (last) {
    const seg = [2, 1, 0].map((k) => s.filter((p) => p.t > last.t - (k + 1) * 24 * 3_600_000 && p.t <= last.t - k * 24 * 3_600_000));
    if (seg.every((x) => x.length >= 3)) {
      const hi = seg.map((x) => Math.max(...x.map((p) => p.price)));
      const lo = seg.map((x) => Math.min(...x.map((p) => p.price)));
      const up = hi[1]! > hi[0]! && hi[2]! > hi[1]! && lo[1]! > lo[0]! && lo[2]! > lo[1]!;
      const dn = hi[1]! < hi[0]! && hi[2]! < hi[1]! && lo[1]! < lo[0]! && lo[2]! < lo[1]!;
      structure = up ? "higher_highs_higher_lows" : dn ? "lower_highs_lower_lows" : "mixed";
    }
  }
  const c24 = changes["24h"];
  const c72 = changes["72h"];
  let acceleration: Momentum["acceleration"] = null;
  if (c24 !== null && c72 !== null) {
    const daily = c72 / 3;
    acceleration = Math.abs(c24 - daily) < 1 ? "steady" : c24 > daily ? "accelerating" : "decelerating";
  }
  const vol = volatility(s, 24);
  let vol_adjusted_24h: number | null = null;
  if (vol && c24 !== null) vol_adjusted_24h = round(Math.log(1 + c24 / 100) / ((vol / 100) * Math.sqrt(24)));
  return {
    changes,
    sma_6h: s6 === null ? null : Math.round(s6),
    sma_24h: s24 === null ? null : Math.round(s24),
    short_above_long: s6 === null || s24 === null || window(s, 24).length < 12 ? null : s6 > s24,
    breakout,
    structure,
    acceleration,
    volatility_24h: r(vol),
    vol_adjusted_24h,
    max_drawdown_7d: r(maxDrawdown(s, 168)),
  };
}

// ---------------------------------------------------------------- mean reversion

export interface MeanReversion {
  /** Last price vs its own 7d mean, in standard deviations. */
  z_7d: number | null;
  /** Where the last price sits in its 7d low-high range, 0..1. */
  range_position_7d: number | null;
  low_7d: number | null;
  high_7d: number | null;
  /** Last price vs median current price of peers (same rating, same primary position). >1 = dearer. */
  peer_price_ratio: number | null;
  peer_count: number;
  /**
   * A HYPOTHESIS about why it's low:
   * - recent_dislocation: the week before the last day moved < 5%, and the last 24h fell >= 5%
   * - persistent_decline: already down >= 5% before the last day and still falling over 72h
   * - unclear: low, but neither pattern fits
   */
  pattern: "recent_dislocation" | "persistent_decline" | "unclear" | "not_low" | null;
  unusually_low: boolean;
}

export function meanReversion(s: Point[], peerPrices: number[], rules: MarketRules = DEFAULT_MARKET_RULES): MeanReversion {
  const w = window(s, 168);
  const last = s.at(-1);
  const prices = w.map((p) => p.price);
  const m = mean(prices);
  const sd = stdev(prices);
  const z = last && prices.length >= rules.min_points && sd > 0 ? round((last.price - m) / sd) : null;
  const lo = prices.length ? Math.min(...prices) : null;
  const hi = prices.length ? Math.max(...prices) : null;
  const rp = last && lo !== null && hi !== null && hi > lo ? round((last.price - lo) / (hi - lo)) : null;
  const pm = median(peerPrices);
  const ratio = last && pm ? round(last.price / pm) : null;
  const unusually_low = z !== null && z <= rules.thresholds.mean_reversion_z;
  let pattern: MeanReversion["pattern"] = null;
  if (z !== null) {
    if (!unusually_low) pattern = "not_low";
    else {
      const before = w.filter((p) => last && p.t <= last.t - 24 * 3_600_000).map((p) => p.price);
      const earlyMove = before.length >= 2 ? pct(before[0]!, before.at(-1)!) : null;
      const c24 = change(s, "24h");
      const c72 = change(s, "72h");
      if (earlyMove !== null && Math.abs(earlyMove) < 5 && c24 !== null && c24 <= -5) pattern = "recent_dislocation";
      else if (earlyMove !== null && earlyMove <= -5 && c72 !== null && c72 < 0) pattern = "persistent_decline";
      else pattern = "unclear";
    }
  }
  return { z_7d: z, range_position_7d: rp, low_7d: lo, high_7d: hi, peer_price_ratio: ratio, peer_count: peerPrices.length, pattern, unusually_low };
}

// ---------------------------------------------------------------- classification

export type SignalStatus = "watch" | "research_further" | "favorable_setup" | "overheated" | "elevated_risk" | "insufficient_evidence";
export type OpportunityCategory =
  | "confirmed_momentum"
  | "relative_value_opportunity"
  | "possible_temporary_discount"
  | "possible_demand_exhaustion"
  | "elevated_downside_risk";

export interface SignalAssessment {
  status: SignalStatus;
  categories: OpportunityCategory[];
  reasons: string[];
  /** What would make this read wrong. Always filled. */
  could_be_wrong: string[];
  entry_risk: { elevated: boolean; change_72h: number | null; note: string };
  evidence: "estimate";
}

export function assessSignals(input: {
  fresh: FreshnessCheck;
  points: number;
  rs: RsRow[];
  mom: Momentum;
  mr: MeanReversion;
  regime_primary: string;
  rules?: MarketRules;
}): SignalAssessment {
  const rules = input.rules ?? DEFAULT_MARKET_RULES;
  const { fresh, rs, mom, mr } = input;
  const reasons: string[] = [];
  const could_be_wrong = [
    "Price history alone shows no listing depth, completed sales or supply; a move can reverse when packs or rewards add supply.",
    "No SBC, Evolution or promo events are linked yet (Stage B), so a catalyst may already explain the move.",
  ];
  const categories: OpportunityCategory[] = [];
  const c72 = mom.changes["72h"];
  const entry = {
    elevated: c72 !== null && c72 >= rules.thresholds.priced_in_72h,
    change_72h: c72,
    note:
      c72 === null
        ? "72h change not available."
        : c72 >= rules.thresholds.priced_in_72h
          ? `Already up ${c72}% in 72h (rule: >= ${rules.thresholds.priced_in_72h}%). Much of any demand change may be priced in.`
          : `Up ${c72}% in 72h, below the ${rules.thresholds.priced_in_72h}% entry-risk rule.`,
  };

  if (fresh.status !== "fresh" || input.points < rules.min_points) {
    reasons.push(fresh.status !== "fresh" ? fresh.message : `Only ${input.points} price points (need ${rules.min_points}).`);
    return { status: "insufficient_evidence", categories, reasons, could_be_wrong, entry_risk: entry, evidence: "estimate" };
  }

  const v = (b: Benchmark, w: Window) => rs.find((x) => x.benchmark === b)?.cells.find((c) => c.window === w)?.verdict ?? "insufficient_data";
  const outMarket = v("market", "24h") === "outperforming" && v("market", "72h") !== "underperforming";
  const outPeers = (["category", "rating", "position", "utility"] as const).filter((b) => v(b, "24h") === "outperforming").length;
  const underPeers = (["category", "rating", "position", "utility"] as const).filter((b) => v(b, "24h") === "underperforming").length;

  if (entry.elevated) {
    reasons.push(entry.note);
    if (mom.acceleration === "decelerating") {
      categories.push("possible_demand_exhaustion");
      reasons.push("Momentum is decelerating after the rise.");
    }
    could_be_wrong.push("A sustained new use (meta shift, long SBC) can keep a risen card high.");
    return { status: "overheated", categories, reasons, could_be_wrong, entry_risk: entry, evidence: "estimate" };
  }

  // Structure only counts with a real move behind it (72h <= -3%): flat noise makes lower highs too.
  const downStructure = mom.structure === "lower_highs_lower_lows" && c72 !== null && c72 <= -3;
  if (mom.breakout === "breakdown" || downStructure || mr.pattern === "persistent_decline") {
    categories.push("elevated_downside_risk");
    if (mom.breakout === "breakdown") reasons.push("The last 3 hours all traded below the previous 72h range.");
    if (downStructure) reasons.push(`Lower highs and lower lows over three days (${c72}% in 72h).`);
    if (mr.pattern === "persistent_decline") reasons.push("It is low, but has been falling most of the week (persistent decline, not a dip).");
    could_be_wrong.push("A falling card can be a bargain once supply dries up; that needs supply data to judge.");
    return { status: "elevated_risk", categories, reasons, could_be_wrong, entry_risk: entry, evidence: "estimate" };
  }

  const momentumOk = mom.short_above_long === true && ((mom.structure === "higher_highs_higher_lows" && (c72 ?? 0) >= 3) || mom.breakout === "breakout");
  if (outMarket && outPeers >= 2 && momentumOk) {
    categories.push("confirmed_momentum");
    reasons.push(`Outperforming the market index and ${outPeers} of 4 peer groups over 24h, with short average above long and ${mom.breakout === "breakout" ? "a range breakout" : "higher highs and lows"}.`);
  }
  if (mr.unusually_low && mr.pattern === "recent_dislocation") {
    categories.push("possible_temporary_discount");
    reasons.push(`Price is ${mr.z_7d} standard deviations below its 7d average after a stable week: a recent dislocation.`);
  }
  if (mr.peer_price_ratio !== null && mr.peer_count >= 3 && mr.peer_price_ratio <= 0.85 && underPeers === 0) {
    categories.push("relative_value_opportunity");
    reasons.push(`Priced at ${Math.round(mr.peer_price_ratio * 100)}% of the median peer (same rating and position, ${mr.peer_count} peers).`);
    could_be_wrong.push("Same rating and position isn't the same card: PlayStyles, roles and chemistry can justify the gap.");
  }

  const regimeBad = input.regime_primary === "insufficient_data" || input.regime_primary === "broadly_falling";
  if (categories.length >= 2 && !regimeBad) return { status: "favorable_setup", categories, reasons, could_be_wrong, entry_risk: entry, evidence: "estimate" };
  if (categories.length) {
    if (regimeBad) reasons.push(`Market regime is ${input.regime_primary.replace(/_/g, " ")}: not rated favourable.`);
    return { status: "research_further", categories, reasons, could_be_wrong, entry_risk: entry, evidence: "estimate" };
  }
  if (outPeers || outMarket) reasons.push("Some relative strength, not yet confirmed by momentum structure.");
  else reasons.push("Nothing unusual against its benchmarks.");
  return { status: "watch", categories, reasons, could_be_wrong, entry_risk: entry, evidence: "estimate" };
}

const r = (n: number | null | undefined) => (n === null || n === undefined ? null : round(n));


