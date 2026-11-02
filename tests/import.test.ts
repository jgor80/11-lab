import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import { migrate, openDb, type Db } from "../src/db/sqlite.js";
import { readManualCsv } from "../src/import/adapters/manual.js";
import { readKaggleFc27 } from "../src/import/adapters/kaggle-fc27.js";
import { importRecords, TermsError } from "../src/import/writer.js";
import { loadChemistryRules } from "../src/db/chemistry-rules.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const count = (db: Db, sql: string, ...p: (string | number)[]) =>
  (db.prepare(sql).get(...p) as { n: number }).n;

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("manual CSV import", () => {
  it("writes cards, links versions to one player, and rejects bad rows with a reason", () => {
    const s = importRecords(db, readManualCsv(fixture("manual-cards.csv")), { sourceId: "manual", inputRef: "x.csv" });
    expect(s).toMatchObject({ seen: 3, written: 2, rejected: 1 });
    expect(count(db, "SELECT COUNT(*) n FROM players")).toBe(1);
    expect(count(db, "SELECT COUNT(*) n FROM player_cards")).toBe(2);
    const reason = (db.prepare("SELECT reason FROM import_rejections").get() as { reason: string }).reason;
    expect(reason).toMatch(/unknown positions: XX/);
  });

  it("stores PlayStyle+, role familiarity, attributes and provenance", () => {
    const s = importRecords(db, readManualCsv(fixture("manual-cards.csv")), { sourceId: "manual" });
    const card = db.prepare("SELECT id, source_id, import_run_id, evidence FROM player_cards WHERE source_card_key='t-1'").get() as Record<string, unknown>;
    expect(card).toMatchObject({ source_id: "manual", import_run_id: s.runId, evidence: "game_data" });
    const ps = db.prepare(
      "SELECT p.name, cp.is_plus FROM card_playstyles cp JOIN playstyles p ON p.id=cp.playstyle_id WHERE card_id=? ORDER BY p.name",
    ).all(card.id as number);
    expect(ps).toEqual([{ name: "Anticipate", is_plus: 0 }, { name: "Intercept", is_plus: 1 }]);
    const roles = db.prepare(
      "SELECT r.position_code, r.name, f.level FROM card_role_familiarity f JOIN roles r ON r.id=f.role_id WHERE card_id=? ORDER BY r.position_code",
    ).all(card.id as number);
    expect(roles).toEqual([
      { position_code: "CDM", name: "Holding", level: "plusplus" },
      { position_code: "CM", name: "Box-to-Box", level: "plus" },
    ]);
    expect(db.prepare("SELECT standing_tackle, interceptions, pac, sho FROM card_attributes WHERE card_id=?").get(card.id as number))
      .toEqual({ standing_tackle: 85, interceptions: 84, pac: 70, sho: null });
    expect(count(db, "SELECT COUNT(*) n FROM card_positions WHERE card_id=? AND is_primary=1 AND position_code='CDM'", card.id as number)).toBe(1);
  });

  it("is idempotent: re-importing updates instead of duplicating", () => {
    importRecords(db, readManualCsv(fixture("manual-cards.csv")), { sourceId: "manual" });
    importRecords(db, readManualCsv(fixture("manual-cards.csv")), { sourceId: "manual" });
    expect(count(db, "SELECT COUNT(*) n FROM player_cards")).toBe(2);
    expect(count(db, "SELECT COUNT(*) n FROM card_playstyles")).toBe(4);
    expect(count(db, "SELECT COUNT(*) n FROM import_runs WHERE status='succeeded'")).toBe(2);
  });
});

describe("terms gate", () => {
  it("refuses a pending_review source without a recorded decision", () => {
    expect(() => importRecords(db, readKaggleFc27(fixture("kaggle-sample.csv")), { sourceId: "kaggle-mikedpad-fc27" }))
      .toThrow(TermsError);
    expect(count(db, "SELECT COUNT(*) n FROM import_runs")).toBe(0);
  });

  it("refuses blocked sources outright", () => {
    expect(() => importRecords(db, { records: [], rejected: [] }, { sourceId: "futbin-futgg-futwiz", termsAcceptedBy: "anyone" }))
      .toThrow(/blocked/);
  });

  it("records who accepted the terms on the run", () => {
    const s = importRecords(db, readKaggleFc27(fixture("kaggle-sample.csv")), {
      sourceId: "kaggle-mikedpad-fc27", termsAcceptedBy: "Tester",
    });
    const run = db.prepare("SELECT terms_accepted_by, source_snapshot_at FROM import_runs WHERE id=?").get(s.runId);
    expect(run).toEqual({ terms_accepted_by: "Tester", source_snapshot_at: "2026-09-12" });
  });
});

describe("Kaggle FC 27 adapter", () => {
  it("maps columns and rejects positions the game no longer has instead of dropping them silently", () => {
    const out = readKaggleFc27(fixture("kaggle-sample.csv"));
    expect(out.records).toHaveLength(2);
    const st = out.records[0]!;
    expect(st.positions).toEqual(["ST", "CF", "LW"]);
    expect(st.playstyles).toEqual([{ name: "Finesse Shot", plus: true }, { name: "Quick Step", plus: false }]);
    expect(st.attributes).toMatchObject({ pac: 90, interceptions: 30, standing_tackle: 35 });
    expect(st.attributes).not.toHaveProperty("gk_diving");
    const s = importRecords(db, out, { sourceId: "kaggle-mikedpad-fc27", termsAcceptedBy: "Tester" });
    expect(s).toMatchObject({ written: 1, rejected: 1 }); // CF is not in positions
    expect(count(db, "SELECT COUNT(*) n FROM players WHERE gender='women' AND preferred_foot='left'")).toBe(1);
  });

  it("fails loudly on a file with the wrong columns", () => {
    expect(() => readKaggleFc27("a,b\n1,2\n")).toThrow(/missing columns/);
  });
});

describe("schema", () => {
  it("has one card_attributes column for every attribute_defs key", () => {
    const cols = (db.prepare("PRAGMA table_info(card_attributes)").all() as { name: string }[])
      .map((c) => c.name).filter((c) => c !== "card_id").sort();
    const keys = (db.prepare("SELECT key FROM attribute_defs").all() as { key: string }[]).map((k) => k.key).sort();
    expect(cols).toEqual(keys);
  });
});

describe("chemistry rules", () => {
  it("seeds the community thresholds as an active, unverified version", () => {
    const r = loadChemistryRules(db);
    expect(r).toMatchObject({ id: "fc27-community-v0", status: "unverified" });
    expect(r.thresholds).toEqual({ club: [2, 4, 7], league: [3, 5, 8], nation: [2, 5, 8] });
    expect(r.modifiers["manager.bonus"]).toBe(1);
  });

  it("allows only one active version per season", () => {
    expect(() =>
      db.prepare(
        "INSERT INTO chemistry_rule_versions (id, season, label, status, is_active, source_notes) VALUES ('x','FC27','x','unverified',1,'x')",
      ).run(),
    ).toThrow();
  });
});
