import type { CaptureRow } from "../../src/market/capture.js";

export interface Stored {
  rows?: CaptureRow[];
  platform?: "console" | "pc";
  paused?: boolean;
  last_capture?: string;
}

export const MAX_ROWS = 20_000;

/** Same item, platform and minute = one observation (the Web App often re-fetches a page). Keeps the newest MAX_ROWS. */
export function mergeRows(have: CaptureRow[], add: CaptureRow[]): CaptureRow[] {
  const key = (r: CaptureRow) => `${r.ea_item_id}|${r.platform}|${r.observed_at.slice(0, 16)}`;
  const m = new Map(have.map((r) => [key(r), r]));
  for (const r of add) {
    const k = key(r);
    const prev = m.get(k);
    m.set(k, prev ? { ...prev, price: Math.min(prev.price, r.price), listings: Math.max(prev.listings, r.listings) } : r);
  }
  return [...m.values()].sort((a, b) => a.observed_at.localeCompare(b.observed_at)).slice(-MAX_ROWS);
}
