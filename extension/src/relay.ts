// Extension side (isolated world): receives summaries from hook.ts and keeps them in the extension's own
// storage. Nothing is sent anywhere unless you connect Gaffer Bot; then background.ts uploads them to your account.
import { mergeClubItems } from "../../src/club/capture.js";
import { mergeOdds, mergePacks, mergePulls, mergeSeen, nameStoredPacks } from "../../src/store/capture.js";
import { accountStamp, mergeAccount } from "../../src/account/capture.js";
import { mergeImages } from "../../src/images/capture.js";
import { buildQueue, cooldownUntil, COOLDOWN_HOURS, inCooldown, pruneLog, runLimit } from "../../src/market/pricecheck.js";
import { mergeNames, mergeRows, type Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !e.data || e.data["xilab-capture"] !== true) return;
  const d = e.data;
  if (d.pc && typeof d.pc === "object") {
    chrome.storage.local.get(["pc_day", "pc_count", "pc_log", "pc_first_day"], (s: Stored) => {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const patch: Record<string, unknown> = { pc_at: now.toISOString() };
      if (d.pc.searched) {
        patch.pc_day = day;
        patch.pc_count = (s.pc_day === day ? s.pc_count ?? 0 : 0) + 1;
        patch.pc_log = [...pruneLog(s.pc_log, now), now.toISOString()];
        if (!s.pc_first_day) patch.pc_first_day = day;
      }
      // EA limited or checked the account: no more searches (manual or automatic) for a day.
      if (d.pc.throttled) {
        patch.pc_cooldown_until = cooldownUntil(now);
        patch.pc_stopped = `${d.pc.stopped ?? "EA limited searches."} Paused for ${COOLDOWN_HOURS} hours.`;
      }
      for (const k of ["running", "stopped", "learned", "note"]) if (k in d.pc && !(k === "stopped" && d.pc.throttled)) patch[`pc_${k}`] = d.pc[k];
      chrome.storage.local.set(patch);
      if (d.pc.learned) setTimeout(autoStart, 15_000);
    });
    return;
  }
  chrome.storage.local.get(["rows", "platform", "paused", "club", "names", "packs", "pulls", "store_names", "account", "store_odds", "store_seen", "store_shape", "images"], (s: Stored) => {
    if (s.paused) return;
    const now = new Date().toISOString();
    if (Array.isArray(d.rows)) {
      const rows = d.rows.map((r: Record<string, unknown>) => ({ ...r, platform: s.platform === "pc" ? "pc" : "console" }));
      chrome.storage.local.set({ rows: mergeRows(s.rows ?? [], rows), last_capture: now });
    }
    if (Array.isArray(d.club)) chrome.storage.local.set({ club: mergeClubItems(s.club ?? [], d.club), last_club: now });
    if (d.names && typeof d.names === "object") chrome.storage.local.set({ names: mergeNames(s.names, d.names) });
    if (d.storeNames && typeof d.storeNames === "object") {
      const store_names = { ...(s.store_names ?? {}), ...d.storeNames };
      // Names can arrive after the store list: fill them in on the packs already stored.
      const packs = nameStoredPacks(s.packs ?? [], store_names);
      const named = packs.filter((p) => p.name).length > (s.packs ?? []).filter((p) => p.name).length;
      // Newly named packs count as a store change, so the names go up on the next upload.
      chrome.storage.local.set({ store_names, packs, ...(named ? { last_store: now } : {}) });
    }
    if (d.store && Array.isArray(d.store.packs)) {
      const named = nameStoredPacks(d.store.packs, s.store_names ?? {});
      const merged = mergeOdds(mergePacks(s.packs ?? [], named, now), s.store_odds, Array.isArray(d.store.odds) ? d.store.odds : []);
      const read = named.length > 0 || (Array.isArray(d.store.odds) && d.store.odds.length > 0);
      // The address and field names are kept even when nothing was read, and uploaded, so a miss can be seen on Gaffer Bot.
      chrome.storage.local.set({
        packs: merged.packs, store_odds: merged.held, store_shape: d.store.shape ?? s.store_shape ?? null,
        ...(d.store.seen ? { store_seen: mergeSeen(s.store_seen, d.store.seen) } : {}),
        ...(read ? { last_store: now } : {}), last_store_seen: now,
      });
    }
    if (Array.isArray(d.pulls)) chrome.storage.local.set({ pulls: mergePulls(s.pulls ?? [], d.pulls), last_pull: now });
    if (d.account && typeof d.account === "object") {
      const account = mergeAccount(s.account, d.account);
      chrome.storage.local.set({ account, last_account: accountStamp(account) ?? now });
    }
    // Card art addresses (never the images): sent to Gaffer Bot so it can learn EA's promo card art names.
    if (Array.isArray(d.images)) {
      const urls = d.images.filter((u: unknown): u is string => typeof u === "string" && u.length <= 400).slice(0, 200);
      const known = new Set((s.images ?? []).map((x) => x.url));
      const fresh = urls.some((u: string) => !known.has(u));
      chrome.storage.local.set({ images: mergeImages(s.images, urls, now), ...(fresh ? { last_images: now } : {}) });
      if (!fresh) return;
    }
    if (Array.isArray(d.rows) || Array.isArray(d.club) || d.store || Array.isArray(d.pulls) || d.account || Array.isArray(d.images)) {
      try { chrome.runtime.sendMessage({ upload: "soon" }, () => void chrome.runtime.lastError); } catch { /* extension reloaded */ }
    }
  });
});

/**
 * Queue your own club players without a recent price, limited by today's cap (ramping up for a new account) and the
 * rolling hourly cap, and hand them to the runner in the page. Refused during a cool-down.
 */
function startCheck(done: (r: { ok: boolean; error?: string; queued?: number }) => void) {
  chrome.storage.local.get(["rows", "club", "pc_day", "pc_count", "pc_first_day", "pc_log", "pc_cooldown_until", "paused"], (s: Stored) => {
    const now = new Date();
    if (s.paused) return done({ ok: false, error: "Capture is paused. Untick Pause first." });
    if (inCooldown(s.pc_cooldown_until, now)) return done({ ok: false, error: `Cooling down after an EA limit until ${new Date(s.pc_cooldown_until!).toLocaleString()}.` });
    const limit = runLimit({ day: s.pc_day, count: s.pc_count, firstDay: s.pc_first_day, log: s.pc_log }, now);
    const items = buildQueue(s.club ?? [], s.rows ?? [], now, limit).map((i) => ({ ea_item_id: i.ea_item_id, asset_id: i.asset_id }));
    if (!items.length) return done({ ok: false, error: (s.club ?? []).length ? "Nothing to check now: the hourly or daily cap is used, or every card has a fresh price." : "Capture your club first (open Club > Players)." });
    window.postMessage({ "xilab-cmd": "pc-start", items }, window.location.origin);
    done({ ok: true, queued: items.length });
  });
}

/** Run automatically (opt-in): start when this signed-in tab has learned a search and isn't already running. */
function autoStart() {
  chrome.storage.local.get(["pc_auto", "pc_running", "pc_learned"], (s: Stored) => {
    if (s.pc_auto && s.pc_learned && !s.pc_running) startCheck(() => undefined);
  });
}
// A fresh page has no runner going and hasn't learned a search yet.
chrome.storage.local.set({ pc_running: false, pc_learned: false });
setInterval(autoStart, 10 * 60_000);

// Start/Stop from the popup. The queue is your own club players without a recent price, within today's cap.
chrome.runtime.onMessage.addListener((msg: { pc?: string }, _sender: unknown, reply: (r: unknown) => void) => {
  if (msg?.pc === "stop") {
    window.postMessage({ "xilab-cmd": "pc-stop" }, window.location.origin);
    reply({ ok: true });
  } else if (msg?.pc === "start") {
    startCheck((r) => reply(r));
    return true;
  } else if (msg?.pc === "ping") {
    window.postMessage({ "xilab-cmd": "pc-ping" }, window.location.origin);
    reply({ ok: true });
  }
  return false;
});
