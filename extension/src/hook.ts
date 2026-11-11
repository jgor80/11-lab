// Runs in the Web App's own page (MAIN world). It wraps fetch and XMLHttpRequest ONLY to read a copy of
// responses the Web App already received: transfer-market searches (prices), your club and squad lists, the pack
// store and what packs you open gave you, your account (coins, FC Points, transfer list, watchlist, unassigned,
// SBCs, objectives, season progress), and the Web App's own name files. It never changes the Web App's requests.
// PRICE CHECK (Jeff's choice, 2026-11-02): when the user presses Start in the helper, it also runs slow GET searches
// for their own club cards, in this tab, using the search format and session headers of a search the user ran
// themselves. Only GET to the transfer-market search address (isSafeSearch); never bids, buys or lists. Headers
// stay in this page's memory and are never stored or sent anywhere else.
import { isTransferMarketSearch, summarizeSearch } from "../../src/market/capture.js";
import { delayBefore, isSafeSearch, isThrottle, learnTemplate, searchUrlFor, stopReason } from "../../src/market/pricecheck.js";
import { isClubResponse, isLocalisation, isPlayerNames, parseLocalisedNames, parsePlayerNames, summarizeClub } from "../../src/club/capture.js";
import { accountKind, readAccountResponse } from "../../src/account/capture.js";
import { cardArtUrl } from "../../src/images/capture.js";
import { parseStoreTile, type StoreTile } from "../../src/store/tiles.js";
import { isOwnedPackOpen, isPackOpen, isPurchasedItems, isStoreLike, packIdFromBody, parseStoreStrings, storeSeen, storeShape, summarizeOddsOnly, summarizePulls, summarizeStore } from "../../src/store/capture.js";

const TAG = "xilab-capture";
const wanted = (url: string, method = "GET") => accountKind(url, method) !== null || isTransferMarketSearch(url) || isClubResponse(url) !== null || isPlayerNames(url) || isLocalisation(url)
  || isStoreLike(url) || isPackOpen(url) || isOwnedPackOpen(url) || isPurchasedItems(url);

// The pack the user opened last (their own click), so the items that follow can be credited to it.
let lastOpen: { pack_id: number | null; at: number } | null = null;
const OPEN_WINDOW_MS = 120_000;
function noteRequest(url: string, method: string, body: unknown) {
  if (method.toUpperCase() !== "POST") return;
  if (isPackOpen(url)) lastOpen = { pack_id: packIdFromBody(body), at: Date.now() };
  else if (isOwnedPackOpen(url)) lastOpen = { pack_id: null, at: Date.now() };
}

function emit(url: string, json: unknown, method = "GET") {
  // Your account: balance, piles, SBCs, objectives. Read from answers the Web App loaded; it may also be a pack pull.
  const account = accountKind(url, method);
  if (account) {
    try {
      const patch = readAccountResponse(account, json, Date.now(), url);
      if (Object.keys(patch).length > 1) window.postMessage({ [TAG]: true, account: patch }, window.location.origin);
    } catch {
      /* never get in the Web App's way */
    }
  }
  // Pack store: the packs, prices and odds the Store screen already shows. Never buys or opens anything.
  // Any store, pack or odds answer is read the same way and logged by address (never values), so a miss shows up.
  if (isStoreLike(url)) {
    try {
      const packs = summarizeStore(json);
      const oddsOnly = packs.length ? null : summarizeOddsOnly(json, url);
      const seen = storeSeen(url, json, packs.length, packs.reduce((n, p) => n + p.odds.length, 0) + (oddsOnly?.odds.length ?? 0));
      window.postMessage({ [TAG]: true, store: { packs, shape: packs.length ? storeShape(json) : null, odds: oddsOnly ? [oddsOnly] : [], seen } }, window.location.origin);
    } catch {
      /* never get in the Web App's way */
    }
    return;
  }
  if (isPackOpen(url) || isOwnedPackOpen(url) || isPurchasedItems(url)) {
    if (!lastOpen || Date.now() - lastOpen.at > OPEN_WINDOW_MS) return; // sign-in loads the pile too: not a pull
    const pulls = summarizePulls(json, lastOpen.pack_id, new Date().toISOString());
    if (pulls.length) window.postMessage({ [TAG]: true, pulls }, window.location.origin);
    return;
  }
  if (isTransferMarketSearch(url)) {
    // Platform is filled in by the relay from the user's setting.
    const rows = summarizeSearch(json, { observed_at: new Date().toISOString(), platform: "console" });
    if (rows.length) window.postMessage({ [TAG]: true, rows }, window.location.origin);
    return;
  }
  const where = isClubResponse(url);
  if (where) {
    const club = summarizeClub(json, where);
    if (club.length) window.postMessage({ [TAG]: true, club }, window.location.origin);
    return;
  }
  if (isPlayerNames(url)) {
    const players = parsePlayerNames(json);
    if (Object.keys(players).length) window.postMessage({ [TAG]: true, names: { players } }, window.location.origin);
    return;
  }
  if (isLocalisation(url)) {
    const storeNames = parseStoreStrings(json);
    if (Object.keys(storeNames).length) window.postMessage({ [TAG]: true, storeNames }, window.location.origin);
    const names = parseLocalisedNames(json);
    if (Object.keys(names.teams).length + Object.keys(names.leagues).length + Object.keys(names.nations).length)
      window.postMessage({ [TAG]: true, names }, window.location.origin);
  }
}

// Card art addresses: the browser's own list of images this page loaded (resource timing), filtered to EA card art.
// Only the address is passed on; the image itself is never read. Batched so a page of cards is one message.
let artBatch = new Set<string>();
let artTimer: ReturnType<typeof setTimeout> | null = null;
const sentArt = new Set<string>();
function noteArt(name: string) {
  const url = cardArtUrl(name, window.location.href);
  if (!url || sentArt.has(url)) return;
  sentArt.add(url);
  artBatch.add(url);
  if (!artTimer) artTimer = setTimeout(() => {
    const images = [...artBatch];
    artBatch = new Set();
    artTimer = null;
    if (images.length) window.postMessage({ [TAG]: true, images }, window.location.origin);
  }, 3000);
}
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      try { noteArt(e.name); } catch { /* never get in the Web App's way */ }
    }
  }).observe({ type: "resource", buffered: true });
} catch {
  /* resource timing unavailable */
}

// Store tiles: the pack names, descriptions, end times, limits, prices and pictures the Store screen shows (FC 27's
// store data has no readable names). Reads the page's visible text only, a couple of seconds after it changes.
const TILE_HINT = /^(?:Ending|Ends|User limit)\b/i;
let tileTimer: ReturnType<typeof setTimeout> | null = null;
let lastTiles = "";
function scanTiles() {
  tileTimer = null;
  try {
    const tiles: StoreTile[] = [];
    const done = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && tiles.length < 120; n = walker.nextNode()) {
      if (!TILE_HINT.test((n.textContent ?? "").trim())) continue;
      // Climb to the smallest box that holds a pack name and a price
      let el: Element | null = n.parentElement;
      for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
        if (done.has(el)) break;
        // One line per text node, so layout (inline or block) doesn't merge "20" with "Items" or two prices
        const parts: string[] = [];
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let t = tw.nextNode(); t && parts.length < 80; t = tw.nextNode()) { const v = (t.textContent ?? "").trim(); if (v) parts.push(v); }
        const text = parts.join("\n");
        if (text.length > 1500) break;
        const img = [...el.querySelectorAll("img")].map((i) => cardArtUrl(i.currentSrc || i.src, window.location.href)).find(Boolean) ?? null;
        const tile = parseStoreTile(text, img);
        if (tile) { done.add(el); tiles.push(tile); break; }
      }
    }
    const key = JSON.stringify(tiles);
    if (tiles.length && key !== lastTiles) {
      lastTiles = key;
      window.postMessage({ [TAG]: true, storeTiles: tiles }, window.location.origin);
    }
  } catch {
    /* never get in the Web App's way */
  }
}
try {
  new MutationObserver(() => { if (!tileTimer) tileTimer = setTimeout(scanTiles, 2000); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
} catch {
  /* no DOM access */
}

// The last search the user ran themselves: its address (as a template) and its headers (the session).
let template: string | null = null;
let searchHeaders: Record<string, string> = {};
function learn(url: string, method: string, headers: Record<string, string>) {
  if (running) return; // only the user's own searches teach the format
  const t = learnTemplate(new URL(url, window.location.href).href, method);
  if (!t) return;
  template = t;
  searchHeaders = headers;
  window.postMessage({ [TAG]: true, pc: { learned: true } }, window.location.origin);
}
function headersOf(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries([...h.entries()]);
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

const origFetch = window.fetch;
window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
  try {
    const req = args[0];
    const url = typeof req === "string" ? req : req instanceof URL ? req.href : (req as Request).url;
    const method = args[1]?.method ?? (req instanceof Request ? req.method : "GET");
    if (isTransferMarketSearch(url)) learn(url, method, headersOf(args[1]?.headers ?? (req instanceof Request ? req.headers : undefined)));
    noteRequest(url, method, args[1]?.body);
  } catch {
    /* never get in the Web App's way */
  }
  const res = await origFetch.apply(this, args);
  try {
    const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] as Request).url;
    const method = args[1]?.method ?? (args[0] instanceof Request ? args[0].method : "GET");
    if (res.ok && wanted(url, method)) res.clone().json().then((j) => emit(url, j, method)).catch(() => {});
  } catch {
    /* never get in the Web App's way */
  }
  return res;
} as typeof fetch;

type Xhr = XMLHttpRequest & { __xilabUrl?: string; __xilabMethod?: string; __xilabHeaders?: Record<string, string> };
const setHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function (this: Xhr, name: string, value: string) {
  if (this.__xilabHeaders) this.__xilabHeaders[name] = value;
  return setHeader.call(this, name, value);
};
const send = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (this: Xhr, ...a: unknown[]) {
  try {
    if (this.__xilabUrl && isTransferMarketSearch(this.__xilabUrl)) learn(this.__xilabUrl, this.__xilabMethod ?? "GET", this.__xilabHeaders ?? {});
    if (this.__xilabUrl) noteRequest(this.__xilabUrl, this.__xilabMethod ?? "GET", a[0]);
  } catch {
    /* never get in the Web App's way */
  }
  return (send as (...x: unknown[]) => void).apply(this, a);
};

const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: Xhr, method: string, url: string | URL, ...rest: unknown[]) {
  this.__xilabUrl = String(url);
  this.__xilabMethod = method;
  this.__xilabHeaders = {};
  if (wanted(this.__xilabUrl, method))
    this.addEventListener("load", () => {
      try {
        if (this.status !== 200) return;
        const body = this.responseType === "json" ? this.response : this.responseType === "" || this.responseType === "text" ? JSON.parse(this.responseText) : null;
        if (body) emit(this.__xilabUrl!, body, this.__xilabMethod ?? "GET");
      } catch {
        /* not JSON: ignore */
      }
    });
  return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

// ---------------------------------------------------------------- price check runner
// Commands come from the helper (relay.ts) as { "xilab-cmd": "pc-start", urls } or "pc-stop". Each URL was built
// by the relay from the learned template; it is re-checked here before every request.
let running = false;
let stopAsked = false;
const status = (pc: Record<string, unknown>) => window.postMessage({ [TAG]: true, pc }, window.location.origin);
const sleep = (ms: number) => new Promise<void>((r) => {
  const t0 = Date.now();
  const tick = () => (stopAsked || Date.now() - t0 >= ms ? r() : setTimeout(tick, 500));
  tick();
});

async function run(items: { ea_item_id: number; asset_id: number | null }[]) {
  if (running) return;
  if (!template) return status({ running: false, stopped: "Run one search yourself in the Web App first, so the helper learns EA's search format." });
  running = true;
  stopAsked = false;
  status({ running: true, stopped: null });
  let n = 0;
  try {
    for (const it of items) {
      const wait = delayBefore(n);
      if (wait > 30_000) status({ running: true, note: `Short break (${Math.round(wait / 60_000)} min)` });
      await sleep(wait);
      if (stopAsked) break;
      const url = searchUrlFor(template, it);
      if (!url) continue;
      if (!isSafeSearch(url, "GET")) return status({ running: false, stopped: "Refused an unsafe request." });
      const res = await window.fetch(url, { method: "GET", headers: searchHeaders, credentials: "include" });
      let json: unknown = null;
      try {
        json = await res.clone().json();
      } catch {
        /* not JSON */
      }
      n++;
      status({ running: true, searched: 1, note: null });
      const why = stopReason(res.status, json);
      if (why) return status({ running: false, stopped: why, throttled: isThrottle(res.status) });
    }
    status({ running: false, stopped: stopAsked ? "Stopped." : "Done for now." });
  } catch {
    status({ running: false, stopped: "Network problem. Stopped." });
  } finally {
    running = false;
  }
}

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || !e.data) return;
  const cmd = e.data["xilab-cmd"];
  if (cmd === "pc-start" && Array.isArray(e.data.items)) void run(e.data.items);
  if (cmd === "pc-stop") stopAsked = true;
  if (cmd === "pc-ping") status({ learned: !!template, running });
});
