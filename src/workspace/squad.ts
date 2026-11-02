// Pure, immutable squad operations. Every function returns a new Squad.
import { computeSquadChemistry, diffSquadChemistry, ENGINE_VERSION, type ChemistryRules, type SquadChemistryResult, type SquadInput } from "../chemistry/index.js";
import { fitScore, type FitProfile, type FitScore } from "./fit.js";
import { formationSlots } from "./formations.js";
import type { Manager, Provenance, Squad, WorkspaceCard, WorkspaceSlot } from "./types.js";

export class SquadError extends Error {}

const now = () => new Date().toISOString();
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const normName = (s: string) => s.trim().toLowerCase();

export function newId(prefix = "sq"): string {
  const r = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${r}`;
}

export function createSquad(opts: { formation: string; name?: string; owner_id?: string; budget?: number; id?: string }): Squad {
  const t = now();
  return {
    id: opts.id ?? newId(),
    owner_id: opts.owner_id ?? "local",
    name: opts.name ?? `My ${opts.formation}`,
    formation: opts.formation,
    manager: null,
    slots: formationSlots(opts.formation).map((s) => ({ slot: s.slot, position: s.position, card: null, locked: false })),
    budget: opts.budget ?? 0,
    created_at: t,
    updated_at: t,
  };
}

function slotIndex(squad: Squad, slot: string): number {
  const i = squad.slots.findIndex((s) => same(s.slot, slot));
  if (i < 0) throw new SquadError(`No slot "${slot}" in ${squad.formation}`);
  return i;
}

export function getSlot(squad: Squad, slot: string): WorkspaceSlot {
  return squad.slots[slotIndex(squad, slot)]!;
}

const touch = (squad: Squad, slots: WorkspaceSlot[], patch: Partial<Squad> = {}): Squad => ({ ...squad, ...patch, slots, updated_at: now() });

/** Put a card in a slot. Refuses a card already used elsewhere, or a second version of the same player. */
export function assignCard(squad: Squad, slot: string, card: WorkspaceCard | null): Squad {
  const i = slotIndex(squad, slot);
  if (card) {
    for (const [j, s] of squad.slots.entries()) {
      if (j === i || !s.card) continue;
      if (s.card.id === card.id) throw new SquadError(`${card.name} is already in ${s.slot}`);
      if (normName(s.card.name) === normName(card.name)) throw new SquadError(`A version of ${card.name} is already in ${s.slot}`);
    }
  }
  return touch(squad, squad.slots.map((s, j) => (j === i ? { ...s, card, locked: card ? s.locked : false } : s)));
}

/** Swap the cards (and their locks) in two slots. */
export function swapSlots(squad: Squad, a: string, b: string): Squad {
  const i = slotIndex(squad, a);
  const j = slotIndex(squad, b);
  const si = squad.slots[i]!;
  const sj = squad.slots[j]!;
  return touch(
    squad,
    squad.slots.map((s, k) => (k === i ? { ...s, card: sj.card, locked: sj.locked } : k === j ? { ...s, card: si.card, locked: si.locked } : s)),
  );
}

export function setLocked(squad: Squad, slot: string, locked: boolean): Squad {
  const i = slotIndex(squad, slot);
  if (locked && !squad.slots[i]!.card) throw new SquadError(`Slot ${slot} is empty; there is nobody to lock`);
  return touch(squad, squad.slots.map((s, j) => (j === i ? { ...s, locked } : s)));
}

export function setManager(squad: Squad, manager: Manager | null): Squad {
  return touch(squad, squad.slots, { manager });
}

/**
 * Change formation, keeping every card. Cards stay in a slot with the same name if there is one,
 * then go to a free slot their card can play, then to whatever is left (out of position).
 */
export function setFormation(squad: Squad, formation: string): Squad {
  const target = formationSlots(formation).map((s) => ({ slot: s.slot, position: s.position, card: null as WorkspaceCard | null, locked: false }));
  const pending = squad.slots.filter((s) => s.card);
  const place = (pick: (t: WorkspaceSlot, s: WorkspaceSlot) => boolean) => {
    for (const s of [...pending]) {
      const t = target.find((t) => !t.card && pick(t, s));
      if (t) {
        t.card = s.card;
        t.locked = s.locked;
        pending.splice(pending.indexOf(s), 1);
      }
    }
  };
  place((t, s) => same(t.slot, s.slot) && s.card!.positions.some((p) => same(p, t.position)));
  place((t, s) => s.card!.positions.some((p) => same(p, t.position)));
  place((t, s) => same(t.slot, s.slot));
  place(() => true);
  return touch(squad, target, { formation });
}

/** The engine's input: filled slots only, plus the manager. */
export function toSquadInput(squad: Squad): SquadInput {
  return {
    formation: squad.formation,
    ...(squad.manager ? { manager: { nation: squad.manager.nation ?? undefined, league: squad.manager.league ?? undefined } } : {}),
    slots: squad.slots.filter((s) => s.card).map((s) => ({ slot: s.slot, position: s.position, card: s.card! })),
  };
}

export function provenanceOf(chem: SquadChemistryResult): Provenance {
  return { rule_version: chem.rule_version, rule_status: chem.rule_status, engine_version: chem.engine_version, evidence: chem.evidence };
}

export interface SquadEvaluation extends Provenance {
  chemistry: SquadChemistryResult;
  /** Tactical fit per slot: a separate, configurable estimate. Not chemistry. */
  fit: { slots: Record<string, FitScore>; average: number | null; evidence: "estimate" };
  filled: number;
  size: number;
}

export function evaluateSquad(squad: Squad, rules: ChemistryRules, profiles: Record<string, FitProfile> = {}): SquadEvaluation {
  const chemistry = computeSquadChemistry(toSquadInput(squad), rules);
  const slots: Record<string, FitScore> = {};
  const scores: number[] = [];
  for (const s of squad.slots) {
    const f = fitScore(s.card, s.position, profiles[s.slot]);
    slots[s.slot] = f;
    if (s.card && f.score !== null) scores.push(f.score);
  }
  return {
    ...provenanceOf(chemistry),
    chemistry,
    fit: { slots, average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, evidence: "estimate" },
    filled: squad.slots.filter((s) => s.card).length,
    size: squad.slots.length,
  };
}

/** Coins needed to turn `from` into `to`: incoming cards and manager that aren't owned. */
export function costBetween(from: Squad, to: Squad): { total: number; buy: { name: string; price: number; slot?: string }[]; unknown_price: string[] } {
  const have = new Set(from.slots.flatMap((s) => (s.card ? [s.card.id] : [])));
  const buy: { name: string; price: number; slot?: string }[] = [];
  const unknown: string[] = [];
  for (const s of to.slots) {
    if (!s.card || have.has(s.card.id) || s.card.owned) continue;
    if (typeof s.card.price === "number") buy.push({ name: s.card.name, price: s.card.price, slot: s.slot });
    else unknown.push(s.card.name);
  }
  if (to.manager && to.manager.id !== from.manager?.id && !to.manager.owned) {
    if (typeof to.manager.price === "number") buy.push({ name: `${to.manager.name} (manager)`, price: to.manager.price });
    else unknown.push(`${to.manager.name} (manager)`);
  }
  return { total: buy.reduce((a, b) => a + b.price, 0), buy, unknown_price: unknown };
}

export { ENGINE_VERSION };

/** Preview putting a card in a slot: full-squad before/after, using the engine's diff. Doesn't change the squad. */
export function previewAssign(squad: Squad, slot: string, card: WorkspaceCard | null, rules: ChemistryRules) {
  const before = evaluateSquad(squad, rules);
  const nextSquad = assignCard(squad, slot, card);
  const after = evaluateSquad(nextSquad, rules);
  return {
    ...provenanceOf(after.chemistry),
    total_before: before.chemistry.total,
    total_after: after.chemistry.total,
    diff: diffSquadChemistry(before.chemistry, after.chemistry),
    fit_before: before.fit.slots[getSlot(squad, slot).slot]?.score ?? null,
    fit_after: after.fit.slots[getSlot(squad, slot).slot]?.score ?? null,
  };
}
