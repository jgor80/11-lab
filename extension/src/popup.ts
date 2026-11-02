import { captureRowsToCsv } from "../../src/market/capture.js";
import type { Stored } from "./store.js";

declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function refresh() {
  chrome.storage.local.get(["rows", "platform", "paused", "last_capture"], (s: Stored) => {
    $("count").textContent = String(s.rows?.length ?? 0);
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
$("clear").addEventListener("click", () => {
  if (confirm("Delete all stored captures? Export first if you need them.")) chrome.storage.local.set({ rows: [] }, refresh);
});
chrome.storage.onChanged.addListener(refresh);
refresh();
