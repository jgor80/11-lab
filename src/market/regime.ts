// Market regime: measured, rule-based. Each regime lists the observations that triggered it, and regimes that
// need data we don't have (listings, supply) say "not evaluable" instead of guessing.
import { DEFAULT_MARKET_RULES, type MarketRules } from "./rules.js";
import type { IndexSummary } from "./baskets.js";

export type Regime =
  | "broadly_rising"
  | "broadly_falling"
  | "sideways"
  | "high_supply"
  | "sbc_driven_demand"
  | "promo_volatility"
  | "insufficient_data";

export interface RegimeFlag {
  regime: Regime;
  /** The measured values and the rule they crossed. */
  because: string;
}

export interface RegimeResult {
  /** Primary direction regime. */
  primary: Regime;
  /** Extra conditions that hold at the same time (SBC-driven demand, promo volatility). */
  flags: RegimeFlag[];
  observations: string[];
  not_evaluable: { regime: Regime; reason: string }[];
  /** Which Stage A strategies make sense in this regime. A rule table, not advice. */
  strategy_notes: string[];
  rules_version: string;
}

export function classifyRegime(indexes: IndexSummary[], rules: MarketRules = DEFAULT_MARKET_RULES): RegimeResult {
  const T = rules.thresholds;
  const by = (id: string) => indexes.find((i) => i.basket_id === id);
  const market = by("market");
  const meta = by("meta");
  const promo = by("promo");
  const fodder = indexes.filter((i) => i.basket_id.startsWith("fodder-") && i.changes["24h"] !== null);
  const observations: string[] = [];
  const flags: RegimeFlag[] = [];
  const not_evaluable = [{ regime: "high_supply" as const, reason: "Needs listing depth or pack-supply data; no authorised source provides it yet." }];

  let primary: Regime = "insufficient_data";
  if (market && market.trend !== "insufficient_data" && market.changes["24h"] !== null) {
    const c24 = market.changes["24h"]!;
    const c7 = market.changes["7d"];
    observations.push(`Whole-market index ${fmt(c24)} over 24h${c7 === null ? " (7d not available)" : `, ${fmt(c7)} over 7d`}.`);
    if (c24 > T.regime_trend_24h && (c7 === null || c7 > T.regime_trend_7d)) primary = "broadly_rising";
    else if (c24 < -T.regime_trend_24h && (c7 === null || c7 < -T.regime_trend_7d)) primary = "broadly_falling";
    else primary = "sideways";
  } else observations.push("Whole-market index has too few fresh points to classify.");

  if (fodder.length && meta && meta.changes["24h"] !== null) {
    const m = meta.changes["24h"]!;
    const hot = fodder.filter((i) => i.changes["24h"]! - m >= T.sbc_spread_pp);
    observations.push(`Fodder tiers over 24h: ${fodder.map((i) => `${i.basket_id.slice(7)} ${fmt(i.changes["24h"]!)}`).join(", ")}; meta gameplay ${fmt(m)}.`);
    if (hot.length)
      flags.push({
        regime: "sbc_driven_demand",
        because: `${hot.map((i) => i.label).join(", ")} beat meta gameplay cards by >= ${T.sbc_spread_pp}pp over 24h. Consistent with SBC demand; no SBC event data is linked yet.`,
      });
  }

  if (promo && promo.volatility_24h !== null && market?.volatility_24h != null) {
    observations.push(`Promo basket hourly volatility ${promo.volatility_24h}% vs market ${market.volatility_24h}%.`);
    if (promo.volatility_24h >= T.high_volatility && promo.volatility_24h >= 1.5 * market.volatility_24h)
      flags.push({ regime: "promo_volatility", because: `Promo volatility ${promo.volatility_24h}% >= ${T.high_volatility}% and 1.5x the market.` });
  }

  return { primary, flags, observations, not_evaluable, strategy_notes: strategyNotes(primary, flags), rules_version: rules.id };
}

function strategyNotes(primary: Regime, flags: RegimeFlag[]): string[] {
  const n: string[] = [];
  if (primary === "insufficient_data") return ["Not enough fresh market data: Market Lab won't rate any setup as favourable."];
  if (primary === "broadly_falling") n.push("Falling market: mean-reversion buys carry extra risk; a card holding value while peers fall is worth a look, not a buy signal.");
  if (primary === "broadly_rising") n.push("Rising market: judge momentum against the index, not in coins; most cards rising is not relative strength.");
  if (primary === "sideways") n.push("Range-bound market: relative value and mean reversion are the most informative Stage A signals.");
  if (flags.some((f) => f.regime === "sbc_driven_demand")) n.push("Fodder outperforming: fodder momentum may be SBC-driven and can reverse when the SBC expires.");
  if (flags.some((f) => f.regime === "promo_volatility")) n.push("Promo volatility: wider downside scenarios are appropriate for promo cards.");
  return n;
}

const fmt = (n: number, unit = "%") => `${n >= 0 ? "+" : ""}${Math.round(n * 100) / 100}${unit}`;
