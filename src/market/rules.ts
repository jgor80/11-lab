// Market rules are data, not code: a versioned object so the tax or price steps can change without a release.
// Values here are community knowledge, not confirmed by EA, and are labelled that way.

export const MARKET_ENGINE_VERSION = "market-0.1.0";

export interface PriceStep {
  /** Applies to prices >= from (and below the next step's from). */
  from: number;
  step: number;
}

export interface MarketRules {
  id: string;
  status: "unverified" | "verified";
  notes: string;
  /** EA transfer tax on the SALE price, as a fraction. Floored to whole coins. */
  transfer_tax_rate: number;
  /** Valid bid/BIN increments by price band. */
  price_steps: PriceStep[];
  min_price: number;
  /** A price older than this is stale: no current value is claimed and no favourable setup is issued. */
  stale_after_hours: number;
  /** Fewer points than this in the lookback means "insufficient data" for that metric. */
  min_points: number;
  /** Thresholds the scanner and regime classifier use. All in percent unless noted. */
  thresholds: {
    /** Card minus benchmark, in percentage points, to call it out- or under-performing. */
    relative_strength_pp: number;
    /** 24h index change that counts as a broad move. */
    regime_trend_24h: number;
    /** 7d index change that confirms a broad move. */
    regime_trend_7d: number;
    /** Hourly log-return stdev (in %) above which a basket is "volatile". */
    high_volatility: number;
    /** A fodder tier beating the gameplay basket by this many pp over 24h suggests SBC-driven demand. */
    sbc_spread_pp: number;
    /** A rise this large over 72h before the user sees the signal = elevated entry risk. */
    priced_in_72h: number;
    /** z-score below which a card is "unusually far below" its own range. */
    mean_reversion_z: number;
  };
}

export const FC27_MARKET_V1: MarketRules = {
  id: "fc27-market-v1",
  status: "unverified",
  notes:
    "Transfer tax 5% of the sale price (floored) and the price bands are community knowledge as of 2026-11-02, not confirmed by EA. " +
    "Scanner thresholds are XI Lab defaults, not validated against outcomes yet.",
  transfer_tax_rate: 0.05,
  price_steps: [
    { from: 0, step: 50 },
    { from: 1_000, step: 100 },
    { from: 10_000, step: 250 },
    { from: 50_000, step: 500 },
    { from: 100_000, step: 1_000 },
  ],
  min_price: 200,
  stale_after_hours: 6,
  min_points: 6,
  thresholds: {
    relative_strength_pp: 3,
    regime_trend_24h: 2,
    regime_trend_7d: 4,
    high_volatility: 2.5,
    sbc_spread_pp: 4,
    priced_in_72h: 25,
    mean_reversion_z: -1.5,
  },
};

export const DEFAULT_MARKET_RULES = FC27_MARKET_V1;

/** Tax EA keeps when a card sells at `price`. */
export function transferTax(price: number, rules: MarketRules = DEFAULT_MARKET_RULES): number {
  return Math.floor(price * rules.transfer_tax_rate);
}

/** Coins received after tax. */
export function netAfterTax(price: number, rules: MarketRules = DEFAULT_MARKET_RULES): number {
  return price - transferTax(price, rules);
}

export function stepAt(price: number, rules: MarketRules = DEFAULT_MARKET_RULES): number {
  let step = rules.price_steps[0]!.step;
  for (const s of rules.price_steps) if (price >= s.from) step = s.step;
  return step;
}

/** Round to a price the market accepts. `up` for "at least this much" (e.g. break-even), `down` for bids. */
export function roundToStep(price: number, dir: "up" | "down" | "nearest" = "nearest", rules: MarketRules = DEFAULT_MARKET_RULES): number {
  if (price <= rules.min_price) return rules.min_price;
  const step = stepAt(price, rules);
  const f = dir === "up" ? Math.ceil : dir === "down" ? Math.floor : Math.round;
  const r = f(price / step) * step;
  // Rounding can cross into the next band; re-snap once with that band's step.
  const step2 = stepAt(r, rules);
  return step2 === step ? r : f(r / step2) * step2;
}

export function isValidPrice(price: number, rules: MarketRules = DEFAULT_MARKET_RULES): boolean {
  return Number.isInteger(price) && price >= rules.min_price && price % stepAt(price, rules) === 0;
}
