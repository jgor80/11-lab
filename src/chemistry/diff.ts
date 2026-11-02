// "Who gains or loses chemistry, and why" when a squad changes.
import { computeSquadChemistry } from "./engine.js";
import { LINK_TYPES, type ChemistryRules } from "./rules.js";
import type { SquadCard, SquadChemistryResult, SquadInput } from "./types.js";

export interface SlotChange {
  slot: string;
  name_before: string | null;
  name_after: string | null;
  before: number;
  after: number;
  delta: number;
  reasons: string[];
}

export interface SquadChemistryDiff {
  total_before: number;
  total_after: number;
  delta: number;
  /** Only slots whose chemistry or occupant changed. */
  changes: SlotChange[];
}

export function diffSquadChemistry(before: SquadChemistryResult, after: SquadChemistryResult): SquadChemistryDiff {
  const b = new Map(before.players.map((p) => [p.slot, p]));
  const a = new Map(after.players.map((p) => [p.slot, p]));
  const slots = [...new Set([...b.keys(), ...a.keys()])];
  const changes: SlotChange[] = [];
  for (const slot of slots) {
    const pb = b.get(slot);
    const pa = a.get(slot);
    const reasons: string[] = [];
    if (pb?.name !== pa?.name) {
      reasons.push(pa ? (pb ? `${pb.name} replaced by ${pa.name}` : `${pa.name} added`) : `${pb!.name} removed`);
    } else if (pb && pa) {
      for (const t of LINK_TYPES) {
        const x = pb.breakdown[t];
        const y = pa.breakdown[t];
        if (x.points !== y.points) {
          reasons.push(`${t} ${y.key ?? "?"}: ${x.count} -> ${y.count} sharing, ${x.points} -> ${y.points} pts`);
        }
      }
      if (pb.manager_bonus !== pa.manager_bonus) reasons.push(`manager bonus ${pb.manager_bonus} -> ${pa.manager_bonus}`);
      if (pb.in_position !== pa.in_position) reasons.push(pa.in_position ? "now in position" : "now out of position");
    }
    const before_ = pb?.chemistry ?? 0;
    const after_ = pa?.chemistry ?? 0;
    if (before_ !== after_ || pb?.name !== pa?.name) {
      if (before_ !== after_ && reasons.length === 0) reasons.push("link points unchanged but the cap now applies differently");
      changes.push({
        slot,
        name_before: pb?.name ?? null,
        name_after: pa?.name ?? null,
        before: before_,
        after: after_,
        delta: after_ - before_,
        reasons,
      });
    }
  }
  return { total_before: before.total, total_after: after.total, delta: after.total - before.total, changes };
}

/** Put `card` in `slot` (or empty it with null) and report what changes across the squad. */
export function previewSwap(input: SquadInput, slot: string, card: SquadCard | null, rules: ChemistryRules) {
  const idx = input.slots.findIndex((s) => s.slot.trim().toUpperCase() === slot.trim().toUpperCase());
  if (idx < 0) throw new Error(`No slot "${slot}" in the squad`);
  const slots = input.slots
    .map((s, i) => (i === idx ? (card ? { ...s, card } : null) : s))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const before = computeSquadChemistry(input, rules);
  const after = computeSquadChemistry({ ...input, slots }, rules);
  return { before, after, diff: diffSquadChemistry(before, after) };
}
