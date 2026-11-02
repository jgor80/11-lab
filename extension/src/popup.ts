import { captureRowsToCsv } from "../../src/market/capture.js";
import { buildClubExport } from "../../src/club/capture.js";
import { emptyNames } from "./store.js";
import type { Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function refresh() {
  chrome.storage.local.get(["rows", "platform", "paused", "last_capture", "club", "last_club"], (s: Stored) => {
    $("count").textContent = String(s.rows?.length ?? 0);
    $("club-count").textContent = String(s.club?.length ?? 0);
    $("club-last").textContent = s.last_club ? `Last club capture ${new Date(s.last_club).toLocaleString()}` : "Open your Club in the Web App to capture it.";
    $("last").textContent = s.last_capture ? `Last capture ${new Date(s.last_capture).toLocaleString()}` : "No captures yet.";
    $<HTMLSelectElement>("platform").value = s.platform ?? "console";
    $<HTMLInputElement>("paused").checked = !!s.paused;
  });
}
const csv = (cb: (text: string) => void) => chrome.storage.local.get(["rows"], (s: Stored) => cb(captureRowsToCsv(s.rows ?? [])));

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
$("club-clear").addEventListener("click", () => {
  if (confirm("Delete the stored club capture? Export first if you need it.")) chrome.storage.local.set({ club: [] }, refresh);
});
$("clear").addEventListener("click", () => {
  if (confirm("Delete all stored captures? Export first if you need them.")) chrome.storage.local.set({ rows: [] }, refresh);
});
chrome.storage.onChanged.addListener(refresh);
refresh();
