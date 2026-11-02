import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db/sqlite.js";
import { loadChemistryRules } from "../src/db/chemistry-rules.js";
import {
  computeSquadChemistry,
  previewSwap,
  pointsFor,
  nextThreshold,
  RulesError,
  SquadInputError,
  type ChemistryRules,
  type SquadCard,
  type SquadInput,
} from "../src/chemistry/index.js";
import { seed352, locked } from "./fixtures/chemistry/seed-352.js";

// The active seeded rule version (fc27-community-v1), so tests follow whatever the migrations ship.
const db = openDb(":memory:");
migrate(db);
const v1 = loadChemistryRules(db);
const v0 = loadChemistryRules(db, "fc27-community-v0"); // old reading: manager adds chemistry directly

const rules = (patch: Partial<ChemistryRules> = {}, mods: Record<string, number> = {}): ChemistryRules => ({
  ...v1,
  ...patch,
  modifiers: { ...v1.modifiers, ...mods },
});

let n = 0;
const c = (o: Partial<SquadCard> = {}): SquadCard => ({
  name: `P${++n}`,
  club: `club-${n}`,
  league: `league-${n}`,
  nation: `nation-${n}`,
  positions: ["CM"],
  ...o,
});
const squad = (cards: SquadCard[], manager?: SquadInput["manager"]): SquadInput => ({
  formation: "test",
  manager,
  slots: cards.map((card, i) => ({ slot: `S${i + 1}`, position: "CM", card })),
});
const chem = (input: SquadInput, r = v1) => computeSquadChemistry(input, r);

describe("rule version", () => {
  it("loads the active rule version from the DB as unverified", () => {
    expect(v1).toMatchObject({ id: "fc27-community-v1", status: "unverified" });
    expect(v1.thresholds).toEqual({ club: [2, 4, 7], league: [3, 5, 8], nation: [2, 5, 8] });
  });

  it("maps counts to points and next thresholds", () => {
    expect([0, 1, 2, 3, 4, 6, 7, 11].map((k) => pointsFor([2, 4, 7], k))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(nextThreshold([2, 4, 7], 3)).toBe(4);
    expect(nextThreshold([2, 4, 7], 7)).toBeNull();
  });

  it("refuses incomplete rules and warns on modifiers it doesn't apply", () => {
    const { ["player.max_chemistry"]: _, ...noMax } = v1.modifiers;
    expect(() => chem(squad([c()]), { ...v1, modifiers: noMax })).toThrow(RulesError);
    expect(() => chem(squad([c()]), rules({ thresholds: { ...v1.thresholds, club: [4, 2] } }))).toThrow(RulesError);
    expect(chem(squad([c()]), rules({}, { "loan.bonus": 1 })).warnings.join()).toMatch(/"loan.bonus"/);
  });

  it("reads thresholds from the rule version, not from code", () => {
    const pair = squad([c({ club: "X" }), c({ club: "X" })]);
    expect(chem(pair).players[0]!.links.club).toBe(1);
    expect(chem(pair, rules({ thresholds: { ...v1.thresholds, club: [3, 4, 7] } })).players[0]!.links.club).toBe(0);
  });
});

describe("individual chemistry", () => {
  it("gives 33/33 for one shared league but never calls it verified under unverified rules", () => {
    const r = chem(squad(Array.from({ length: 11 }, () => c({ league: "Same" }))));
    expect(r.total).toBe(33);
    expect(r.max).toBe(33);
    expect(r.full_chemistry_verified).toBe(false);
    expect(r.evidence).toBe("hypothesis");
    expect(r.warnings.join()).toMatch(/unverified/);
    const ok = chem(squad(Array.from({ length: 11 }, () => c({ league: "Same" }))), rules({ status: "verified" }));
    expect(ok).toMatchObject({ full_chemistry_verified: true, evidence: "verified" });
  });

  it("sums club, league and nation and caps at max", () => {
    const cards = Array.from({ length: 7 }, () => c({ club: "C", league: "L", nation: "N" }));
    const p = chem(squad(cards)).players[0]!;
    expect(p.links).toEqual({ club: 3, league: 2, nation: 2 });
    expect(p.chemistry).toBe(3);
    expect(p.notes.join()).toMatch(/Capped at 3 \(links add up to 7\)/);
  });

  it("matches names case- and space-insensitively", () => {
    const p = chem(squad([c({ club: "Real Madrid" }), c({ club: " real madrid " })])).players[0]!;
    expect(p.links.club).toBe(1);
  });

  it("gives an out-of-position player 0 and removes them from everyone's counts", () => {
    const three = [c({ league: "L" }), c({ league: "L" }), c({ league: "L" })];
    expect(chem(squad(three)).total).toBe(3);
    three[2]!.positions = ["ST"];
    const r = chem(squad(three));
    expect(r.players.map((p) => p.chemistry)).toEqual([0, 0, 0]);
    expect(r.players[2]).toMatchObject({ in_position: false });
    expect(r.players[2]!.notes.join()).toMatch(/Out of position: S3 needs CM, card plays ST/);
    expect(r.players[0]!.breakdown.league).toMatchObject({ count: 2, next_threshold: 3, needed_for_next: 1 });
  });

  it("adds the manager to their nation's and league's counts (active rules)", () => {
    // One US player alone: nation count 1 + manager 1 = 2 -> 1 point, no direct bonus.
    const r = chem(squad([c({ nation: "United States" }), c()], { nation: "united states", league: "NWSL" }));
    expect(r.players[0]).toMatchObject({ manager_bonus: 0, chemistry: 1 });
    expect(r.players[0]!.breakdown.nation).toMatchObject({ count: 2, points: 1, next_threshold: 5 });
    expect(r.players[1]!.chemistry).toBe(0);
  });

  it("v0's reading: manager adds +1 chemistry once for a nation or league match", () => {
    const r = chem(squad([c({ nation: "United States" }), c({ nation: "United States", league: "NWSL" }), c()], { nation: "united states", league: "NWSL" }), v0);
    expect(r.players.map((p) => p.manager_bonus)).toEqual([1, 1, 0]);
    expect(r.players[0]!.chemistry).toBe(2); // nation pair 1 + manager 1
    expect(r.players[1]!.notes.join()).toMatch(/matches manager nation and league/);
  });


  it("explains missing metadata instead of guessing", () => {
    const p = chem(squad([c({ club: null, league: null })])).players[0]!;
    expect(p.breakdown.club).toMatchObject({ key: null, count: 0, next_threshold: null });
    expect(p.notes.join()).toMatch(/No club entered/);
  });
});

describe("Icons and Heroes", () => {
  it("Icon adds its nation bonus", () => {
    // Icon + 3 others of one nation: count 4 + 1 bonus = 5 -> 2 points. Without the flag: 4 -> 1.
    const cards = [c({ nation: "N", is_icon: true }), c({ nation: "N" }), c({ nation: "N" }), c({ nation: "N" })];
    expect(chem(squad(cards)).players[1]!.breakdown.nation).toMatchObject({ count: 5, points: 2 });
    cards[0]!.is_icon = false;
    expect(chem(squad(cards)).players[1]!.breakdown.nation).toMatchObject({ count: 4, points: 1 });
  });

  it("Icon adds to every other league in the XI", () => {
    const r = chem(squad([c({ league: "Icons", is_icon: true }), c({ league: "L" }), c({ league: "L" })]));
    expect(r.players[1]!.breakdown.league).toMatchObject({ count: 3, points: 1 });
    expect(r.players[0]!.breakdown.league.count).toBe(1); // not its own league
  });

  it("Icon out of position adds nothing", () => {
    const r = chem(squad([c({ league: "Icons", is_icon: true, positions: ["ST"] }), c({ league: "L" }), c({ league: "L" })]));
    expect(r.players[1]!.breakdown.league.count).toBe(2);
  });

  it("Hero adds its league and nation bonuses", () => {
    const r = chem(squad([c({ league: "L", nation: "N", is_hero: true }), c({ league: "L", nation: "N" })]));
    expect(r.players[1]!.breakdown.league).toMatchObject({ count: 3, points: 1 });
    expect(r.players[1]!.breakdown.nation).toMatchObject({ count: 3, points: 1 });
  });

  it("gives an in-position Icon max chemistry, but not a Hero (active rules)", () => {
    expect(v1.modifiers).toMatchObject({ "icon.always_max": 1, "hero.always_max": 0 });
    const icon = chem(squad([c({ is_icon: true }), c()])).players[0]!;
    expect(icon.chemistry).toBe(3);
    expect(icon.notes.join()).toMatch(/Icon in position: always max/);
    expect(chem(squad([c({ is_icon: true, positions: ["ST"] })])).players[0]!.chemistry).toBe(0);
    // A lone Hero gets nation 1 + 1 bonus = 2 -> 1 point, no automatic max.
    const solo = squad([c({ is_hero: true })]);
    expect(chem(solo).players[0]!.chemistry).toBe(1);
    expect(chem(solo, rules({}, { "hero.always_max": 1 })).players[0]!.chemistry).toBe(3);
  });
});

describe("squad input", () => {
  it("rejects duplicate slots and more than 11 players, warns on partial squads and duplicates", () => {
    const dup = squad([c(), c()]);
    dup.slots[1]!.slot = "S1";
    expect(() => chem(dup)).toThrow(SquadInputError);
    expect(() => chem(squad(Array.from({ length: 12 }, () => c())))).toThrow(SquadInputError);
    const w = chem(squad([c({ name: "Same" }), c({ name: "same" })])).warnings.join();
    expect(w).toMatch(/Only 2 of 11/);
    expect(w).toMatch(/"same" appears 2 times/);
  });

  it("is deterministic", () => {
    expect(chem(seed352)).toEqual(chem(structuredClone(seed352)));
  });
});

describe("seed scenario: 3-5-2, four locked players, US/NWSL manager (fixture cards)", () => {
  const r = chem(seed352);
  const by = Object.fromEntries(r.players.map((p) => [p.slot, p]));

  it("matches the hand-calculated chemistry", () => {
    // League 1 has 5 players (2 pts), League 2 has 3 (1 pt). NWSL and United States have 3 each plus the
    // manager = 4 (1 pt each). See the fixture for the rest.
    expect(Object.fromEntries(r.players.map((p) => [p.slot, p.chemistry]))).toEqual({
      GK: 3, LCB: 3, CB: 3, RCB: 2, LCDM: 2, RCDM: 1, CAM: 2, LM: 2, RM: 2, LST: 2, RST: 2,
    });
    expect(r.total).toBe(24);
    expect(r.max).toBe(33);
    expect(r.rule_version).toBe("fc27-community-v1");
  });

  it("shows each link and what's needed for the next point", () => {
    expect(by.RCB!.breakdown.nation).toMatchObject({ key: "Nation 2", count: 1, points: 0, next_threshold: 2, needed_for_next: 1 });
    expect(by.LM!.breakdown.nation).toMatchObject({ key: "United States", count: 4, points: 1, needed_for_next: 1 });
    expect(by.LM!.breakdown.league).toMatchObject({ key: "NWSL", count: 4, points: 1, needed_for_next: 1 });
    expect(by.LM!.manager_bonus).toBe(0);
    expect(by.GK!.notes.join()).toMatch(/Capped at 3 \(links add up to 4\)/);
  });

  it("shows who gains and loses when a player is swapped", () => {
    const { after, diff } = previewSwap(
      seed352, "RCDM",
      { name: "Fixture new CDM", club: "Club 10", league: "League 1", nation: "Nation 2", positions: ["CDM"] },
      v1,
    );
    expect(after.total).toBe(25);
    expect(diff.delta).toBe(1);
    const ch = Object.fromEntries(diff.changes.map((x) => [x.slot, x]));
    expect(Object.keys(ch).sort()).toEqual(["CAM", "RCB", "RCDM", "RST"]);
    expect(ch.RST).toMatchObject({ before: 2, after: 1, delta: -1 });
    expect(ch.RST!.reasons).toEqual(["league League 2: 3 -> 2 sharing, 1 -> 0 pts"]);
    expect(ch.RCB).toMatchObject({ before: 2, after: 3 });
    expect(ch.RCB!.reasons).toEqual(["nation Nation 2: 1 -> 2 sharing, 0 -> 1 pts"]);
    expect(ch.RCDM!.reasons).toEqual(["Fixture RCDM replaced by Fixture new CDM"]);
  });

  it("removing a player reports the loss", () => {
    const { diff } = previewSwap(seed352, "LM", null, v1);
    const ch = Object.fromEntries(diff.changes.map((x) => [x.slot, x]));
    expect(ch.LM).toMatchObject({ before: 2, after: 0, name_after: null, reasons: ["Fixture LM removed"] });
    // NWSL and US drop to 2 + manager = 3: still 1 point each, so nobody else changes.
    expect(diff.changes.map((x) => x.slot)).toEqual(["LM"]);
    expect(diff.delta).toBe(-2);
  });

  it("keeps the locked players in the squad", () => {
    for (const s of locked) expect(by[s]!.name).toMatch(/^Locked /);
  });
});

describe("worker safety", () => {
  it("has no Node-only or DB imports in src/chemistry", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../src/chemistry/", import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/from "(node:|fs|path)|\/db\//);
    }
  });
});
