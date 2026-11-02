// Usage:
//   npm run import -- --adapter manual --file data/manual/my-club.csv
//   npm run import -- --adapter kaggle-fc27 --file data/raw/fc27.csv --accept-terms "Jeff"
// Options: --db <path> (default xi-lab.sqlite), --list to show adapters and source terms.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { migrate, openDb } from "../src/db/sqlite.js";
import { ADAPTERS } from "../src/import/adapters/index.js";
import { importRecords, TermsError } from "../src/import/writer.js";

const { values } = parseArgs({
  options: {
    adapter: { type: "string" },
    file: { type: "string" },
    db: { type: "string", default: "xi-lab.sqlite" },
    "accept-terms": { type: "string" },
    list: { type: "boolean", default: false },
  },
});

const db = openDb(values.db!);
migrate(db);

if (values.list || !values.adapter) {
  const rows = db.prepare("SELECT id, terms_status, terms_notes FROM data_sources ORDER BY id").all() as {
    id: string; terms_status: string; terms_notes: string;
  }[];
  console.log("Adapters:");
  for (const [k, a] of Object.entries(ADAPTERS)) console.log(`  ${k.padEnd(14)} -> source '${a.sourceId}': ${a.description}`);
  console.log("\nData sources:");
  for (const r of rows) console.log(`  [${r.terms_status}] ${r.id}\n      ${r.terms_notes}`);
  process.exit(values.adapter ? 0 : 1);
}

const adapter = ADAPTERS[values.adapter];
if (!adapter) throw new Error(`Unknown adapter '${values.adapter}'. Run with --list.`);
if (!values.file) throw new Error("--file is required");

const bytes = readFileSync(values.file);
try {
  const output = adapter.read(bytes.toString("utf8"), values.file);
  const s = importRecords(db, output, {
    sourceId: adapter.sourceId,
    inputRef: basename(values.file),
    inputBytes: bytes,
    termsAcceptedBy: values["accept-terms"],
  });
  console.log(`Import run ${s.runId}: ${s.seen} seen, ${s.written} written, ${s.rejected} rejected.`);
  if (s.rejected) {
    const rej = db.prepare("SELECT record_ref, reason FROM import_rejections WHERE import_run_id = ? LIMIT 10").all(s.runId);
    console.log("First rejections:", rej);
  }
} catch (e) {
  if (e instanceof TermsError) {
    console.error(`Refused: ${e.message}`);
    process.exit(2);
  }
  throw e;
}
