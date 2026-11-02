// Runs in the Web App's own page (MAIN world). It wraps fetch and XMLHttpRequest ONLY to read a copy of
// transfer-market search responses the Web App already received. It never sends, changes or repeats a request.
import { isTransferMarketSearch, summarizeSearch } from "../../src/market/capture.js";

const TAG = "xilab-capture";
function emit(url: string, json: unknown) {
  if (!isTransferMarketSearch(url)) return;
  // Platform is filled in by the relay from the user's setting.
  const rows = summarizeSearch(json, { observed_at: new Date().toISOString(), platform: "console" });
  if (rows.length) window.postMessage({ [TAG]: true, rows }, window.location.origin);
}

const origFetch = window.fetch;
window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args);
  try {
    const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] as Request).url;
    if (res.ok && isTransferMarketSearch(url)) res.clone().json().then((j) => emit(url, j)).catch(() => {});
  } catch {
    /* never get in the Web App's way */
  }
  return res;
} as typeof fetch;

const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __xilabUrl?: string }, method: string, url: string | URL, ...rest: unknown[]) {
  this.__xilabUrl = String(url);
  if (isTransferMarketSearch(this.__xilabUrl))
    this.addEventListener("load", () => {
      try {
        if (this.status !== 200) return;
        const body = this.responseType === "json" ? this.response : this.responseType === "" || this.responseType === "text" ? JSON.parse(this.responseText) : null;
        if (body) emit(this.__xilabUrl!, body);
      } catch {
        /* not JSON: ignore */
      }
    });
  return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;
