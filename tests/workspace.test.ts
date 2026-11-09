import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db/sqlite.js";
import { loadChemistryRules } from "../src/db/chemistry-rules.js";
import { computeSquadChemistry } from "../src/chemistry/index.js";
import {
  DEFAULT_RULES as R,
  MemoryCardSource,
  MemorySquadStore,
  SquadError,
  assignCard,
  compareSquads,
  createSquad,
  FORMATION_NAMES,
  formationSlots,
  createWorkspaceService,
  diagnoseSlot,
  evaluateSquad,
  fitScore,
  getSlot,
  optimizeSquad,
  PRESET_PROFILES,
  previewAssign,
  setFormation,
  setLocked,
  setManager,
  swapSlots,
  toSquadInput,
  type Squad,
  type WorkspaceCard,
} from "../src/workspace/index.js";
import { DEMO_MANAGERS, DEMO_POOL, DEMO_XI, demoSquad } from "../src/workspace/demo.js";

const pool = { cards: DEMO_POOL, managers: DEMO_MANAGERS };
let n = 0;
const card = (o: Partial<WorkspaceCard> & { positions: string[] }): WorkspaceCard => ({
  id: `t${++n}`,
  name: `Player ${n}`,
  club: `club-${n}`,
  league: `league-${n}`,
  nation: `nation-${n}`,
  ...o,
});

describe("default rules", () => {
  it("match the active rule version in the database", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(R).toEqual(loadChemistryRules(db));
  });
});

describe("squad workspace", () => {
  it("builds a 3-5-2 and recalculates chemistry through the engine", () => {
    const s = demoSquad();
    expect(s.slots.map((x) => x.position)).toEqual(["GK", "CB", "CB", "CB", "CDM", "CDM", "LM", "CAM", "RM", "ST", "ST"]);
    const ev = evaluateSquad(s, R);
    expect(ev.chemistry).toEqual(computeSquadChemistry(toSquadInput(s), R));
    expect(ev.chemistry.total).toBe(25);
    expect(ev).toMatchObject({ evidence: "hypothesis", rule_version: "fc27-community-v1", rule_status: "unverified" });
  });

  it("refuses the same card or player twice", () => {
    const s = demoSquad();
    expect(() => assignCard(s, "RM", DEMO_XI.LST!)).toThrow(SquadError);
    expect(() => assignCard(s, "RM", { ...DEMO_XI.LST!, id: "other-version" })).toThrow(/version of Rae Whitlock/);
  });

  it("updates chemistry when the manager changes", () => {
    const s = demoSquad();
    const usa = setManager(s, DEMO_MANAGERS[1]!);
    const lst = (x: Squad) => evaluateSquad(x, R).chemistry.players.find((p) => p.slot === "LST")!.chemistry;
    expect(lst(s)).toBe(2);
    expect(lst(usa)).toBe(3);
  });

  it("has every FC 27 Ultimate Team formation, each a valid XI in FC 27's 12 positions", () => {
    const positions = new Set(["GK", "LB", "CB", "RB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST"]);
    expect(FORMATION_NAMES).toHaveLength(28);
    expect(FORMATION_NAMES).toEqual(expect.arrayContaining(["4-3-3 (2)", "4-2-3-1 (2)", "4-1-2-1-2 (2)", "5-2-1-2", "3-1-4-2"]));
    for (const name of FORMATION_NAMES) {
      const slots = formationSlots(name);
      expect(slots, name).toHaveLength(11);
      expect(new Set(slots.map((s) => s.slot)).size, name).toBe(11);
      expect(slots.filter((s) => s.position === "GK"), name).toHaveLength(1);
      for (const s of slots) expect(positions.has(s.position), `${name} ${s.slot} ${s.position}`).toBe(true);
      // Outfield lines go back to front: no slot sits in front of a line nearer the opponent's goal.
      expect(slots.map((s) => s.row), name).toEqual([...slots.map((s) => s.row)].sort((a, b) => a - b));
    }
    const s = createSquad({ formation: "4-3-3 (4)" });
    expect(s.slots.map((x) => x.position)).toEqual(["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CAM", "LW", "ST", "RW"]);
  });

  it("keeps cards and locks when the formation changes", () => {
    const s = setFormation(demoSquad(), "4-4-2");
    expect(s.formation).toBe("4-4-2");
    expect(s.slots.filter((x) => x.card)).toHaveLength(11);
    expect(getSlot(s, "LST").card?.name).toBe("Rae Whitlock");
    expect(getSlot(s, "LST").locked).toBe(true);
    expect(getSlot(s, "RCB").card?.name).toBe("Sam Odell"); // same slot name, still in position
    expect(getSlot(s, "RM").card?.name).toBe("Claire Dumont");
    const back = setFormation(s, "3-5-2");
    expect(evaluateSquad(back, R).chemistry.total).toBe(evaluateSquad(demoSquad(), R).chemistry.total);
  });

  it("swaps slots with their locks and only locks filled slots", () => {
    const s = swapSlots(demoSquad(), "LST", "RM");
    expect(getSlot(s, "RM")).toMatchObject({ locked: true, card: { name: "Rae Whitlock" } });
    expect(() => setLocked(createSquad({ formation: "3-5-2" }), "GK", true)).toThrow(/empty/);
  });

  it("previews a card across all 11, not just its slot", () => {
    const p = previewAssign(demoSquad(), "GK", DEMO_POOL.find((c) => c.name === "Gwen Rhee")!, R);
    expect(p.total_before).toBe(25);
    expect(p.total_after).toBe(30);
    expect(p.diff.changes.map((c) => c.slot)).toEqual(expect.arrayContaining(["GK", "LST", "LCDM", "LM"]));
  });

  it("keeps tactical fit separate from chemistry and configurable", () => {
    const rm = DEMO_XI.RM!;
    const attacking = fitScore(rm, "RM");
    const defensive = fitScore(rm, "RM", PRESET_PROFILES[0]);
    expect(attacking.evidence).toBe("estimate");
    expect(defensive.score).not.toBe(attacking.score);
    expect(fitScore({ ...rm, stats: undefined }, "RM").score).toBeNull();
  });
});

describe("Chemistry Surgeon", () => {
  it("explains why the striker is 2/3 with progress toward each threshold", () => {
    const d = diagnoseSlot(demoSquad(), "LST", R);
    expect(d).toMatchObject({ name: "Rae Whitlock", chemistry: 2, max: 3, in_position: true, evidence: "hypothesis" });
    const by = Object.fromEntries(d.links.map((l) => [l.type, l]));
    expect(by.nation).toMatchObject({ key: "United States", count: 4, next_threshold: 5, progress: "4 / 5 toward next threshold" });
    expect(by.league).toMatchObject({ key: "NWSL", count: 4, next_threshold: 5 });
    expect(by.nation!.contributors).toEqual(expect.arrayContaining(["Rae Whitlock", "Maya Brooks", "Jade Kessler", "Ana Duarte"]));
    expect(d.levers.join(" ")).toMatch(/NWSL.*United States.*improve 3 link groups/);
    expect(d.levers.join(" ")).toMatch(/manager matching United States nation and NWSL league/);
    expect(d.wants).toMatchObject({ nation: "United States", league: "NWSL" });
  });

  it("explains out of position", () => {
    const s = assignCard(demoSquad(), "RM", card({ positions: ["ST"], name: "Wrong Spot" }));
    const d = diagnoseSlot(s, "RM", R);
    expect(d.in_position).toBe(false);
    expect(d.summary).toMatch(/out of position/);
  });
});

describe("Squad Optimizer", () => {
  it("finds the cheapest way to get the striker to 3/3 and recalculates all 11 for every option", () => {
    const s = demoSquad();
    const r = optimizeSquad(s, { slot: "LST" }, pool, R);
    expect(r.status).toBe("solutions");
    expect(r.slot_before).toBe(2);
    const costs = r.solutions.map((x) => x.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    for (const sol of r.solutions) {
      expect(sol.slot_after).toBe(3);
      const engine = computeSquadChemistry(toSquadInput(sol.squad), R);
      expect(sol.total_after).toBe(engine.total);
      expect(sol.total_after).toBeGreaterThanOrEqual(r.total_before);
      expect(sol.evidence).toBe("hypothesis");
      // locked players are never replaced
      for (const slot of ["LST", "RST", "CAM", "LCB"]) expect(getSlot(sol.squad, slot).card!.id).toBe(getSlot(s, slot).card!.id);
      expect(sol.cost).toBeLessThanOrEqual(s.budget);
    }
    expect(r.solutions[0]!.manager_change?.to).toBe("K. Moreno (demo)");
    expect(r.solutions.some((x) => x.swaps.length >= 2)).toBe(true); // multi-swap options are searched
  });

  it("rejects a fix that helps the target but is net-negative for the squad", () => {
    // Target T is US + NWSL, one short of the next league and nation thresholds.
    // The only helper replaces the Premier League CB, which costs the PL players their league point.
    // The US/NWSL teammates already sit at 3/3 through a shared club, so they gain nothing from the helper.
    const us = (pos: string, _i: number) => card({ positions: [pos], nation: "United States", league: "NWSL", club: "USC" });
    let s = createSquad({ formation: "3-5-2", budget: 50_000 });
    const pl = (pos: string, i: number) => card({ positions: [pos], nation: `pl-n${i}`, league: "Premier League", club: `pl-c${i}` });
    const t = card({ positions: ["ST"], name: "Target", nation: "United States", league: "NWSL", club: "solo" });
    const layout: [string, WorkspaceCard][] = [
      ["GK", pl("GK", 1)], ["LCB", pl("CB", 2)], ["CB", pl("CB", 3)], ["RCB", pl("CB", 4)], ["LCDM", pl("CDM", 5)],
      ["RCDM", us("CDM", 1)], ["LM", us("LM", 2)], ["CAM", us("CAM", 3)], ["RM", card({ positions: ["RM"] })],
      ["LST", t], ["RST", card({ positions: ["ST"] })],
    ];
    for (const [slot, c] of layout) s = assignCard(s, slot, c);
    s = setLocked(s, "RM", true);
    s = setLocked(s, "RST", true);
    for (const slot of ["RCDM", "LM", "CAM"]) s = setLocked(s, slot, true);
    const helper = card({ positions: ["CB"], name: "NWSL CB", nation: "United States", league: "NWSL", club: "x", price: 1000 });
    const r = optimizeSquad(s, { slot: "LST" }, { cards: [helper] }, R, { max_swaps: 1 });
    expect(r.status).toBe("infeasible");
    expect(r.rejected[0]!.reason).toMatch(/Net loss/);
    expect(r.blockers.join(" ")).toMatch(/Net loss/);
    const allowed = optimizeSquad(s, { slot: "LST" }, { cards: [helper] }, R, { max_swaps: 1, allow_net_loss: true });
    expect(allowed.status).toBe("solutions");
    expect(allowed.solutions[0]!.total_after).toBeLessThan(allowed.total_before);
  });

  it("says which constraint blocks the goal when it is impossible", () => {
    const s = { ...demoSquad(), budget: 1000 };
    const r = optimizeSquad(s, { slot: "LST" }, { cards: DEMO_POOL.filter((c) => !c.owned) }, R, { allow_manager_change: false });
    expect(r.status).toBe("infeasible");
    expect(r.blockers.join(" ")).toMatch(/Budget: possible for 2,000 coins/);
  });

  it("reports when a locked player is the blocker", () => {
    // Only a CB fixes it, and every CB slot is locked.
    let s = demoSquad();
    for (const slot of ["CB", "RCB", "GK"]) s = setLocked(s, slot, true);
    const cb = DEMO_POOL.find((c) => c.name === "Tess Avery")!;
    const r = optimizeSquad(s, { slot: "LST" }, { cards: [cb] }, R, { allow_manager_change: false });
    expect(r.status).toBe("infeasible");
    expect(r.blockers.join(" ")).toMatch(/unlock (Ben Carrow \(CB\)|Sam Odell \(RCB\))/);
  });

  it("needs two swaps when one isn't enough", () => {
    // Target needs 2 more of its nation; no single card does it.
    let s = createSquad({ formation: "3-5-2", budget: 10_000 });
    const filler = ["GK", "LCB", "CB", "RCB", "LCDM", "RCDM", "LM", "CAM", "RM", "RST"];
    const pos: Record<string, string> = { GK: "GK", LCB: "CB", CB: "CB", RCB: "CB", LCDM: "CDM", RCDM: "CDM", LM: "LM", CAM: "CAM", RM: "RM", RST: "ST" };
    for (const sl of filler) s = assignCard(s, sl, card({ positions: [pos[sl]!], league: "L", nation: sl === "RST" || sl === "CAM" ? "Z" : `n-${sl}` }));
    s = assignCard(s, "LST", card({ positions: ["ST"], name: "Zed", league: "L", nation: "Z" }));
    // League L has 11 -> 3 points already; Zed needs nation Z count 5 (has 3) for... actually 3 already from league.
    // So set the target to a slot whose league is unique instead:
    s = assignCard(s, "LST", card({ positions: ["ST"], name: "Zed", league: "Solo", nation: "Z", club: "C" }));
    const helpers = ["CB", "CDM"].map((p) => card({ positions: [p], name: `Z ${p}`, league: "L", nation: "Z", club: "C", price: 100 }));
    const r = optimizeSquad(s, { slot: "LST" }, { cards: helpers }, R, { max_swaps: 2 });
    expect(r.status).toBe("solutions");
    expect(r.solutions[0]!.swaps).toHaveLength(2);
    const one = optimizeSquad(s, { slot: "LST" }, { cards: helpers }, R, { max_swaps: 1 });
    expect(one.status).toBe("infeasible");
    expect(one.blockers.join(" ")).toMatch(/Swaps: possible with 2 swaps/);
  });

  it("returns already_met when the player is at full chemistry", () => {
    expect(optimizeSquad(demoSquad(), { slot: "CAM" }, pool, R).status).toBe("already_met");
  });
});

describe("compare and save", () => {
  it("compares two solutions and saves one as a new squad without touching the original", async () => {
    const owner = "user-1";
    const original = demoSquad(owner);
    const store = new MemorySquadStore([original]);
    const svc = createWorkspaceService({ rules: R, store, cards: new MemoryCardSource(DEMO_POOL, DEMO_MANAGERS) });

    const diag = await svc.diagnose(owner, original.id, "LST");
    expect(diag).toMatchObject({ chemistry: 2 });
    const r = await svc.optimize(owner, original.id, { goal: { slot: "LST" } });
    expect(r.status).toBe("solutions");
    const [a, b] = r.solutions;
    const cmp = compareSquads(a!.squad, b!.squad, R, original);
    expect(cmp.a.cost).toBe(a!.cost);
    expect(cmp.b.cost).toBe(b!.cost);
    expect(cmp.rows).toHaveLength(11);
    expect(cmp.verdict.length).toBeGreaterThan(0);

    const saved = await svc.saveSquadAs(owner, b!.squad, "Wilson fix B");
    expect(saved.id).not.toBe(original.id);
    expect(saved.parent_id).toBe(original.id);
    const list = await svc.listSquads(owner);
    expect(list).toHaveLength(2);
    expect(evaluateSquad((await svc.getSquad(owner, original.id))!, R).chemistry.total).toBe(25);
    await expect(svc.getSquad("someone-else", original.id)).rejects.toThrow(/No squad/);
    await expect(svc.saveSquad("someone-else", original)).rejects.toThrow(/owner/);
  });

  it("validates squads coming from outside", async () => {
    const svc = createWorkspaceService({ rules: R, store: new MemorySquadStore(), cards: new MemoryCardSource([]) });
    await expect(svc.calculateChemistry("u", { name: "bad" })).rejects.toThrow();
    const ok = await svc.calculateChemistry("local", demoSquad());
    expect(ok.chemistry.total).toBe(25);
  });
});
