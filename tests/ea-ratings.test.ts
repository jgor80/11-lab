// Fixture items follow the feed's real shape (checked 2026-11-02) but every value is made up.
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, type Db } from "../src/db/sqlite.js";
import { DEFAULT_ATTRIBUTES, camelToSnake, loadEaRatingsSnapshot } from "../src/import/adapters/ea-ratings.js";
import { importRecords } from "../src/import/writer.js";

const stat = (value: number) => ({ value, diff: 0 });
const ps = (label: string, plus = false) => ({
  id: "x", label, description: "", imageUrl: "",
  type: plus ? { id: "playStylePlus", label: "Play Style Plus" } : { id: "playStyle", label: "Play Style" },
});

const winger = {
  id: 900001, rank: 1, overallRating: 88, firstName: "Testo", lastName: "Wingman", commonName: null,
  birthdate: "6/5/1998 12:00:00 AM", height: 178, skillMoves: 4, weakFootAbility: 3, preferredFoot: 2,
  leagueName: "Example League", weight: 72, avatarUrl: "https://example.invalid/FC27/full/p900001.png",
  alternatePositions: [{ id: "23", label: "Right Wing", shortLabel: "RW" }],
  playerAbilities: [ps("Technical"), ps("Finesse Shot+", true), { id: "r", label: "Inside Forward++", type: { id: "rolePlusPlus" } }],
  gender: { id: 0, label: "Men's Football" },
  nationality: { id: 7001, label: "Testland" },
  team: { id: 8001, label: "Example FC", isPopular: false },
  position: { id: "12", shortLabel: "RM", label: "Right Midfielder" },
  stats: { pac: stat(90), ballControl: stat(89), sprintSpeed: stat(91), gkDiving: stat(10), mystery: stat(50) },
};
const keeper = {
  ...winger, id: 900002, rank: 2, overallRating: 87, firstName: "Fake", lastName: "Keeper Lastname", commonName: "Fake Keeper",
  preferredFoot: 1, gender: { id: 1, label: "Women's Football" }, alternatePositions: [], playerAbilities: [],
  position: { id: "0", shortLabel: "GK", label: "Goalkeeper" }, stats: { gkDiving: stat(88), gkReflexes: stat(86) },
};

function writeSnapshot(dir: string, pages: unknown[][], edition = "FC27", total?: number) {
  mkdirSync(dir, { recursive: true });
  const manifest = {
    source: "ea-ratings-site", edition, url: "https://example.invalid", locale: "en", page_size: 100,
    started_at: "2026-11-02T01:00:00.000Z", finished_at: "2026-11-02T01:05:00.000Z", complete: true,
    total_reported: total ?? pages.flat().length, total_items: pages.flat().length,
    pages: pages.map((items, i) => {
      const text = JSON.stringify({ items, totalItems: total ?? pages.flat().length });
      const file = `page-${String(i).padStart(4, "0")}.json`;
      writeFileSync(join(dir, file), text);
      return { file, offset: i * 100, count: items.length, sha256: createHash("sha256").update(text).digest("hex") };
    }),
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

let db: Db;
let tmp: string;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  tmp = mkdtempSync(join(tmpdir(), "xi-ea-"));
});

describe("EA ratings adapter", () => {
  it("maps the feed's fields onto a card record", () => {
    const { output } = loadEaRatingsSnapshot(writeSnapshot(join(tmp, "s"), [[winger, keeper]]));
    const [w, k] = output.records;
    expect(w).toMatchObject({
      card_key: "FC27:900001", ea_item_id: 900001, season: "FC27", overall: 88, version: "base", evidence: "game_data",
      person: { common_name: "Testo Wingman", birth_date: "1998-06-05", preferred_foot: "left", gender: "men", height_cm: 178 },
      positions: ["RM", "RW"],
      nation: { name: "Testland", ea_id: 7001 }, club: { name: "Example FC", ea_id: 8001 },
      league: { name: "Example League", gender: "men" },
      skill_moves: 4, weak_foot: 3,
      attributes: { pac: 90, ball_control: 89, sprint_speed: 91, gk_diving: 10 },
      playstyles: [{ name: "Technical", plus: false }, { name: "Finesse Shot", plus: true }],
    });
    expect(k).toMatchObject({ person: { common_name: "Fake Keeper", preferred_foot: "right", gender: "women" }, positions: ["GK"] });
    expect(output.snapshotAt).toBe("2026-11-02T01:00:00.000Z");
  });

  it("reports what it couldn't map instead of dropping it silently", () => {
    const { output } = loadEaRatingsSnapshot(writeSnapshot(join(tmp, "s"), [[winger]]));
    expect(output.warnings).toEqual(expect.arrayContaining([
      "skipped unknown stat 'mystery' (1 cards)",
      "skipped ability type 'rolePlusPlus' (e.g. Inside Forward++) (1 cards)",
    ]));
  });

  it("dedupes items repeated across pages and flags a short download", () => {
    const { output } = loadEaRatingsSnapshot(writeSnapshot(join(tmp, "s"), [[winger], [winger, keeper]], "FC27", 5));
    expect(output.records).toHaveLength(2);
    expect(output.warnings).toEqual(expect.arrayContaining([
      "skipped 1 duplicate items repeated across pages",
      expect.stringMatching(/feed reported 5 items, snapshot has 3/),
    ]));
  });

  it("refuses a page that doesn't match its manifest hash", () => {
    const dir = writeSnapshot(join(tmp, "s"), [[winger]]);
    writeFileSync(join(dir, "page-0000.json"), JSON.stringify({ items: [keeper], totalItems: 1 }));
    expect(() => loadEaRatingsSnapshot(dir)).toThrow(/doesn't match its manifest hash/);
  });

  it("loads a folder of snapshots, e.g. one per gender", () => {
    writeSnapshot(join(tmp, "all", "men"), [[winger]]);
    writeSnapshot(join(tmp, "all", "women"), [[keeper]]);
    expect(loadEaRatingsSnapshot(join(tmp, "all")).output.records).toHaveLength(2);
  });

  it("imports end to end, and keeps each season's card for the same person", () => {
    const fc26 = loadEaRatingsSnapshot(writeSnapshot(join(tmp, "fc26"), [[{ ...winger, overallRating: 85 }]], "FC26"));
    const fc27 = loadEaRatingsSnapshot(writeSnapshot(join(tmp, "fc27"), [[winger, keeper]], "FC27"));
    expect(importRecords(db, fc26.output, { sourceId: "ea-ratings-site" })).toMatchObject({ written: 1, rejected: 0 });
    expect(importRecords(db, fc27.output, { sourceId: "ea-ratings-site" })).toMatchObject({ written: 2, rejected: 0 });
    expect(db.prepare("SELECT season, overall FROM player_cards WHERE ea_item_id = 900001 ORDER BY season").all())
      .toEqual([{ season: "FC26", overall: 85 }, { season: "FC27", overall: 88 }]);
    expect((db.prepare("SELECT COUNT(*) n FROM players").get() as { n: number }).n).toBe(2);
    expect(db.prepare(
      `SELECT a.ball_control, a.gk_diving FROM card_attributes a JOIN player_cards c ON c.id = a.card_id
       WHERE c.source_card_key = 'FC27:900001'`,
    ).get()).toEqual({ ball_control: 89, gk_diving: 10 });
    const notes = (db.prepare("SELECT notes FROM import_runs ORDER BY id DESC LIMIT 1").get() as { notes: string }).notes;
    expect(notes).toMatch(/mystery/);
  });

  it("rejects one bad card without aborting the rest of the run", () => {
    const { output } = loadEaRatingsSnapshot(writeSnapshot(join(tmp, "s"), [[winger, keeper]]));
    output.records.push({ ...output.records[0]!, card_key: "FC27:dupe-item-id" }); // same season + EA item id
    const s = importRecords(db, output, { sourceId: "ea-ratings-site" });
    expect(s).toMatchObject({ written: 2, rejected: 1 });
    const reason = (db.prepare("SELECT reason FROM import_rejections").get() as { reason: string }).reason;
    expect(reason).toMatch(/write failed: .*UNIQUE/);
  });

  it("knows every attribute the schema has, and maps the feed's camelCase names to them", () => {
    const keys = (db.prepare("SELECT key FROM attribute_defs").all() as { key: string }[]).map((r) => r.key).sort();
    expect([...DEFAULT_ATTRIBUTES].sort()).toEqual(keys);
    const feedKeys = ["ballControl", "defensiveAwareness", "freeKickAccuracy", "gkPositioning", "headingAccuracy",
      "shotPower", "slidingTackle", "sprintSpeed", "standingTackle", "longPassing", "shortPassing", "longShots", "pac"];
    for (const k of feedKeys) expect(DEFAULT_ATTRIBUTES.has(camelToSnake(k))).toBe(true);
  });
});
