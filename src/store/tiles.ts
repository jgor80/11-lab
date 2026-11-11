// Store tiles (Jeff, 2026-11-11): the Web App shows each pack's real name ("European Dreams Pack"), its description,
// user limit, "Ending: 2 Days 14 Hours", prices and picture on the Store screen, but FC 27's store data doesn't carry
// the name as text. The helper reads that visible text from the page the user is looking at (never clicks, never
// requests anything) and matches each tile to the store packs it captured by price and item count.
import type { PackOffer } from "./capture.js";

export interface StoreTile {
  name: string;
  description: string | null;
  coins: number | null;
  points: number | null;
  items: number | null;
  user_limit: number | null;
  /** Seconds until the pack leaves the store, from "Ending: 2 Days 14 Hours". */
  ends_in: number | null;
  untradeable: boolean;
  image_url: string | null;
}

const NUM = /^\d{1,3}(?:[,.\s]\d{3})*$|^\d+$/;
const num = (s: string) => Number(s.replace(/[,.\s]/g, ""));
const UNITS: Record<string, number> = { d: 86_400, day: 86_400, days: 86_400, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, s: 1, sec: 1, secs: 1, second: 1, seconds: 1 };

/** "2 Days 14 Hours", "5h 3m", "45 Minutes" → seconds. */
export function parseCountdown(text: string): number | null {
  let total = 0, hit = false;
  for (const m of text.matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
    const u = UNITS[m[2]!.toLowerCase()];
    if (u) { total += Number(m[1]) * u; hit = true; }
  }
  return hit && total > 0 && total < 400 * 86_400 ? total : null;
}

/**
 * One tile's visible text (innerText, one line per element) → what it says. The name is the first line that reads as
 * a pack title; prices are the bare numbers after the "Ending"/"User limit" lines (coins first, FC Points second).
 */
export function parseStoreTile(text: string, image_url: string | null = null): StoreTile | null {
  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  // The title: the first short line naming a pack (skips ribbons like "NEW" and the stat labels)
  const name = lines.find((l) => l.length <= 80 && /\b(?:pack|pick|bundle|offer)\b/i.test(l) && !NUM.test(l) && !/^(?:mixed|players?|items|min\.? players|user limit|ending|ends|includes|contains)\b/i.test(l));
  if (!name) return null;
  const description = lines.find((l) => /^(?:includes|contains)\b/i.test(l) || l.length > 60 && l !== name) ?? null;
  const limit = lines.map((l) => l.match(/user limit:?\s*(\d+)/i)).find(Boolean);
  const ending = lines.find((l) => /^(?:ending|ends|ends in|time left|expires)\b/i.test(l));
  const ii = lines.findIndex((l) => /^items$/i.test(l));
  const items = ii > 0 && NUM.test(lines[ii - 1]!) ? num(lines[ii - 1]!) : null;
  // Prices: bare numbers after the last info line (labels like "20 Items" come before the description)
  const after = Math.max(lines.findIndex((l) => l === ending), lines.findIndex((l) => /user limit/i.test(l)), lines.indexOf(description ?? "\u0000"), ii);
  const prices = lines.slice(after + 1).filter((l) => NUM.test(l)).map(num).filter((n) => n > 0 && n < 100_000_000);
  if (!prices.length) return null;
  return {
    name, description: description && description !== name ? description.slice(0, 400) : null,
    coins: prices[0] ?? null, points: prices[1] ?? null, items,
    user_limit: limit ? Number(limit[1]) : null,
    ends_in: ending ? parseCountdown(ending) : null,
    untradeable: /untradeable/i.test(description ?? ""),
    image_url,
  };
}

/** A stable id for a tile with no matching captured pack (never clashes with EA's ids, which are far smaller). */
export function tileId(name: string): number {
  let h = 2166136261;
  for (const c of name.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return 900_000_000_000 + h;
}

/**
 * Put what the tiles say onto the captured packs: name, description, end time, limit and picture. A tile matches the
 * pack with the same coin price (and FC Points and item count when both are known). Tiles with no captured pack are
 * kept as packs of their own (no odds), so the live store still shows.
 */
export function applyTiles<T extends PackOffer & { seen_at: string }>(packs: T[], tiles: StoreTile[], now: number): (T | (PackOffer & { seen_at: string }))[] {
  const out: (T | (PackOffer & { seen_at: string }))[] = [...packs];
  const used = new Set<number>();
  const seen_at = new Date(now).toISOString();
  for (const t of tiles) {
    const fits = (p: PackOffer) => !used.has(p.pack_id) && p.pack_id < 900_000_000_000
      && (t.coins != null && (p.coins === t.coins || (p.coins == null && p.points === t.coins)))
      && (t.points == null || p.points == null || p.points === t.points)
      && (t.items == null || p.item_count == null || p.item_count === t.items);
    let i = out.findIndex((p) => fits(p) && p.name === t.name);
    if (i < 0) i = out.findIndex(fits);
    if (i < 0) i = out.findIndex((p) => p.pack_id === tileId(t.name));
    const end_at = t.ends_in ? new Date(now + t.ends_in * 1000).toISOString() : null;
    if (i >= 0) {
      const p = out[i]!;
      used.add(p.pack_id);
      out[i] = {
        ...p, name: t.name, description: t.description ?? p.description, end_at: p.end_at ?? end_at,
        purchase_limit: p.purchase_limit ?? t.user_limit, image_url: p.image_url ?? t.image_url,
        item_count: p.item_count ?? t.items, untradeable: p.untradeable || t.untradeable,
        // On screen now, so live now; a tile-only pack takes the tile's (fresher) countdown
        seen_at, shown_at: seen_at, ...(p.pack_id >= 900_000_000_000 ? { end_at: end_at ?? p.end_at } : {}),
      };
    } else {
      out.push({
        pack_id: tileId(t.name), name: t.name, name_key: null, description: t.description, state: null, pack_type: null,
        coins: t.coins, points: t.points, untradeable: t.untradeable, is_player_pick: /pick/i.test(t.description ?? ""),
        item_count: t.items, gold: null, silver: null, bronze: null, rare: null, content_type: null,
        start_at: null, end_at, purchase_limit: t.user_limit, purchase_count: null, unopened: false, odds: [],
        asset_id: null, image_url: t.image_url, seen_at, shown_at: seen_at,
      });
    }
  }
  // A tile-only pack whose name a captured pack now carries is the same pack: drop the copy
  const realNames = new Set(out.filter((p) => p.pack_id < 900_000_000_000 && p.name).map((p) => p.name));
  return out.filter((p) => p.pack_id < 900_000_000_000 || !realNames.has(p.name));
}
