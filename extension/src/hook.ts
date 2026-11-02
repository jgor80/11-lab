// Runs in the Web App's own page (MAIN world). It wraps fetch and XMLHttpRequest ONLY to read a copy of
// responses the Web App already received: transfer-market searches (prices), your club and squad lists, and
// the Web App's own name files. It never sends, changes or repeats a request.
import { isTransferMarketSearch, summarizeSearch } from "../../src/market/capture.js";
import { isClubResponse, isLocalisation, isPlayerNames, parseLocalisedNames, parsePlayerNames, summarizeClub } from "../../src/club/capture.js";

const TAG = "xilab-capture";
const wanted = (url: string) => isTransferMarketSearch(url) || isClubResponse(url) !== null || isPlayerNames(url) || isLocalisation(url);
function emit(url: string, json: unknown) {
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
    const names = parseLocalisedNames(json);
    if (Object.keys(names.teams).length + Object.keys(names.leagues).length + Object.keys(names.nations).length)
      window.postMessage({ [TAG]: true, names }, window.location.origin);
  }
}

const origFetch = window.fetch;
window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args);
  try {
    const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] as Request).url;
    if (res.ok && wanted(url)) res.clone().json().then((j) => emit(url, j)).catch(() => {});
  } catch {
    /* never get in the Web App's way */
  }
  return res;
} as typeof fetch;

const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __xilabUrl?: string }, method: string, url: string | URL, ...rest: unknown[]) {
  this.__xilabUrl = String(url);
  if (wanted(this.__xilabUrl))
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
