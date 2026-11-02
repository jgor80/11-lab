// Passive price capture (Jeff's choice, 2026-11-02): the XI Lab browser helper reads ONLY the transfer-market
// search results the EA Web App has already downloaded because the user searched. It never sends a request,
// clicks, bids or lists. This module is the pure part: which responses count, and how a page of listings
// becomes one observation per item. The response shape follows the Web App's public behaviour as of FC 26
// (auctionInfo[].itemData / buyNowPrice) and is checked defensively; anything unexpected is skipped, not guessed.

export interface CaptureRow {
  /** EA's item (resource) id: matches player_cards.ea_item_id for cards from the ratings feed. */
  ea_item_id: number;
  /** EA's asset id (the footballer); used only as a fallback match together with the rating. */
  asset_id: number | null;
  rating: number | null;
  platform: "console" | "pc";
  /** Lowest Buy Now price among the active listings on this results page. */
  price: number;
  /** How many active listings with a Buy Now price that page held for this item. */
  listings: number;
  observed_at: string;
}

export const CAPTURE_CSV_HEADER = "ea_item_id,asset_id,rating,platform,price,observed_at,kind,listings";

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

/** One row per item on the page: the lowest active Buy Now price and how many listings it was the lowest of. */
export function summarizeSearch(json: unknown, opts: { observed_at: string; platform: "console" | "pc" }): CaptureRow[] {
  const list = (json as { auctionInfo?: unknown })?.auctionInfo;
  if (!Array.isArray(list)) return [];
  const by = new Map<number, CaptureRow>();
  for (const a of list as Record<string, unknown>[]) {
    if (!a || typeof a !== "object") continue;
    if (a.tradeState !== undefined && a.tradeState !== "active") continue;
    const item = a.itemData as Record<string, unknown> | undefined;
    if (!item || (item.itemType !== undefined && item.itemType !== "player")) continue;
    const id = int(item.resourceId);
    const bin = int(a.buyNowPrice);
    if (!id || !bin) continue;
    const cur = by.get(id);
    if (cur) {
      cur.listings++;
      cur.price = Math.min(cur.price, bin);
    } else {
      by.set(id, { ea_item_id: id, asset_id: int(item.assetId), rating: int(item.rating), platform: opts.platform, price: bin, listings: 1, observed_at: opts.observed_at });
    }
  }
  return [...by.values()];
}

/** CSV the Market Lab importer reads (web Import screen, `npm run market -- import`, Gaffer Bot import route). */
export function captureRowsToCsv(rows: CaptureRow[]): string {
  return [CAPTURE_CSV_HEADER, ...rows.map((r) => [r.ea_item_id, r.asset_id ?? "", r.rating ?? "", r.platform, r.price, r.observed_at, "lowest_bin", r.listings].join(","))].join("\n");
}
