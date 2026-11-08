// Passive price capture (Jeff's choice, 2026-11-02): the XI Lab browser helper reads ONLY the transfer-market
// search results the EA Web App has already downloaded because the user searched. It never sends a request,
// clicks, bids or lists. This module is the pure part: which responses count, and how a page of listings
// becomes one observation per item. The response shape (auctionInfo[].itemData / buyNowPrice) was verified on
// FC 27 traffic on 2026-11-08 (docs/web-app-endpoints.md) and is still checked defensively; anything unexpected is
// skipped, not guessed.

export interface CaptureRow {
  /** EA's item (resource) id: matches player_cards.ea_item_id for cards from the ratings feed. */
  ea_item_id: number;
  /** EA's asset id (the footballer); used only as a fallback match together with the rating. */
  asset_id: number | null;
  rating: number | null;
  platform: "console" | "pc";
  /** Lowest believable Buy Now price among the active listings on this results page (see lowestBelievable). */
  price: number;
  /** How many active listings with a Buy Now price that page held for this item. */
  listings: number;
  observed_at: string;
  /** EA's own ids for the item, kept so a capture for a card XI Lab doesn't have yet can be identified later. */
  details?: CaptureDetails;
  /**
   * itemData.marketAverage: one EA number per card version, the same on every listing (docs/web-app-endpoints.md).
   * Looks like a smoothed average sale price; what it measures is UNCONFIRMED. Null when absent or 0.
   */
  market_average?: number | null;
  /** itemData.lastSalePrice of the listings on the page that have sold before (non-zero only, at most 20). */
  last_sales?: number[];
}

/** EA ids as the Web App sends them (not names). rare_flag 0/1 = common/rare base; higher = a special version. */
export interface CaptureDetails {
  rare_flag?: number;
  team_id?: number;
  league_id?: number;
  nation_id?: number;
  position?: string;
}

export const CAPTURE_CSV_HEADER = "ea_item_id,asset_id,rating,platform,price,observed_at,kind,listings,rare_flag,team_id,league_id,nation_id,position,market_average,last_sales";
/** Most past-sale prices kept per item per page. */
export const MAX_LAST_SALES = 20;
export const CAPTURE_DETAIL_FIELDS = ["rare_flag", "team_id", "league_id", "nation_id", "position"] as const;

/** Transfer-market SEARCH responses only (not your trade pile, watch list or unassigned items). */
export function isTransferMarketSearch(url: string): boolean {
  try {
    const u = new URL(url, "https://example.invalid");
    return /\/ut\/game\/fc\d+\/transfermarket$/i.test(u.pathname);
  } catch {
    return false;
  }
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const nonNeg = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);

function detailsOf(item: Record<string, unknown>): CaptureDetails | undefined {
  const pos = typeof item.preferredPosition === "string" && /^[A-Z]{2,3}$/.test(item.preferredPosition) ? item.preferredPosition : undefined;
  const d: CaptureDetails = { rare_flag: nonNeg(item.rareflag), team_id: int(item.teamid) ?? undefined, league_id: int(item.leagueId) ?? undefined, nation_id: int(item.nation) ?? undefined, position: pos };
  const kept = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as CaptureDetails;
  return Object.keys(kept).length ? kept : undefined;
}

/** Details parsed back from an imported capture CSV row. */
export function captureDetailsFromRow(r: Record<string, unknown>): CaptureDetails | undefined {
  const n = (v: unknown) => (v === undefined || v === null || v === "" || !Number.isInteger(Number(v)) || Number(v) < 0 ? undefined : Number(v));
  const pos = typeof r.position === "string" && /^[A-Z]{2,3}$/.test(r.position.trim()) ? r.position.trim() : undefined;
  const d: CaptureDetails = { rare_flag: n(r.rare_flag), team_id: n(r.team_id), league_id: n(r.league_id), nation_id: n(r.nation_id), position: pos };
  const kept = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as CaptureDetails;
  return Object.keys(kept).length ? kept : undefined;
}

/** A lone listing under this share of the next few prices is treated as a possible coin transfer, not a price. */
export const LONE_LOW_FACTOR = 0.5;

/**
 * The lowest believable Buy Now among one item's listings. A single listing far below the next few (under half
 * their median) is often a coin transfer or a mistake, so with 3+ listings it is skipped; two or more low listings
 * confirm each other and count.
 */
export function lowestBelievable(bins: number[]): number {
  const s = [...bins].sort((a, b) => a - b);
  if (s.length < 3) return s[0]!;
  const next = s.slice(1, 4);
  const mid = next[Math.floor((next.length - 1) / 2)]!;
  return s[0]! < mid * LONE_LOW_FACTOR && s[1]! >= mid * LONE_LOW_FACTOR ? s[1]! : s[0]!;
}

/** One row per item on the page: the lowest believable active Buy Now price and how many listings it had. */
export function summarizeSearch(json: unknown, opts: { observed_at: string; platform: "console" | "pc" }): CaptureRow[] {
  const list = (json as { auctionInfo?: unknown })?.auctionInfo;
  if (!Array.isArray(list)) return [];
  const by = new Map<number, { row: CaptureRow; bins: number[]; avg: number | null; sales: number[] }>();
  for (const a of list as Record<string, unknown>[]) {
    if (!a || typeof a !== "object") continue;
    if (a.tradeState !== undefined && a.tradeState !== "active") continue;
    const item = a.itemData as Record<string, unknown> | undefined;
    if (!item || (item.itemType !== undefined && item.itemType !== "player")) continue;
    const id = int(item.resourceId);
    const bin = int(a.buyNowPrice);
    if (!id || !bin) continue;
    const avg = int(item.marketAverage);
    const sale = int(item.lastSalePrice);
    const cur = by.get(id);
    if (cur) {
      cur.bins.push(bin);
      if (!cur.avg && avg) cur.avg = avg;
      if (sale && cur.sales.length < MAX_LAST_SALES) cur.sales.push(sale);
    } else {
      const details = detailsOf(item);
      by.set(id, { bins: [bin], avg, sales: sale ? [sale] : [], row: { ea_item_id: id, asset_id: int(item.assetId), rating: int(item.rating), platform: opts.platform, price: bin, listings: 1, observed_at: opts.observed_at, ...(details ? { details } : {}) } });
    }
  }
  return [...by.values()].map(({ row, bins, avg, sales }) => ({
    ...row, price: lowestBelievable(bins), listings: bins.length,
    ...(avg ? { market_average: avg } : {}), ...(sales.length ? { last_sales: sales } : {}),
  }));
}

/** CSV the Market Lab importer reads (web Import screen, `npm run market -- import`, Gaffer Bot import route). */
export function captureRowsToCsv(rows: CaptureRow[]): string {
  return [
    CAPTURE_CSV_HEADER,
    ...rows.map((r) => [r.ea_item_id, r.asset_id ?? "", r.rating ?? "", r.platform, r.price, r.observed_at, "lowest_bin", r.listings, ...CAPTURE_DETAIL_FIELDS.map((k) => r.details?.[k] ?? ""), r.market_average ?? "", (r.last_sales ?? []).join(";")].join(",")),
  ].join("\n");
}
