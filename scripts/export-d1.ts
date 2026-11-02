// Dumps imported data from the local SQLite file as SQL for Cloudflare D1.
// Usage: npm run export:d1 -- [db path] [out file]
// Then:  npx wrangler d1 migrations apply xi-lab --remote
//        npx wrangler d1 execute xi-lab --remote --file out/d1-data.sql
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "../src/db/sqlite.js";

// Parent tables first. Seed tables (positions, attribute_defs, data_sources, chemistry_*) come from migrations.
const TABLES = [
  "nations", "leagues", "clubs", "playstyles", "roles", "import_runs", "import_rejections",
  "players", "player_cards", "card_positions", "card_attributes", "card_playstyles", "card_role_familiarity",
  "market_prices",
];

const [dbPath = "xi-lab.sqlite", outPath = "out/d1-data.sql"] = process.argv.slice(2);
const db = openDb(dbPath);

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

const lines: string[] = [];
let total = 0;
for (const t of TABLES) {
  const rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
  for (const r of rows) {
    const cols = Object.keys(r);
    lines.push(`INSERT OR REPLACE INTO ${t} (${cols.join(", ")}) VALUES (${cols.map((c) => lit(r[c])).join(", ")});`);
  }
  total += rows.length;
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${total} rows to ${outPath}`);
