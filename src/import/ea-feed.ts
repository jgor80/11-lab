// Shared helpers for EA's FC 27 ratings feed: the JSON behind https://www.ea.com/games/ea-sports-fc/ratings.
// Undocumented and unlicensed: Jeff approved pulling it on 2026-11-02. Snapshots stay out of git.

export const EA_FEED_URL = "https://drop-api.ea.com/rating/ea-sports-fc";

export interface FeedPage {
  items: unknown[];
  total?: number;
}

/** Pulls the item list and total count out of one feed response, or explains what it found instead. */
export function extractPage(json: unknown): FeedPage {
  if (Array.isArray(json)) return { items: json };
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const inner = (o.data && typeof o.data === "object" ? o.data : o) as Record<string, unknown>;
    const items = inner.items ?? inner.players ?? inner.results;
    if (Array.isArray(items)) {
      const total = [inner.totalItems, inner.total, inner.count, inner.totalCount].find((v) => typeof v === "number") as
        | number
        | undefined;
      return { items, total };
    }
    throw new Error(`Unexpected feed response: no item list. Top-level keys: ${Object.keys(o).join(", ")}`);
  }
  throw new Error(`Unexpected feed response of type ${typeof json}`);
}

export interface SnapshotManifest {
  source: "ea-ratings-site";
  /** Game edition the snapshot was requested for, e.g. 'FC27'. Becomes player_cards.season. */
  edition: string;
  url: string;
  locale: string;
  page_size: number;
  started_at: string;
  finished_at?: string;
  complete: boolean;
  total_reported?: number;
  total_items: number;
  pages: { file: string; offset: number; count: number; sha256: string }[];
}
