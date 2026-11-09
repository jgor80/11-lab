import { MAX_LAST_SALES, type CaptureRow } from "../../src/market/capture.js";
import type { ClubItem, ClubNames } from "../../src/club/capture.js";
import type { PackOffer, PackPull, StoreCapture } from "../../src/store/capture.js";

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
  /** Run the price check by itself while the Web App is open (opt-in). */
  pc_auto?: boolean;
  /** First UTC day the price check searched (the daily cap ramps up from it). */
  pc_first_day?: string;
  /** Search times in the last 24 hours. */
  pc_log?: string[];
  /** No searches until then (set after EA throttles or asks for a captcha). */
  pc_cooldown_until?: string | null;
  /** Pack store: the packs last seen in the Store (newest copy each), the Web App's store strings, field names seen. */
  packs?: (PackOffer & { seen_at: string })[];
  store_names?: Record<string, string>;
  store_shape?: StoreCapture["shape"];
  last_store?: string;
  store_sent?: string;
  /** Items from packs the user opened, and the opened_at of the newest one uploaded. */
  pulls?: PackPull[];
  pulls_sent_until?: string;
  last_pull?: string;
  /** Auto-upload to gafferbot.app: the helper key, and what was last sent. */
  helper_key?: string | null;
  sent_until?: string;
  club_sent?: string;
  last_upload?: string;
  upload_note?: string;
}

export const MAX_ROWS = 20_000;

/** Same item, platform and minute = one observation (the Web App often re-fetches a page). Keeps the newest MAX_ROWS. */
export function mergeRows(have: CaptureRow[], add: CaptureRow[]): CaptureRow[] {
  const key = (r: CaptureRow) => `${r.ea_item_id}|${r.platform}|${r.observed_at.slice(0, 16)}`;
  const m = new Map(have.map((r) => [key(r), r]));
  for (const r of add) {
    const k = key(r);
    const prev = m.get(k);
    m.set(k, prev ? {
      ...prev, price: Math.min(prev.price, r.price), listings: Math.max(prev.listings, r.listings),
      ...(r.market_average ?? prev.market_average ? { market_average: r.market_average ?? prev.market_average } : {}),
      ...(prev.last_sales || r.last_sales ? { last_sales: [...(prev.last_sales ?? []), ...(r.last_sales ?? [])].slice(0, MAX_LAST_SALES) } : {}),
    } : r);
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
