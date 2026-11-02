// Side-by-side comparison of two squads (usually two optimizer solutions) against an optional base squad.
import type { ChemistryRules } from "../chemistry/index.js";
import { costBetween, evaluateSquad } from "./squad.js";
import type { Provenance, Squad } from "./types.js";

export interface CompareRow {
  slot: string;
  position: string;
  a: { name: string | null; chemistry: number; fit: number | null };
  b: { name: string | null; chemistry: number; fit: number | null };
  same_player: boolean;
}

export interface SquadComparison extends Provenance {
  a: { id: string; name: string; total: number; fit: number | null; cost: number | null; manager: string | null };
  b: { id: string; name: string; total: number; fit: number | null; cost: number | null; manager: string | null };
  max: number;
  rows: CompareRow[];
  /** Plain-language trade-offs, from the numbers above only. */
  verdict: string[];
}

export function compareSquads(a: Squad, b: Squad, rules: ChemistryRules, base?: Squad): SquadComparison {
  const ea = evaluateSquad(a, rules);
  const eb = evaluateSquad(b, rules);
  const chem = (ev: typeof ea, slot: string) => ev.chemistry.players.find((p) => p.slot === slot)?.chemistry ?? 0;
  const slots = [...new Set([...a.slots.map((s) => s.slot), ...b.slots.map((s) => s.slot)])];
  const rows: CompareRow[] = slots.map((slot) => {
    const sa = a.slots.find((s) => s.slot === slot);
    const sb = b.slots.find((s) => s.slot === slot);
    return {
      slot,
      position: sa?.position ?? sb?.position ?? "",
      a: { name: sa?.card?.name ?? null, chemistry: chem(ea, slot), fit: ea.fit.slots[slot]?.score ?? null },
      b: { name: sb?.card?.name ?? null, chemistry: chem(eb, slot), fit: eb.fit.slots[slot]?.score ?? null },
      same_player: !!sa?.card && sa.card.id === sb?.card?.id,
    };
  });
  const ca = base ? costBetween(base, a).total : null;
  const cb = base ? costBetween(base, b).total : null;
  const verdict: string[] = [];
  const dt = eb.chemistry.total - ea.chemistry.total;
  verdict.push(dt === 0 ? `Same team chemistry (${ea.chemistry.total}).` : `${dt > 0 ? b.name : a.name} has ${Math.abs(dt)} more team chemistry.`);
  if (ca !== null && cb !== null && ca !== cb) verdict.push(`${ca < cb ? a.name : b.name} is ${Math.abs(ca - cb).toLocaleString("en-US")} coins cheaper.`);
  if (ea.fit.average !== null && eb.fit.average !== null && ea.fit.average !== eb.fit.average)
    verdict.push(`${ea.fit.average > eb.fit.average ? a.name : b.name} has the better tactical fit estimate (${Math.max(ea.fit.average, eb.fit.average)} vs ${Math.min(ea.fit.average, eb.fit.average)}).`);
  const changed = rows.filter((r) => !r.same_player).length;
  verdict.push(`${changed} of ${rows.length} slots differ.`);
  return {
    rule_version: ea.rule_version,
    rule_status: ea.rule_status,
    engine_version: ea.engine_version,
    evidence: ea.evidence,
    a: { id: a.id, name: a.name, total: ea.chemistry.total, fit: ea.fit.average, cost: ca, manager: a.manager?.name ?? null },
    b: { id: b.id, name: b.name, total: eb.chemistry.total, fit: eb.fit.average, cost: cb, manager: b.manager?.name ?? null },
    max: ea.chemistry.max,
    rows,
    verdict,
  };
}
