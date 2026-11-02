// Downloads EA's FC 27 ratings feed, page by page, into a snapshot folder:
//   data/raw/ea-ratings/<YYYY-MM-DD>/page-0000.json ... + manifest.json
//
// Jeff approved pulling this public feed on 2026-11-02. Keep it polite: one request at a time with a
// pause between pages, back off on 429/5xx, and stop on 401/403/404 instead of retrying.
// data/raw/ is git-ignored on purpose: the repo is public and the data belongs to EA.
//
// Feed behaviour (checked 2026-11-02, matches several public projects that use it):
//  - Without the `drop-referrer` header the feed silently serves LAST season's ratings.
//  - EA's CDN caches by URL and ignores that header, so every request carries a random `cb` param.
//  - Page size is capped at 100, and totalItems is only reliable on the first page.
//
// Usage: npm run fetch:ea -- [--out dir] [--edition FC27] [--delay-ms 1500] [--max-pages N] [--user-agent "..."]
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { EA_FEED_URL, extractPage, type SnapshotManifest } from "../src/import/ea-feed.js";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    edition: { type: "string", default: "FC27" },
    url: { type: "string", default: EA_FEED_URL },
    referrer: { type: "string", default: "https://www.ea.com/games/ea-sports-fc/ratings" },
    locale: { type: "string", default: "en" },
    limit: { type: "string", default: "100" },
    "delay-ms": { type: "string", default: "1500" },
    "max-pages": { type: "string", default: "1000" },
    "user-agent": { type: "string", default: "XI-Lab-importer/0.1 (personal, non-commercial squad tool)" },
  },
});

const limit = Math.min(Number(values.limit), 100);
const delayMs = Number(values["delay-ms"]);
const maxPages = Number(values["max-pages"]);
const out = values.out ?? join("data", "raw", "ea-ratings", new Date().toISOString().slice(0, 10));
mkdirSync(out, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const headers = {
  accept: "application/json",
  "user-agent": values["user-agent"]!,
  "drop-referrer": values.referrer!,
  referer: values.referrer!,
  "x-feature": JSON.stringify({ enable_next_ratings_release: true }),
};

async function getPage(offset: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const url = `${values.url}?locale=${encodeURIComponent(values.locale!)}&limit=${limit}&offset=${offset}&cb=${randomUUID()}`;
    let res: Response | undefined;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      if (attempt >= 5) throw e;
    }
    if (res?.ok) return await res.text();
    if (res && [400, 401, 403, 404].includes(res.status)) {
      throw new Error(`${res.status} from ${url}. Stopping rather than retrying. Body: ${(await res.text()).slice(0, 300)}`);
    }
    if (attempt >= 5) throw new Error(`Giving up on offset ${offset} after ${attempt + 1} attempts (last status ${res?.status})`);
    const retryAfter = Number(res?.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
    console.warn(`  ${res ? res.status : "network error"} on offset ${offset}; retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
}

/** Prints the top of the first page so whoever runs this can confirm it's the edition they asked for. */
function describeTop(items: unknown[]) {
  console.log("Top of the feed (check this is the edition you expect):");
  for (const raw of items.slice(0, 10)) {
    // Don't judge the edition by image URLs: EA serves FC 27 images from a folder named /FC25/.
    const i = raw as { rank?: number; overallRating?: number; commonName?: string | null; firstName?: string; lastName?: string;
      position?: { shortLabel?: string }; gender?: { label?: string } };
    const name = i.commonName || `${i.firstName ?? ""} ${i.lastName ?? ""}`.trim();
    console.log(`  #${i.rank} ${name} ${i.overallRating} ${i.position?.shortLabel} (${i.gender?.label})`);
  }
}

const manifest: SnapshotManifest = {
  source: "ea-ratings-site",
  edition: values.edition!,
  url: values.url!,
  locale: values.locale!,
  page_size: limit,
  started_at: new Date().toISOString(),
  complete: false,
  total_items: 0,
  pages: [],
};
const writeManifest = () => writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

let offset = 0;
try {
  for (let i = 0; i < maxPages; i++) {
    const file = `page-${String(i).padStart(4, "0")}.json`;
    const path = join(out, file);
    // Re-running into the same folder resumes: pages already on disk aren't fetched again.
    const reused = existsSync(path);
    const text = reused ? readFileSync(path, "utf8") : await getPage(offset);
    const page = extractPage(JSON.parse(text));
    if (!reused) writeFileSync(path, text);
    if (i === 0) {
      manifest.total_reported = page.total;
      describeTop(page.items);
    }
    if (page.items.length === 0) break;
    manifest.pages.push({ file, offset, count: page.items.length, sha256: sha256(text) });
    manifest.total_items += page.items.length;
    offset += page.items.length;
    const of = manifest.total_reported ? ` of ${manifest.total_reported}` : "";
    console.log(`${file}: ${page.items.length} items (${manifest.total_items}${of})${reused ? " [already on disk]" : ""}`);
    if (manifest.total_reported !== undefined && offset >= manifest.total_reported) break;
    if (page.items.length < limit) break;
    if (!reused) await sleep(delayMs);
  }
  manifest.complete = true;
} finally {
  manifest.finished_at = new Date().toISOString();
  writeManifest();
}
console.log(`Done: ${manifest.total_items} items in ${manifest.pages.length} pages -> ${out}`);
if (manifest.total_reported !== undefined && manifest.total_reported !== manifest.total_items) {
  console.warn(`Warning: the feed reported ${manifest.total_reported} items but ${manifest.total_items} were downloaded.`);
}
