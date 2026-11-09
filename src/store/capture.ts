// Passive pack store capture (Jeff, 2026-11-09): the XI Lab helper reads the pack store the EA Web App already
// downloaded because the user opened the Store, and the items a pack gave when the user opened one themselves.
// It never sends a request, buys, opens or claims anything. This module is the pure part.
//
// UNVERIFIED on FC 27: the store shape follows the Web App's `store/purchaseGroup/all?ppInfo=true&categoryInfo=true`
// answer as community clients read it on FC 26 (purchase[] with coins, points, packContentInfo, packOdds[] carrying
// oddsFormatted and a packOddsCategory with packOddsRules). Anything unexpected is skipped, never guessed, and the
// capture keeps the field names it saw (`shape`) so the first real capture can confirm or correct this.

export interface PackOdd {
  /** EA's own text for the line, e.g. "Player 84+ OVR" (category description), when it sent one. */
  label: string;
  /** The odds as EA showed them, e.g. "15%" or "<1%". */
  odds_text: string;
  /** 0..1, or null when the text couldn't be read. "<1%" counts as 0.5%. */
  probability: number | null;
  /** Lowest and highest rating this line covers, read from its rules or its label. */
  min_rating: number | null;
  max_rating: number | null;
  /** The line is about special cards (promo, Icon, Hero, TOTW and so on) rather than plain gold/silver/bronze. */
  special: boolean;
  /** EA's category ids, kept so the first real capture can be decoded. */
  category_id: number | null;
  tier_id: number | null;
  quality_id: number | null;
  rarity_asset_id: number | null;
  rules: { type: number; value: number; text?: string }[];
}

export interface PackOffer {
  pack_id: number;
  /** Display name (from the Web App's own strings when it loaded them), else EA's name key. */
  name: string | null;
  name_key: string | null;
  description: string | null;
  state: string | null;
  pack_type: string | null;
  /** Price in coins and in FC Points; null when the pack can't be bought that way. */
  coins: number | null;
  points: number | null;
  untradeable: boolean;
  is_player_pick: boolean;
  item_count: number | null;
  gold: number | null;
  silver: number | null;
  bronze: number | null;
  rare: number | null;
  content_type: string | null;
  /** ISO times; computed from seconds-until when EA sent those. */
  start_at: string | null;
  end_at: string | null;
  purchase_limit: number | null;
  purchase_count: number | null;
  /** The user already owns this pack unopened (My Packs). */
  unopened: boolean;
  odds: PackOdd[];
}

export interface PackPull {
  /** EA's item instance id (unique per copy). */
  item_id: number;
  ea_item_id: number;
  item_type: string | null;
  rating: number | null;
  rare_flag: number | null;
  untradeable: boolean;
  /** The pack the user opened just before (from the open request), when known. */
  pack_id: number | null;
  opened_at: string;
}

export interface StoreCapture {
  format: "xilab-store-capture";
  version: 1;
  verified: false;
  captured_at: string;
  packs: PackOffer[];
  pulls: PackPull[];
  /** Field names seen on store items and odds lines (no values), to check the shape against FC 27. */
  shape: { pack_keys: string[]; odds_keys: string[]; category_keys: string[] };
}

const path = (url: string) => {
  try {
    return new URL(url, "https://example.invalid").pathname;
  } catch {
    return "";
  }
};

/** The pack store list the Web App loads when you open the Store (and on sign-in in past seasons). */
export const isStoreResponse = (url: string) => /\/ut\/game\/fc\d+\/store\/purchaseGroup\/all$/i.test(path(url));
/** Buying/opening a pack from the store (the user's own click). Only its answer and body are read. */
export const isPackOpen = (url: string) => /\/ut\/game\/fc\d+\/store\/purchaseGroup\/cardpack$/i.test(path(url));
/** Opening a pack you already own (My Packs) in past seasons. */
export const isOwnedPackOpen = (url: string) => /\/ut\/game\/fc\d+\/purchased\/items\/\d+$/i.test(path(url));
/** The unassigned pile the Web App shows after a pack opens. */
export const isPurchasedItems = (url: string) => /\/ut\/game\/fc\d+\/purchased\/items$/i.test(path(url));

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,12}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const nonNeg = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** "15%", "<1%", "0.5 %", "1 in 20", "100" → 0..1. */
export function parseOdds(text: string): number | null {
  const t = text.replace(/,/g, ".").trim();
  let m = t.match(/^<\s*(\d+(?:\.\d+)?)\s*%$/);
  if (m) return Math.min(1, Number(m[1]) / 200);
  m = t.match(/^>?\s*(\d+(?:\.\d+)?)\s*%$/);
  if (m) return Math.min(1, Number(m[1]) / 100);
  m = t.match(/^1\s*(?:in|:|\/)\s*(\d+(?:\.\d+)?)$/i);
  if (m && Number(m[1]) >= 1) return 1 / Number(m[1]);
  m = t.match(/^(\d+(?:\.\d+)?)$/);
  if (m) {
    const n = Number(m[1]);
    return n <= 1 ? n : n <= 100 ? n / 100 : null;
  }
  return null;
}

const SPECIAL = /\b(special|promo|icon|hero|totw|team of the week|inform|in-form|evolution|toty|tots|future stars|road to|flashback|moments|champions|trailblazer|thunderstruck|fantasy|centurions|rttk|rttf|uwcl|uecl|uel)\b/i;

/** Ratings a line covers: rules first (a value in 40..99), then the label ("84+", "82-83", "83 OVR or higher"). */
function ratingRange(rules: PackOdd["rules"], label: string): [number | null, number | null] {
  const vals = rules.map((r) => r.value).filter((v) => v >= 40 && v <= 99).sort((a, b) => a - b);
  let m = label.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
  if (m) return [Number(m[1]), Number(m[2])];
  m = label.match(/\b(\d{2})\s*\+/) ?? label.match(/\b(\d{2})\s*(?:ovr|rated)?\s*(?:or (?:higher|above|more)|and (?:higher|above|up))/i) ?? label.match(/(?:rated|ovr)\s*(\d{2})\b/i);
  if (m) return [Number(m[1]), null];
  if (vals.length >= 2) return [vals[0]!, vals.at(-1)!];
  if (vals.length === 1) return [vals[0]!, null];
  return [null, null];
}

export function summarizeOdd(raw: unknown): PackOdd | null {
  const o = rec(raw);
  if (!o) return null;
  const odds_text = str(o.oddsFormatted, 40) ?? (typeof o.odds === "number" ? String(o.odds) : str(o.odds, 40));
  if (!odds_text) return null;
  const cat = rec(o.packOddsCategory) ?? rec(o.category);
  const rulesRaw = Array.isArray(cat?.packOddsRules) ? (cat!.packOddsRules as unknown[]) : Array.isArray(o.packOddsRules) ? (o.packOddsRules as unknown[]) : [];
  const rules = rulesRaw.map(rec).filter((r): r is Record<string, unknown> => !!r && typeof r.ruleValue === "number")
    .map((r) => ({ type: nonNeg(r.ruleType) ?? 0, value: r.ruleValue as number, ...(str(r.description) ? { text: str(r.description)! } : {}) }));
  const label = str(cat?.description) ?? str(o.description) ?? str(o.name) ?? rules.map((r) => r.text).filter(Boolean).join(", ") ?? "";
  const [min_rating, max_rating] = ratingRange(rules, `${label} ${rules.map((r) => r.text ?? "").join(" ")}`);
  const rarity_asset_id = nonNeg(cat?.rarityAssetId);
  return {
    label: label || `Category ${nonNeg(cat?.categoryId ?? o.categoryId) ?? "?"}`,
    odds_text, probability: parseOdds(odds_text), min_rating, max_rating,
    special: SPECIAL.test(label) || rules.some((r) => SPECIAL.test(r.text ?? "")),
    category_id: nonNeg(cat?.categoryId ?? o.categoryId), tier_id: nonNeg(cat?.tierId ?? o.tierId),
    quality_id: nonNeg(cat?.qualityId), rarity_asset_id, rules: rules.slice(0, 10),
  };
}

const iso = (v: unknown, now: number, kind: "epoch" | "seconds_from_now"): string | null => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (kind === "seconds_from_now") return v < 400 * 86_400 ? new Date(now + v * 1000).toISOString() : null;
  const ms = v > 1e12 ? v : v * 1000;
  return ms > Date.UTC(2020, 0, 1) && ms < Date.UTC(2040, 0, 1) ? new Date(ms).toISOString() : null;
};

function packsOf(json: unknown): Record<string, unknown>[] {
  const j = rec(json);
  if (!j) return [];
  // FC 26: { purchase: [...] }. Older seasons: { purchaseGroup: [{ packs|purchase: [...] }] }.
  const out: Record<string, unknown>[] = [];
  const add = (list: unknown) => Array.isArray(list) && list.forEach((p) => { const r = rec(p); if (r) out.push(r); });
  add(j.purchase);
  add(j.packs);
  if (Array.isArray(j.purchaseGroup)) for (const g of j.purchaseGroup) { add(rec(g)?.packs); add(rec(g)?.purchase); }
  return out;
}

export function summarizeStore(json: unknown, names: Record<string, string> = {}, now = Date.now()): PackOffer[] {
  const seen = new Set<number>();
  const out: PackOffer[] = [];
  for (const p of packsOf(json)) {
    const pack_id = int(p.id);
    if (!pack_id || seen.has(pack_id)) continue;
    // Packs only: bundles of points, cosmetics and the like have no card contents and no odds.
    const type = str(p.type, 40);
    const info = rec(p.packContentInfo);
    const odds = (Array.isArray(p.packOdds) ? p.packOdds : []).map(summarizeOdd).filter((o): o is PackOdd => !!o);
    if (type && !/pack/i.test(type) && !info && !odds.length) continue;
    seen.add(pack_id);
    const name_key = str(p.nameLoc) ?? str(p.name);
    const coinsFromCurrencies = Array.isArray(p.currencies)
      ? (p.currencies as unknown[]).map(rec).find((c) => c && /coin/i.test(String(c.name ?? "")))?.finalFunds
      : undefined;
    const pointsFromCurrencies = Array.isArray(p.currencies)
      ? (p.currencies as unknown[]).map(rec).find((c) => c && /point/i.test(String(c.name ?? "")))?.finalFunds
      : undefined;
    out.push({
      pack_id,
      name: (name_key && names[name_key]) ?? str(p.displayName) ?? null,
      name_key,
      description: (str(p.descriptionLoc) && names[str(p.descriptionLoc)!]) ?? str(p.description, 400),
      state: str(p.state, 40),
      pack_type: str(p.packType, 40) ?? type,
      coins: int(p.coins) ?? int(coinsFromCurrencies),
      points: int(p.points) ?? int(pointsFromCurrencies),
      untradeable: p.untradeable === true,
      is_player_pick: p.isPlayerPickPack === true,
      item_count: int(info?.itemQuantity) ?? int(p.quantity),
      gold: nonNeg(info?.goldQuantity), silver: nonNeg(info?.silverQuantity), bronze: nonNeg(info?.bronzeQuantity), rare: nonNeg(info?.rareQuantity),
      content_type: str(info?.contentType, 40),
      start_at: iso(p.secondsUntilStart, now, "seconds_from_now") ?? iso(p.start, now, "epoch"),
      end_at: iso(p.secondsUntilEnd, now, "seconds_from_now") ?? iso(p.end, now, "epoch"),
      purchase_limit: int(p.purchaseLimit), purchase_count: nonNeg(p.purchaseCount),
      unopened: p.unopened === true,
      odds,
    });
  }
  return out;
}

/** Field names (never values) on the first few packs and odds lines, to check the FC 27 shape. */
export function storeShape(json: unknown): StoreCapture["shape"] {
  const packs = packsOf(json).slice(0, 20);
  const keys = (list: (Record<string, unknown> | null | undefined)[]) => [...new Set(list.flatMap((r) => (r ? Object.keys(r) : [])))].sort().slice(0, 120);
  const odds = packs.flatMap((p) => (Array.isArray(p.packOdds) ? p.packOdds.slice(0, 5).map(rec) : []));
  return { pack_keys: keys(packs), odds_keys: keys(odds), category_keys: keys(odds.map((o) => rec(o?.packOddsCategory))) };
}

/** Localisation strings that look like store text (pack names and descriptions), capped. */
export function parseStoreStrings(json: unknown, max = 4000): Record<string, string> {
  const out: Record<string, string> = {};
  const j = rec(json);
  if (!j) return out;
  let n = 0;
  for (const [k, v] of Object.entries(j)) {
    if (n >= max) break;
    if (typeof v !== "string" || !v.trim() || v.length > 300) continue;
    if (!/pack|store/i.test(k)) continue;
    out[k] = v.trim();
    n++;
  }
  return out;
}

/** The pack id from the open request's body: {"packId":123,...}. */
export function packIdFromBody(body: unknown): number | null {
  if (typeof body !== "string") return null;
  const m = body.match(/"packId"\s*:\s*"?(\d{1,12})/);
  return m ? int(Number(m[1])) : null;
}

/** Items in an open-pack answer or the unassigned pile: { itemList|itemData: [...] }. */
export function summarizePulls(json: unknown, pack_id: number | null, opened_at: string): PackPull[] {
  const j = rec(json);
  if (!j) return [];
  const list = [j.itemList, j.itemData, j.items].find(Array.isArray) as unknown[] | undefined;
  const out: PackPull[] = [];
  for (const raw of list ?? []) {
    const it = rec(rec(raw)?.itemData) ?? rec(raw);
    if (!it) continue;
    const item_id = int(it.id), ea_item_id = int(it.resourceId);
    if (!item_id || !ea_item_id) continue;
    out.push({
      item_id, ea_item_id, item_type: str(it.itemType, 40),
      rating: typeof it.rating === "number" && it.rating >= 1 && it.rating <= 99 ? it.rating : null,
      rare_flag: nonNeg(it.rareflag), untradeable: it.untradeable === true, pack_id, opened_at,
    });
  }
  return out;
}

/** Newest copy of each pack wins; packs not seen for 14 days drop off. */
export function mergePacks(have: (PackOffer & { seen_at: string })[], add: PackOffer[], seen_at: string): (PackOffer & { seen_at: string })[] {
  const m = new Map(have.map((p) => [p.pack_id, p]));
  for (const p of add) m.set(p.pack_id, { ...p, seen_at });
  const cutoff = new Date(Date.parse(seen_at) - 14 * 86_400_000).toISOString();
  return [...m.values()].filter((p) => p.seen_at >= cutoff);
}

/** One row per item instance; keeps the newest 2,000. A later sighting keeps the pack id if it learned one. */
export function mergePulls(have: PackPull[], add: PackPull[]): PackPull[] {
  const m = new Map(have.map((p) => [p.item_id, p]));
  for (const p of add) {
    const prev = m.get(p.item_id);
    m.set(p.item_id, prev ? { ...prev, pack_id: prev.pack_id ?? p.pack_id } : p);
  }
  return [...m.values()].sort((a, b) => a.opened_at.localeCompare(b.opened_at)).slice(-2000);
}
