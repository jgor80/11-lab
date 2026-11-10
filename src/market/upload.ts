// Auto-upload (Jeff, 2026-11-02): once the user pastes a Gaffer Bot helper key into the XI Lab helper, the helper
// sends what it has captured (prices, club) to the user's own XI Lab account on gafferbot.app, so there's no CSV to
// download and import. It only forwards what it already recorded; it never sends anything extra to EA.
// This module is the pure part: what is due to upload, and how an answer updates the helper's state.
import type { CaptureRow } from "./capture.js";
import type { PackOffer, PackPull, StoreCapture, StoreSeen } from "../store/capture.js";

export const GAFFERBOT_API = "https://gafferbot.app/api/functions/v1/fut-api/v1";
export const HELPER_KEY_PREFIX = "xlh_";
/** Rows per upload (the server takes up to 5,000 lines). */
export const UPLOAD_BATCH = 4000;
/** Regular upload interval while the browser is open. */
export const UPLOAD_EVERY_MINUTES = 5;

export const looksLikeHelperKey = (s: string) => s.startsWith(HELPER_KEY_PREFIX) && s.length >= 30 && s.length <= 80 && /^[A-Za-z0-9_-]+$/.test(s);

export interface UploadState {
  rows?: CaptureRow[];
  /** observed_at of the newest price row already uploaded. */
  sent_until?: string;
  last_club?: string;
  /** last_club value of the club copy last uploaded. */
  club_sent?: string;
  /** Pack store: when it was last captured and which capture was last uploaded. */
  last_store?: string;
  store_sent?: string;
  /** Pack pulls, and the opened_at of the newest one uploaded. */
  pulls?: PackPull[];
  pulls_sent_until?: string;
  /** Store answers seen (even ones nothing could be read from), and which sighting was last uploaded. */
  last_store_seen?: string;
  store_seen_sent?: string;
  /** Account capture: the newest section time, and the one last uploaded. */
  last_account?: string;
  account_sent?: string;
}

/** The account is uploaded whenever any section of it is newer than the last upload. */
export const accountDue = (s: UploadState) => !!s.last_account && s.last_account !== s.account_sent;

/** Pulls per upload. */
export const PULL_BATCH = 500;

/**
 * Store packs due (when the store changed since the last upload), pulls not uploaded yet, and whether new store
 * answers were seen (sent even with no packs, so Gaffer Bot can show which addresses the helper saw).
 */
export function packPlan(s: UploadState): { store: boolean; seen: boolean; pulls: PackPull[] } {
  const pulls = (s.pulls ?? []).filter((p) => !s.pulls_sent_until || p.opened_at > s.pulls_sent_until)
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at)).slice(0, PULL_BATCH);
  return { store: !!s.last_store && s.last_store !== s.store_sent, seen: !!s.last_store_seen && s.last_store_seen !== s.store_seen_sent, pulls };
}

/** The pack file sent to Gaffer Bot (POST /helper/packs). Packs are sent only when the store changed. */
export function buildStoreExport(packs: (PackOffer & { seen_at?: string })[], pulls: PackPull[], shape: StoreCapture["shape"] | null | undefined, platform: "console" | "pc", captured_at = new Date().toISOString(), seen: StoreSeen[] = []): StoreCapture & { platform: "console" | "pc" } {
  return {
    format: "xilab-store-capture", version: 1, verified: false, captured_at, platform,
    packs: packs.map(({ seen_at: _s, ...p }) => p), pulls,
    shape: { pack_keys: shape?.pack_keys ?? [], odds_keys: shape?.odds_keys ?? [], category_keys: shape?.category_keys ?? [], seen },
  };
}

/** Price rows not uploaded yet (oldest first, one batch), and whether the club changed since the last upload. */
export function uploadPlan(s: UploadState): { rows: CaptureRow[]; club: boolean } {
  const rows = (s.rows ?? []).filter((r) => !s.sent_until || r.observed_at > s.sent_until)
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at)).slice(0, UPLOAD_BATCH);
  return { rows, club: !!s.last_club && s.last_club !== s.club_sent };
}

/** What to show and whether to keep the key, from an upload answer. */
export function uploadOutcome(status: number, body: unknown): { ok: boolean; note: string; key_dead: boolean } {
  const msg = (body as { error?: unknown })?.error;
  if (status === 200) return { ok: true, note: "", key_dead: false };
  if (status === 401 || status === 403) return { ok: false, note: typeof msg === "string" ? msg : "Gaffer Bot refused the key. Make a new one in Market Lab > Import prices.", key_dead: true };
  if (status === 429) return { ok: false, note: "Gaffer Bot is busy. Trying again later.", key_dead: false };
  return { ok: false, note: typeof msg === "string" ? `Upload failed: ${msg}` : `Upload failed (${status}). Trying again later.`, key_dead: false };
}
