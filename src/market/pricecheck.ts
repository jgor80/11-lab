// Price check (Jeff's choice, 2026-11-02 17:51Z): the XI Lab helper may run transfer-market SEARCHES itself, in the
// user's own signed-in Web App tab, slowly, for the user's own club cards. It only ever sends GET searches to the
// same address the Web App uses for its own searches; it never bids, buys, lists, moves or quick-sells, and it
// stops at the first sign of trouble (any non-200 answer, a captcha or "too many actions").
//
// The search format is LEARNED from a search the user runs themselves (the Web App's own request), so nothing
// here guesses EA's parameters. This module is the pure part: the template, the queue, the pacing and the cap.
import type { ClubItem } from "../club/capture.js";
import type { CaptureRow } from "./capture.js";

export const DAILY_CAP = 100;
/** A newly unlocked account starts lower and rises by RAMP_PER_DAY each UTC day to DAILY_CAP. */
export const FIRST_DAY_CAP = 30;
export const RAMP_PER_DAY = 10;
/** At most this many searches in any rolling hour. */
export const HOURLY_CAP = 20;
/** After EA throttles, refuses or asks for a captcha, no searches for this long. */
export const COOLDOWN_HOURS = 24;
/** Searches per sitting before a longer break. */
export const SESSION_LENGTH = 12;
/** Skip cards priced more recently than this. */
export const FRESH_HOURS = 12;

const PRICE_FILTERS = ["minb", "maxb", "micr", "macr", "minr", "maxr"];

/**
 * A search the Web App sent, kept as a template if it names one player: `definitionId` (a card version) or
 * `maskedDefId` (a footballer). Returns null for anything else, including non-GET requests.
 */
export function learnTemplate(url: string, method = "GET"): string | null {
  if (method.toUpperCase() !== "GET") return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/\/ut\/game\/fc\d+\/transfermarket$/i.test(u.pathname)) return null;
  if (!u.searchParams.has("definitionId") && !u.searchParams.has("maskedDefId")) return null;
  for (const k of PRICE_FILTERS) u.searchParams.delete(k);
  u.searchParams.set("start", "0");
  return u.toString();
}

/** The template with this card in it. A card-version template uses EA's item id, a footballer template the asset id. */
export function searchUrlFor(template: string, item: Pick<ClubItem, "ea_item_id" | "asset_id">): string | null {
  const u = new URL(template);
  if (u.searchParams.has("definitionId")) u.searchParams.set("definitionId", String(item.ea_item_id));
  else if (u.searchParams.has("maskedDefId")) {
    if (!item.asset_id) return null;
    u.searchParams.set("maskedDefId", String(item.asset_id));
  } else return null;
  return u.toString();
}

/** Only ever a GET to the transfer-market search address: the runner checks this before every request. */
export function isSafeSearch(url: string, method: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  try {
    return /\/ut\/game\/fc\d+\/transfermarket$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Your club players without a recent price, tradeable first, then highest rated. Loans and managers are left out. */
export function buildQueue(club: ClubItem[], rows: CaptureRow[], now: Date, limit: number): ClubItem[] {
  const fresh = now.getTime() - FRESH_HOURS * 3600_000;
  const priced = new Set(rows.filter((r) => Date.parse(r.observed_at) >= fresh).map((r) => r.ea_item_id));
  const seen = new Set<number>();
  return club
    .filter((i) => i.kind === "player" && !i.loan && !priced.has(i.ea_item_id) && !seen.has(i.ea_item_id) && seen.add(i.ea_item_id))
    .sort((a, b) => Number(a.untradeable) - Number(b.untradeable) || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, Math.max(0, limit));
}

/** Today's cap: FIRST_DAY_CAP on the first day the price check ran, then RAMP_PER_DAY more each day, up to DAILY_CAP. */
export function dailyCapFor(firstDay: string | undefined, now: Date): number {
  if (!firstDay) return FIRST_DAY_CAP;
  const days = Math.max(0, Math.floor((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(firstDay)) / 86_400_000));
  return Math.min(DAILY_CAP, FIRST_DAY_CAP + RAMP_PER_DAY * days);
}

/** Searches left today (UTC day). */
export function remainingToday(day: string | undefined, count: number | undefined, now: Date, cap = DAILY_CAP): number {
  return day === now.toISOString().slice(0, 10) ? Math.max(0, cap - (count ?? 0)) : cap;
}

/** Search times kept for the budget display and the hourly cap (last 24 hours). */
export function pruneLog(log: string[] | undefined, now: Date): string[] {
  const since = now.getTime() - 24 * 3600_000;
  return (log ?? []).filter((t) => Date.parse(t) > since);
}

/** Searches in the last 1, 3 and 24 hours. */
export function searchBudget(log: string[] | undefined, now: Date) {
  const n = (h: number) => (log ?? []).filter((t) => Date.parse(t) > now.getTime() - h * 3600_000).length;
  return { h1: n(1), h3: n(3), h24: n(24) };
}

/** How many searches this run may make: the lower of what's left today and in the rolling hour. */
export function runLimit(s: { day?: string; count?: number; firstDay?: string; log?: string[] }, now: Date): number {
  return Math.min(remainingToday(s.day, s.count, now, dailyCapFor(s.firstDay, now)), Math.max(0, HOURLY_CAP - searchBudget(s.log, now).h1));
}

/** True for answers that mean EA is limiting or checking this account: start a cool-down. */
export function isThrottle(status: number): boolean {
  return [429, 458, 459, 460, 461, 494, 512, 521].includes(status);
}

export const cooldownUntil = (now: Date) => new Date(now.getTime() + COOLDOWN_HOURS * 3600_000).toISOString();
export const inCooldown = (until: string | null | undefined, now: Date) => !!until && Date.parse(until) > now.getTime();

/** Wait before search number `n` (0-based) of this run: 10-20 s, and a 4-8 minute break after every SESSION_LENGTH. */
export function delayBefore(n: number, rand: () => number = Math.random): number {
  if (n === 0) return 0;
  if (n % SESSION_LENGTH === 0) return Math.round(240_000 + rand() * 240_000);
  return Math.round(10_000 + rand() * 10_000);
}

/** Why to stop after an answer, or null to carry on. Anything but a normal result page stops the run. */
export function stopReason(status: number, json: unknown): string | null {
  if (status === 401) return "Signed out of the Web App.";
  if (status === 429 || status === 512 || status === 521) return "EA says too many requests. Stopped; try again tomorrow.";
  if (status === 458 || status === 459) return "EA asked for a verification (captcha). Stopped. Solve it in the Web App and don't restart today.";
  if (status === 460 || status === 461 || status === 494) return "EA refused market access (locked or blocked). Stopped.";
  if (status !== 200) return `EA answered ${status}. Stopped to be safe.`;
  if (!json || typeof json !== "object" || !Array.isArray((json as { auctionInfo?: unknown }).auctionInfo)) return "Unexpected answer from EA. Stopped to be safe.";
  return null;
}
