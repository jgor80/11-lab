// Extension side (isolated world): receives summaries from hook.ts and keeps them in the extension's own
// storage until you export them. Nothing is sent anywhere.
import { mergeClubItems } from "../../src/club/capture.js";
import { buildQueue, remainingToday } from "../../src/market/pricecheck.js";
import { mergeNames, mergeRows, type Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !e.data || e.data["xilab-capture"] !== true) return;
  const d = e.data;
  if (d.pc && typeof d.pc === "object") {
    chrome.storage.local.get(["pc_day", "pc_count"], (s: Stored) => {
      const day = new Date().toISOString().slice(0, 10);
      const patch: Record<string, unknown> = { pc_at: new Date().toISOString() };
      if (d.pc.searched) {
        patch.pc_day = day;
        patch.pc_count = (s.pc_day === day ? s.pc_count ?? 0 : 0) + 1;
      }
      for (const k of ["running", "stopped", "learned", "note"]) if (k in d.pc) patch[`pc_${k}`] = d.pc[k];
      chrome.storage.local.set(patch);
    });
    return;
  }
  chrome.storage.local.get(["rows", "platform", "paused", "club", "names"], (s: Stored) => {
    if (s.paused) return;
    const now = new Date().toISOString();
    if (Array.isArray(d.rows)) {
      const rows = d.rows.map((r: Record<string, unknown>) => ({ ...r, platform: s.platform === "pc" ? "pc" : "console" }));
      chrome.storage.local.set({ rows: mergeRows(s.rows ?? [], rows), last_capture: now });
    }
    if (Array.isArray(d.club)) chrome.storage.local.set({ club: mergeClubItems(s.club ?? [], d.club), last_club: now });
    if (d.names && typeof d.names === "object") chrome.storage.local.set({ names: mergeNames(s.names, d.names) });
  });
});

// Start/Stop from the popup. The queue is your own club players without a recent price, within today's cap.
chrome.runtime.onMessage.addListener((msg: { pc?: string }, _sender: unknown, reply: (r: unknown) => void) => {
  if (msg?.pc === "stop") {
    window.postMessage({ "xilab-cmd": "pc-stop" }, window.location.origin);
    reply({ ok: true });
  } else if (msg?.pc === "start") {
    chrome.storage.local.get(["rows", "club", "pc_day", "pc_count", "paused"], (s: Stored) => {
      if (s.paused) return reply({ ok: false, error: "Capture is paused. Untick Pause first." });
      const now = new Date();
      const items = buildQueue(s.club ?? [], s.rows ?? [], now, remainingToday(s.pc_day, s.pc_count, now))
        .map((i) => ({ ea_item_id: i.ea_item_id, asset_id: i.asset_id }));
      if (!items.length) return reply({ ok: false, error: (s.club ?? []).length ? "Nothing to check: today's cap is used or every card has a fresh price." : "Capture your club first (open Club > Players)." });
      window.postMessage({ "xilab-cmd": "pc-start", items }, window.location.origin);
      reply({ ok: true, queued: items.length });
    });
    return true;
  } else if (msg?.pc === "ping") {
    window.postMessage({ "xilab-cmd": "pc-ping" }, window.location.origin);
    reply({ ok: true });
  }
  return false;
});
