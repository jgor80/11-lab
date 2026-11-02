// Trade Thesis Simulator: arithmetic on the user's own assumptions. No forecast is made here; the only
// probability shown is the break-even win rate implied by the user's target and downside.
import { DEFAULT_MARKET_RULES, isValidPrice, netAfterTax, roundToStep, transferTax, type MarketRules } from "./rules.js";
import type { FreshnessCheck, Platform } from "./types.js";

export interface ThesisInput {
  card_id: string;
  platform: Platform;
  quantity: number;
  buy_price: number;
  target_price: number;
  downside_price: number;
  holding_hours?: number;
  coin_balance?: number | null;
  /** Copies of this card already held, and what they cost (cost basis), so nothing is double-counted. */
  existing?: { quantity: number; cost_basis: number } | null;
  /** Optional user assumption: chance of selling at target (else downside). Shown as the user's assumption. */
  assumed_target_probability?: number | null;
}

export interface ThesisResult {
  input: ThesisInput;
  investment: number;
  /** Tax EA keeps per card, at target and at downside. */
  tax_at_target: number;
  tax_at_downside: number;
  /** Lowest valid listing price that returns at least the buy price after tax. */
  break_even_price: number;
  profit_at_target: number;
  loss_at_downside: number;
  return_at_target_pct: number;
  return_at_downside_pct: number;
  /** profit_at_target / |loss_at_downside|. null when the downside isn't a loss. */
  risk_reward: number | null;
  /** Win rate at which target-or-downside breaks even: |loss| / (profit + |loss|). */
  break_even_win_rate: number | null;
  /** Expected value under the user's own probability, if given. Labelled as an assumption. */
  user_scenario_ev: { probability: number; expected_profit: number; label: string } | null;
  exposure: {
    /** Share of liquid coins this trade uses. Holdings are NOT counted as coins. */
    of_coins_pct: number | null;
    affordable: boolean | null;
    /** Copies after the trade and their total cost basis. */
    position_after: { quantity: number; cost_basis: number };
  };
  price_checks: { field: string; price: number; valid: boolean; nearest_valid: number }[];
  market: { latest_price: number | null; freshness: FreshnessCheck | null; buy_vs_latest_pct: number | null };
  warnings: string[];
  limitations: string[];
  rules_version: string;
  evidence: "estimate";
}

export function analyzeTrade(input: ThesisInput, market: { latest_price: number | null; freshness: FreshnessCheck | null } = { latest_price: null, freshness: null }, rules: MarketRules = DEFAULT_MARKET_RULES): ThesisResult {
  const q = Math.max(1, Math.floor(input.quantity));
  const { buy_price: buy, target_price: tgt, downside_price: down } = input;
  const investment = buy * q;
  const perTarget = netAfterTax(tgt, rules) - buy;
  const perDown = netAfterTax(down, rules) - buy;
  const profit = perTarget * q;
  const loss = perDown * q;
  const warnings: string[] = [];

  const price_checks = (
    [
      ["buy_price", buy],
      ["target_price", tgt],
      ["downside_price", down],
    ] as const
  ).map(([field, price]) => ({ field, price, valid: isValidPrice(price, rules), nearest_valid: roundToStep(price, "nearest", rules) }));
  for (const c of price_checks) if (!c.valid) warnings.push(`${c.field.replace("_", " ")} ${c.price.toLocaleString("en-US")} isn't a valid market price; nearest is ${c.nearest_valid.toLocaleString("en-US")}.`);

  if (tgt <= buy) warnings.push("Target is not above the buy price.");
  if (down >= buy) warnings.push("Downside exit is not below the buy price: that's not a downside scenario.");
  if (perTarget <= 0 && tgt > buy) warnings.push("After the 5% tax the target sale loses money.");

  const risk_reward = loss < 0 && profit > 0 ? round2(profit / -loss) : null;
  const break_even_win_rate = loss < 0 && profit > 0 ? round4(-loss / (profit - loss)) : null;
  const p = input.assumed_target_probability;
  const user_scenario_ev =
    typeof p === "number" && p >= 0 && p <= 1
      ? { probability: p, expected_profit: Math.round(p * profit + (1 - p) * loss), label: "Your assumption, not an XI Lab forecast." }
      : null;

  const coins = input.coin_balance ?? null;
  const ex = input.existing ?? { quantity: 0, cost_basis: 0 };
  const exposure = {
    of_coins_pct: coins && coins > 0 ? round2((investment / coins) * 100) : null,
    affordable: coins === null ? null : investment <= coins,
    position_after: { quantity: ex.quantity + q, cost_basis: ex.cost_basis + investment },
  };
  if (exposure.affordable === false) warnings.push(`Needs ${investment.toLocaleString("en-US")} coins; you have ${coins!.toLocaleString("en-US")}. Cards you hold are not coins until sold (and taxed).`);
  if (exposure.of_coins_pct !== null && exposure.of_coins_pct > 50) warnings.push(`Uses ${exposure.of_coins_pct}% of your coins on one card.`);

  const latest = market.freshness?.status === "fresh" ? market.latest_price : null;
  if (market.freshness && market.freshness.status !== "fresh") warnings.push(`No current price to check against: ${market.freshness.message}`);
  const buy_vs_latest_pct = latest ? round2(((buy - latest) / latest) * 100) : null;
  if (buy_vs_latest_pct !== null && buy_vs_latest_pct < -15) warnings.push(`Buy price is ${-buy_vs_latest_pct}% under the latest observed price; fills that far below are uncommon.`);

  return {
    input: { ...input, quantity: q },
    investment,
    tax_at_target: transferTax(tgt, rules),
    tax_at_downside: transferTax(down, rules),
    break_even_price: breakEvenPrice(buy, rules),
    profit_at_target: profit,
    loss_at_downside: loss,
    return_at_target_pct: round2((perTarget / buy) * 100),
    return_at_downside_pct: round2((perDown / buy) * 100),
    risk_reward,
    break_even_win_rate,
    user_scenario_ev,
    exposure,
    price_checks,
    market: { latest_price: latest, freshness: market.freshness, buy_vs_latest_pct },
    warnings,
    limitations: [
      "Liquidity and execution data are unavailable: nothing here says the card will fill at these prices or how many can be sold.",
      "No calibrated forecast exists yet, so XI Lab gives no probability of reaching the target. The break-even win rate is arithmetic on your inputs.",
      `Tax ${Math.round(rules.transfer_tax_rate * 100)}% and price steps from rule version ${rules.id} (${rules.status}).`,
    ],
    rules_version: rules.id,
    evidence: "estimate",
  };
}

/** Lowest valid listing price whose after-tax proceeds cover `buy`. */
export function breakEvenPrice(buy: number, rules: MarketRules = DEFAULT_MARKET_RULES): number {
  let p = roundToStep(Math.ceil(buy / (1 - rules.transfer_tax_rate)), "up", rules);
  // Flooring the tax can make one step lower enough; check down then up.
  for (let i = 0; i < 3; i++) {
    const lower = roundToStep(p - 1, "down", rules);
    if (lower < p && netAfterTax(lower, rules) >= buy) p = lower;
    else break;
  }
  while (netAfterTax(p, rules) < buy) p = roundToStep(p + 1, "up", rules);
  return p;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
