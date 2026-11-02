// Extension side (isolated world): receives summaries from hook.ts and keeps them in the extension's own
// storage until you export them. Nothing is sent anywhere.
import { mergeClubItems } from "../../src/club/capture.js";
import { mergeNames, mergeRows, type Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !e.data || e.data["xilab-capture"] !== true) return;
  const d = e.data;
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
