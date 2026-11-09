// Service worker: uploads captured prices, club, pack store and account to the user's XI Lab account on gafferbot.app once a helper key
// is saved (Market Lab > Import prices > Connect helper). Every few minutes, and about a minute after new captures.
// It only forwards what the helper already stored; it never contacts EA.
import { captureRowsToCsv } from "../../src/market/capture.js";
import { buildClubExport } from "../../src/club/capture.js";
import { buildAccountExport } from "../../src/account/capture.js";
import { accountDue, buildStoreExport, GAFFERBOT_API, packPlan, UPLOAD_EVERY_MINUTES, uploadOutcome, uploadPlan } from "../../src/market/upload.js";
import { emptyNames, type Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const get = (keys: string[]) => new Promise<Stored>((res) => chrome.storage.local.get(keys, res));
const set = (patch: Record<string, unknown>) => new Promise<void>((res) => chrome.storage.local.set(patch, res));

async function post(key: string, path: string, body: unknown) {
  try {
    const res = await fetch(`${GAFFERBOT_API}${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return uploadOutcome(res.status, await res.json().catch(() => null));
  } catch {
    return { ok: false, note: "Couldn't reach Gaffer Bot. Trying again later.", key_dead: false };
  }
}

let running = false;
async function upload() {
  if (running) return;
  running = true;
  try {
    const s = await get(["helper_key", "rows", "sent_until", "club", "names", "last_club", "club_sent", "packs", "store_shape", "last_store", "store_sent", "pulls", "pulls_sent_until", "platform", "account", "last_account", "account_sent"]);
    if (!s.helper_key) return;
    const plan = uploadPlan(s);
    if (plan.club && s.club?.length) {
      const r = await post(s.helper_key, "/helper/club", buildClubExport(s.club, s.names ?? emptyNames()));
      if (!r.ok) return void (await set({ upload_note: r.note, ...(r.key_dead ? { helper_key: null } : {}) }));
      await set({ club_sent: s.last_club, last_upload: new Date().toISOString(), upload_note: "Club uploaded." });
    }
    // Pack store and pack pulls (Pack Advisor). Packs only when the store changed; pulls once each.
    const packs = packPlan(s);
    if (packs.store || packs.pulls.length) {
      const r = await post(s.helper_key, "/helper/packs", buildStoreExport(packs.store ? s.packs ?? [] : [], packs.pulls, s.store_shape, s.platform === "pc" ? "pc" : "console"));
      if (!r.ok) return void (await set({ upload_note: r.note, ...(r.key_dead ? { helper_key: null } : {}) }));
      await set({
        ...(packs.store ? { store_sent: s.last_store } : {}),
        ...(packs.pulls.length ? { pulls_sent_until: packs.pulls.at(-1)!.opened_at } : {}),
        last_upload: new Date().toISOString(), upload_note: "Pack store uploaded.",
      });
    }
    // Your account (coins, points, piles, SBCs, objectives) whenever the Web App showed something newer.
    if (accountDue(s) && s.account) {
      const r = await post(s.helper_key, "/helper/account", { ...buildAccountExport(s.account), platform: s.platform === "pc" ? "pc" : "console" });
      if (!r.ok) return void (await set({ upload_note: r.note, ...(r.key_dead ? { helper_key: null } : {}) }));
      await set({ account_sent: s.last_account, last_upload: new Date().toISOString(), upload_note: "Account uploaded." });
    }
    if (plan.rows.length) {
      const r = await post(s.helper_key, "/helper/prices", { text: captureRowsToCsv(plan.rows) });
      if (!r.ok) return void (await set({ upload_note: r.note, ...(r.key_dead ? { helper_key: null } : {}) }));
      await set({ sent_until: plan.rows.at(-1)!.observed_at, last_upload: new Date().toISOString(), upload_note: `${plan.rows.length} prices uploaded.` });
      // More than one batch waiting: carry on shortly.
      if (uploadPlan({ ...s, sent_until: plan.rows.at(-1)!.observed_at }).rows.length) chrome.alarms.create("upload-soon", { delayInMinutes: 0.5 });
    }
  } finally {
    running = false;
  }
}

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create("upload", { periodInMinutes: UPLOAD_EVERY_MINUTES }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create("upload", { periodInMinutes: UPLOAD_EVERY_MINUTES }));
chrome.alarms.onAlarm.addListener((a: { name: string }) => { if (a.name === "upload" || a.name === "upload-soon") void upload(); });
chrome.runtime.onMessage.addListener((msg: { upload?: string }, _sender: unknown, reply: (r: unknown) => void) => {
  // "soon" after new captures (re-creating the alarm batches a burst of searches); "now" from the popup.
  if (msg?.upload === "soon") chrome.alarms.create("upload-soon", { delayInMinutes: 1 });
  else if (msg?.upload === "now") { void upload().then(() => reply({ ok: true })); return true; }
  return false;
});
