// Auto-upload (Jeff, 2026-11-02): once the user pastes a Gaffer Bot helper key into the XI Lab helper, the helper
// sends what it has captured (prices, club) to the user's own XI Lab account on gafferbot.app, so there's no CSV to
// download and import. It only forwards what it already recorded; it never sends anything extra to EA.
// This module is the pure part: what is due to upload, and how an answer updates the helper's state.
import type { CaptureRow } from "./capture.js";

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
