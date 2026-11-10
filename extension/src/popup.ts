import { captureRowsToCsv } from "../../src/market/capture.js";
import { buildClubExport } from "../../src/club/capture.js";
import { emptyNames } from "./store.js";
import { looksLikeHelperKey } from "../../src/market/upload.js";
import { dailyCapFor, inCooldown, searchBudget } from "../../src/market/pricecheck.js";
import type { Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function refresh() {
  chrome.storage.local.get(["helper_key", "last_upload", "upload_note", "rows", "platform", "paused", "last_capture", "club", "last_club", "pc_day", "pc_count", "pc_running", "pc_stopped", "pc_learned", "pc_note", "pc_auto", "pc_first_day", "pc_log", "pc_cooldown_until", "packs", "pulls", "last_store", "account", "last_account", "store_seen", "images"], (s: Stored) => {
    const today = new Date().toISOString().slice(0, 10);
    $("gb-status").textContent = s.helper_key
      ? `Connected (key ending ${s.helper_key.slice(-4)}). ${s.last_upload ? `Last upload ${new Date(s.last_upload).toLocaleString()}.` : "Nothing uploaded yet."} ${s.upload_note ?? ""}`.trim()
      : `Not connected. Prices stay in this browser until you export them. ${s.upload_note ?? ""}`.trim();
    $<HTMLButtonElement>("gb-now").disabled = !s.helper_key;
    $<HTMLButtonElement>("gb-forget").disabled = !s.helper_key;
    const now = new Date();
    $("pc-count").textContent = String(s.pc_day === today ? s.pc_count ?? 0 : 0);
    $("pc-cap").textContent = `of ${dailyCapFor(s.pc_first_day, now)} searches used today`;
    const b = searchBudget(s.pc_log, now);
    $("pc-budget").textContent = `Last hour ${b.h1} · 3 hours ${b.h3} · 24 hours ${b.h24}` + (inCooldown(s.pc_cooldown_until, now) ? ` · paused until ${new Date(s.pc_cooldown_until!).toLocaleString()}` : "");
    $<HTMLInputElement>("pc-auto").checked = !!s.pc_auto;
    $("pc-status").textContent = s.pc_running ? `Running… ${s.pc_note ?? ""}`.trim() : s.pc_stopped ?? (s.pc_learned ? "Ready. Press Start." : "Run one search yourself first, then press Start.");
    $<HTMLButtonElement>("pc-start").disabled = !!s.pc_running;
    $("count").textContent = String(s.rows?.length ?? 0);
    $("pack-count").textContent = String(s.packs?.length ?? 0);
    $("pull-count").textContent = String(s.pulls?.length ?? 0);
    const seen = s.store_seen ?? [];
    $("pack-last").textContent = s.last_store ? `Last store capture ${new Date(s.last_store).toLocaleString()}`
      : seen.length ? `Saw ${seen.length} store answer${seen.length === 1 ? "" : "s"} but read no packs from them yet (shown on Pack Advisor).`
      : "Open the Store in the Web App to capture its packs and odds. Nothing from the Store seen yet.";
    $("pack-seen").textContent = seen.length ? seen.slice(0, 6).map((x) => `${x.path}: ${x.packs} packs, ${x.odds} odds`).join(" · ") : "";
    const a = s.account;
    const n = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString());
    $("acc-coins").textContent = n(a?.balance?.data.coins);
    $("acc-points").textContent = n(a?.balance?.data.points);
    const listed = a?.tradepile?.data.filter((t) => t.state === "listed").length, sold = a?.tradepile?.data.filter((t) => t.state === "sold").length;
    $("acc-piles").textContent = a ? [
      a.tradepile ? `Transfer list ${a.tradepile.data.length} (${listed} listed, ${sold} sold)` : null,
      a.watchlist ? `Watchlist ${a.watchlist.data.length}` : null,
      a.unassigned ? `Unassigned ${a.unassigned.data.length}` : null,
      a.sbcs ? `${a.sbcs.data.length} SBCs` : null,
      a.objectives ? `${a.objectives.data.length} objectives` : null,
    ].filter(Boolean).join(" · ") : "";
    $("acc-last").textContent = s.last_account ? `Last account capture ${new Date(s.last_account).toLocaleString()}` : "Sign in to the Web App to capture your balance and piles.";
    $("art-count").textContent = String(s.images?.length ?? 0);
    $("club-count").textContent = String(s.club?.length ?? 0);
    $("club-last").textContent = s.last_club ? `Last club capture ${new Date(s.last_club).toLocaleString()}` : "Open your Club in the Web App to capture it.";
    $("last").textContent = s.last_capture ? `Last capture ${new Date(s.last_capture).toLocaleString()}` : "No captures yet.";
    $<HTMLSelectElement>("platform").value = s.platform ?? "console";
    $<HTMLInputElement>("paused").checked = !!s.paused;
  });
}
const csv = (cb: (text: string) => void) => chrome.storage.local.get(["rows"], (s: Stored) => cb(captureRowsToCsv(s.rows ?? [])));

$("gb-save").addEventListener("click", () => {
  const key = $<HTMLInputElement>("gb-key").value.trim();
  if (!looksLikeHelperKey(key)) return void ($("gb-status").textContent = "That isn't a helper key. Copy it from Market Lab > Import prices > Connect helper.");
  $<HTMLInputElement>("gb-key").value = "";
  // A new key starts a fresh upload: everything stored is sent once (the server skips duplicates).
  chrome.storage.local.set({ helper_key: key, sent_until: "", club_sent: "", upload_note: "Saved. Uploading…" }, () => chrome.runtime.sendMessage({ upload: "now" }, () => void chrome.runtime.lastError));
});
$("gb-now").addEventListener("click", () => {
  $("gb-status").textContent = "Uploading…";
  chrome.runtime.sendMessage({ upload: "now" }, () => { void chrome.runtime.lastError; refresh(); });
});
$("gb-forget").addEventListener("click", () => {
  if (confirm("Disconnect Gaffer Bot? Nothing more is uploaded. (Turn the key off on gafferbot.app too if you won't use it again.)")) chrome.storage.local.set({ helper_key: null, upload_note: "" }, refresh);
});
$("platform").addEventListener("change", (e) => chrome.storage.local.set({ platform: (e.target as HTMLSelectElement).value }));
$("paused").addEventListener("change", (e) => chrome.storage.local.set({ paused: (e.target as HTMLInputElement).checked }));
$("download").addEventListener("click", () =>
  csv((text) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `xilab-captures-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
    a.click();
  }),
);
$("copy").addEventListener("click", () => csv((text) => navigator.clipboard.writeText(text).then(() => ($("last").textContent = "Copied."))));
$("club-download").addEventListener("click", () =>
  chrome.storage.local.get(["club", "names"], (s: Stored) => {
    const text = JSON.stringify(buildClubExport(s.club ?? [], s.names ?? emptyNames()));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = `xilab-club-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
  }),
);
$("art-copy").addEventListener("click", () =>
  chrome.storage.local.get(["images"], (s: Stored) => navigator.clipboard.writeText((s.images ?? []).map((x) => x.url).join("\n")).then(() => ($("art-note").textContent = "Copied."))));
$("acc-clear").addEventListener("click", () => {
  if (confirm("Delete the stored account capture? The helper copies it again next time the Web App loads it.")) chrome.storage.local.set({ account: {}, last_account: "" }, refresh);
});
$("club-clear").addEventListener("click", () => {
  if (confirm("Delete the stored club capture? Export first if you need it.")) chrome.storage.local.set({ club: [] }, refresh);
});
$("clear").addEventListener("click", () => {
  if (confirm("Delete all stored captures? Export first if you need them.")) chrome.storage.local.set({ rows: [] }, refresh);
});
function toTab(msg: { pc: string }, done?: (r: { ok: boolean; error?: string; queued?: number } | undefined) => void) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs: { id?: number; url?: string }[]) => {
    const tab = tabs[0];
    if (!tab?.id) return done?.({ ok: false, error: "Open the EA Web App tab first." });
    chrome.tabs.sendMessage(tab.id, msg, (r: { ok: boolean; error?: string; queued?: number } | undefined) => {
      if (chrome.runtime.lastError || !r) return done?.({ ok: false, error: "Open the EA Web App tab and press Start there." });
      done?.(r);
    });
  });
}
$("pc-start").addEventListener("click", () => {
  if (!confirm("Start the slow price check? It runs searches for your own cards in this tab. It never bids or buys, but automatic searching carries some account risk.")) return;
  toTab({ pc: "start" }, (r) => { $("pc-status").textContent = r?.ok ? `Started: ${r.queued} cards queued.` : r?.error ?? "Couldn't start."; });
});
$("pc-stop").addEventListener("click", () => { chrome.storage.local.set({ pc_auto: false }); toTab({ pc: "stop" }); });
$("pc-auto").addEventListener("change", (e) => {
  const box = e.target as HTMLInputElement;
  if (box.checked && !confirm("Run the price check automatically? While the Web App tab is open and signed in, it searches your own cards within the caps, with no button press. It never bids or buys, but automatic searching carries some account risk.")) return void (box.checked = false);
  chrome.storage.local.set({ pc_auto: box.checked });
});
toTab({ pc: "ping" });
chrome.storage.onChanged.addListener(refresh);
refresh();
