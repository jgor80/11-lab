// Extension side (isolated world): receives summaries from hook.ts and keeps them in the extension's own
// storage until you export them. Nothing is sent anywhere.
import { mergeRows, type Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !e.data || e.data["xilab-capture"] !== true || !Array.isArray(e.data.rows)) return;
  chrome.storage.local.get(["rows", "platform", "paused"], (s: Stored) => {
    if (s.paused) return;
    const rows = e.data.rows.map((r: Record<string, unknown>) => ({ ...r, platform: s.platform === "pc" ? "pc" : "console" }));
    chrome.storage.local.set({ rows: mergeRows(s.rows ?? [], rows), last_capture: new Date().toISOString() });
  });
});
