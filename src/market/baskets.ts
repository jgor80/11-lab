// Market baskets and benchmark indexes.
// Rules are data (shown to the user), membership is point-in-time (a card added today never changes yesterday's
// index), and the index is a chained, equal-weighted geometric mean of price relatives, so a newly popular card
// joining the basket can't rewrite history.
import { fitScore } from "../workspace/index.js";
import { DEFAULT_MARKET_RULES, type MarketRules } from "./rules.js";
import { change, iso, mean, ms, priceAt, quantile, round, volatility, type Point } from "./series.js";
import { WINDOWS, type CardCategory, type MarketCard, type Platform, type Window } from "./types.js";

export interface BasketRule {
  categories?: CardCategory[];
  rating_min?: number;
  rating_max?: number;
  flag?: "evolution_candidate" | "live_upgrade";
  /** Best tactical-fit ESTIMATE at any listed position must reach this. Used for the "meta" basket. */
  min_best_fit?: number;
  tradeable_only?: boolean;
}

export interface BasketDefinition {
  id: string;
  label: string;
  group: "fodder" | "gameplay" | "promo" | "icons_heroes" | "evolution" | "live" | "market";
  /** Plain-language rule, shown next to the index. */
  description: string;
  rule: BasketRule;
}

const fodder = (r: number): BasketDefinition => ({
  id: `fodder-${r}`,
  label: `${r}-rated fodder`,
  group: "fodder",
  description: `Tradeable base cards rated exactly ${r}.`,
  rule: { categories: ["base"], rating_min: r, rating_max: r, tradeable_only: true },
});

export const DEFAULT_BASKETS: BasketDefinition[] = [
  { id: "market", label: "Whole market", group: "market", description: "Every tradeable card with prices.", rule: { tradeable_only: true } },
  ...[84, 85, 86, 87, 88, 89, 90].map(fodder),
  {
    id: "meta",
    label: "Meta gameplay",
    group: "gameplay",
    description: "Tradeable cards whose best tactical-fit estimate (XI Lab's face-stat profile) is 85 or more. An estimate, not usage data.",
    rule: { min_best_fit: 85, tradeable_only: true },
  },
  { id: "promo", label: "Active promos", group: "promo", description: "Tradeable promo cards.", rule: { categories: ["promo"], tradeable_only: true } },
  { id: "icons-heroes", label: "Icons & Heroes", group: "icons_heroes", description: "Tradeable Icon and Hero cards.", rule: { categories: ["icon", "hero"], tradeable_only: true } },
  { id: "evolution", label: "Evolution candidates", group: "evolution", description: "Cards flagged eligible for a live Evolution. Needs event data (Stage B).", rule: { flag: "evolution_candidate", tradeable_only: true } },
  { id: "live", label: "Live-upgrade cards", group: "live", description: "Cards that upgrade with real-world results. Needs event data (Stage B).", rule: { flag: "live_upgrade", tradeable_only: true } },
];

export function bestFit(card: MarketCard): number | null {
  let best: number | null = null;
  for (const p of card.positions) {
    const s = fitScore(card, p).score;
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

export function matchesRule(card: MarketCard, rule: BasketRule): boolean {
  if (rule.tradeable_only && card.tradeable === false) return false;
  if (rule.categories && !rule.categories.includes(card.category)) return false;
  if (rule.rating_min !== undefined && card.rating < rule.rating_min) return false;
  if (rule.rating_max !== undefined && card.rating > rule.rating_max) return false;
  if (rule.flag && !card[rule.flag]) return false;
  if (rule.min_best_fit !== undefined) {
    const f = bestFit(card);
    if (f === null || f < rule.min_best_fit) return false;
  }
  return true;
}

/** A card's time in a basket. effective_to null = still a member. */
export interface BasketMembership {
  basket_id: string;
  card_id: string;
  effective_from: string;
  effective_to: string | null;
  /** Created from today's card list when history was first imported: early index points may carry survivorship bias. */
  backfilled?: boolean;
}

/**
 * Rebalance: apply the rule to today's cards at `at`. Members that stopped matching are closed at `at`,
 * new matches open at `at`. History is never rewritten.
 */
export function rebalance(def: BasketDefinition, cards: MarketCard[], current: BasketMembership[], at: string): BasketMembership[] {
  const want = new Set(cards.filter((c) => matchesRule(c, def.rule)).map((c) => c.id));
  const out: BasketMembership[] = [];
  const open = new Set<string>();
  for (const m of current) {
    if (m.basket_id !== def.id) continue;
    if (m.effective_to === null && !want.has(m.card_id)) out.push({ ...m, effective_to: at });
    else out.push(m);
    if (m.effective_to === null && want.has(m.card_id)) open.add(m.card_id);
  }
  for (const id of want) if (!open.has(id)) out.push({ basket_id: def.id, card_id: id, effective_from: at, effective_to: null });
  return out;
}

export function membersAt(members: BasketMembership[], basket_id: string, t: number): string[] {
  return members
    .filter((m) => m.basket_id === basket_id && ms(m.effective_from) <= t && (m.effective_to === null || t < ms(m.effective_to)))
    .map((m) => m.card_id);
}

export interface IndexPoint {
  t: string;
  value: number;
  /** Cards that contributed to the move into this point. 0 = carried forward (gap). */
  constituents: number;
}

export interface IndexSeries {
  basket_id: string;
  platform: Platform;
  base: 100;
  points: IndexPoint[];
}

/**
 * Chained index: for each bucket, the geometric mean of p(t)/p(t-1) over cards that were members at t AND had a
 * fresh observation at both ends. A card's own carried-forward price (older than stale_after_hours) doesn't count.
 */
export function computeIndex(
  basket_id: string,
  platform: Platform,
  members: BasketMembership[],
  seriesByCard: Map<string, Point[]>,
  from: string,
  to: string,
  opts: { bucket_hours?: number; rules?: MarketRules } = {},
): IndexSeries {
  const rules = opts.rules ?? DEFAULT_MARKET_RULES;
  const size = (opts.bucket_hours ?? 1) * 3_600_000;
  const stale = rules.stale_after_hours * 3_600_000;
  const start = Math.ceil(ms(from) / size) * size;
  const end = ms(to);
  const points: IndexPoint[] = [];
  let value = 100;
  const fresh = (s: Point[] | undefined, t: number) => {
    const p = s && priceAt(s, t);
    return p && t - p.t <= stale ? p : null;
  };
  for (let t = start; t <= end; t += size) {
    if (!points.length) {
      points.push({ t: iso(t), value, constituents: membersAt(members, basket_id, t).filter((id) => fresh(seriesByCard.get(id), t)).length });
      continue;
    }
    const logs: number[] = [];
    for (const id of membersAt(members, basket_id, t)) {
      const s = seriesByCard.get(id);
      const a = fresh(s, t - size);
      const b = fresh(s, t);
      if (a && b && a.price > 0) logs.push(Math.log(b.price / a.price));
    }
    if (logs.length) value = value * Math.exp(mean(logs));
    points.push({ t: iso(t), value: round(value, 3), constituents: logs.length });
  }
  return { basket_id, platform, base: 100, points };
}

export const indexAsSeries = (ix: IndexSeries): Point[] => ix.points.filter((p) => p.constituents > 0 || ix.points[0]!.t === p.t).map((p) => ({ t: ms(p.t), price: p.value }));

export interface IndexSummary {
  basket_id: string;
  label: string;
  description: string;
  platform: Platform;
  value: number | null;
  changes: Record<Window, number | null>;
  volatility_24h: number | null;
  trend: "rising" | "falling" | "sideways" | "insufficient_data";
  constituents_now: number;
  /** Quantiles of current member prices (coins). */
  distribution: { p10: number; p25: number; median: number; p75: number; p90: number } | null;
}

export function summarizeIndex(def: BasketDefinition, ix: IndexSeries, currentPrices: number[], rules: MarketRules = DEFAULT_MARKET_RULES): IndexSummary {
  const s = indexAsSeries(ix);
  const changes = Object.fromEntries(WINDOWS.map((w) => [w, s.length > 1 ? nullRound(change(s, w)) : null])) as Record<Window, number | null>;
  const last = ix.points.at(-1);
  const enough = s.length >= rules.min_points && (last?.constituents ?? 0) > 0;
  const c24 = changes["24h"];
  const trend = !enough || c24 === null ? "insufficient_data" : c24 > rules.thresholds.regime_trend_24h ? "rising" : c24 < -rules.thresholds.regime_trend_24h ? "falling" : "sideways";
  const q = (x: number) => Math.round(quantile(currentPrices, x)!);
  return {
    basket_id: def.id,
    label: def.label,
    description: def.description,
    platform: ix.platform,
    value: enough && last ? round(last.value, 2) : null,
    changes,
    volatility_24h: nullRound(volatility(s, 24)),
    trend,
    constituents_now: last?.constituents ?? 0,
    distribution: currentPrices.length ? { p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9) } : null,
  };
}

export const nullRound = (n: number | null, d = 2) => (n === null ? null : round(n, d));
