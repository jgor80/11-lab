// Usage: npm run db:migrate -- [db path, default xi-lab.sqlite]
import { migrate, openDb } from "../src/db/sqlite.js";

const path = process.argv[2] ?? "xi-lab.sqlite";
const applied = migrate(openDb(path));
console.log(applied.length ? `Applied to ${path}: ${applied.join(", ")}` : `${path} is up to date.`);
