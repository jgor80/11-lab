import type { CaptureRow } from "../../src/market/capture.js";
import type { ClubItem, ClubNames } from "../../src/club/capture.js";

export interface Stored {
  rows?: CaptureRow[];
  /** Your club and squad items, newest copy of each. */
  club?: ClubItem[];
  last_club?: string;
  names?: ClubNames;
  platform?: "console" | "pc";
  paused?: boolean;
  last_capture?: string;
  /** Price check: searches run today (UTC day), and the runner's last status. */
  pc_day?: string;
  pc_count?: number;
  pc_running?: boolean;
  pc_stopped?: string | null;
  pc_learned?: boolean;
  pc_note?: string | null;
  pc_at?: string;
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

export const emptyNames = (): ClubNames => ({ players: {}, teams: {}, leagues: {}, nations: {} });

export function mergeNames(have: ClubNames | undefined, add: Partial<ClubNames>): ClubNames {
  const h = have ?? emptyNames();
  return {
    players: { ...h.players, ...(add.players ?? {}) },
    teams: { ...h.teams, ...(add.teams ?? {}) },
    leagues: { ...h.leagues, ...(add.leagues ?? {}) },
    nations: { ...h.nations, ...(add.nations ?? {}) },
  };
}
