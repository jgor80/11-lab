// Point-in-time price series maths. Everything takes an `asOf` and only uses rows XI Lab had RECEIVED by then,
// so the same functions serve the live screen and a leak-free backtest.
import { DEFAULT_MARKET_RULES, type MarketRules } from "./rules.js";
import { WINDOW_HOURS, type FreshnessCheck, type Platform, type PriceObservation, type Window } from "./types.js";

export interface Point {
  t: number; // epoch ms (observed_at)
  price: number;
}

const HOUR = 3_600_000;
export const ms = (iso: string) => Date.parse(iso);
export const iso = (t: number) => new Date(t).toISOString();

/** Rows usable at `asOf`: received by then and observed by then. */
export function knownAt(rows: PriceObservation[], asOf: string): PriceObservation[] {
  const a = ms(asOf);
  return rows.filter((r) => ms(r.received_at) <= a && ms(r.observed_at) <= a);
}

/** One card on one platform as a sorted series, de-duplicated by observed time (latest received wins). */
export function toSeries(rows: PriceObservation[], card_id: string, platform: Platform, asOf: string): Point[] {
  const byT = new Map<number, { p: number; r: number }>();
  for (const r of knownAt(rows, asOf)) {
    if (r.card_id !== card_id || r.platform !== platform) continue;
    const t = ms(r.observed_at);
    const rec = ms(r.received_at);
    const prev = byT.get(t);
    if (!prev || rec >= prev.r) byT.set(t, { p: r.price, r: rec });
  }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, price: v.p }));
}

export function freshness(series: Point[], asOf: string, rules: MarketRules = DEFAULT_MARKET_RULES): FreshnessCheck {
  const last = series.at(-1);
  if (!last) return { status: "missing", latest_observed_at: null, age_hours: null, stale_after_hours: rules.stale_after_hours, message: "No price observations." };
  const age = (ms(asOf) - last.t) / HOUR;
  const age_hours = Math.round(age * 10) / 10;
  if (age > rules.stale_after_hours)
    return { status: "stale", latest_observed_at: iso(last.t), age_hours, stale_after_hours: rules.stale_after_hours, message: `Last price is ${age_hours}h old (stale after ${rules.stale_after_hours}h). No current value is claimed.` };
  return { status: "fresh", latest_observed_at: iso(last.t), age_hours, stale_after_hours: rules.stale_after_hours, message: `Last price ${age_hours}h old.` };
}

/** Last price at or before t. */
export function priceAt(series: Point[], t: number): Point | null {
  let lo = 0;
  let hi = series.length - 1;
  let best: Point | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]!.t <= t) {
      best = series[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * % change over a window ending at the last point. null if the series does not reach back that far
 * (within a tolerance of half the window, min 1h) — we never extrapolate.
 */
export function change(series: Point[], window: Window): number | null {
  const last = series.at(-1);
  if (!last) return null;
  const h = WINDOW_HOURS[window];
  const target = last.t - h * HOUR;
  const start = priceAt(series, target);
  if (!start || start === last) return null;
  if (target - start.t > Math.max(HOUR, (h * HOUR) / 2)) return null;
  return pct(start.price, last.price);
}

export const pct = (a: number, b: number) => (a > 0 ? ((b - a) / a) * 100 : 0);
export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function window(series: Point[], hours: number): Point[] {
  const last = series.at(-1);
  if (!last) return [];
  const from = last.t - hours * HOUR;
  return series.filter((p) => p.t >= from);
}

export function sma(series: Point[], hours: number): number | null {
  const w = window(series, hours);
  if (!w.length) return null;
  return w.reduce((s, p) => s + p.price, 0) / w.length;
}

export function logReturns(series: Point[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!.price;
    const b = series[i]!.price;
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

/** Stdev of log returns in %, over the lookback. Not annualised: FUT has no trading calendar. */
export function volatility(series: Point[], hours: number): number | null {
  const r = logReturns(window(series, hours));
  return r.length >= 3 ? stdev(r) * 100 : null;
}

/** Largest peak-to-trough fall in % over the lookback (negative or 0). */
export function maxDrawdown(series: Point[], hours: number): number | null {
  const w = window(series, hours);
  if (w.length < 2) return null;
  let peak = w[0]!.price;
  let dd = 0;
  for (const p of w) {
    peak = Math.max(peak, p.price);
    dd = Math.min(dd, pct(peak, p.price));
  }
  return dd;
}

/** Bucket a series to the last price in each `hours` bucket (aligned to the epoch). */
export function bucketed(series: Point[], hours: number): Point[] {
  const size = hours * HOUR;
  const m = new Map<number, Point>();
  for (const p of series) m.set(Math.floor(p.t / size) * size, p);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, p]) => ({ t, price: p.price }));
}
