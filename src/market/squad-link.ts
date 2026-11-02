// "Compare in My Squad": a market card against the user's saved squad, through the Squad Builder's own engines.
// Locked players are never replaced, owned cards cost nothing, and chemistry comes from the chemistry engine.
import type { ChemistryRules } from "../chemistry/index.js";
import { evaluateSquad, previewAssign, type Squad } from "../workspace/index.js";
import type { SignalAssessment } from "./signals.js";
import type { MarketCard } from "./types.js";

export interface SquadSlotOption {
  slot: string;
  position: string;
  replaces: string | null;
  chemistry_before: number;
  chemistry_after: number;
  chemistry_delta: number;
  /** Players whose chemistry changes, with the engine's reasons. */
  changes: { slot: string; name: string | null; delta: number; reasons: string[] }[];
  fit_before: number | null;
  fit_after: number | null;
  fit_delta: number | null;
}

export interface SquadComparison {
  card_id: string;
  squad_id: string;
  already_in_squad: string | null;
  owned: boolean;
  /** Coins to get it: 0 if owned, latest fresh price otherwise, null if unknown. */
  cost: number | null;
  options: SquadSlotOption[];
  skipped_locked: { slot: string; player: string | null }[];
  no_eligible_slot: boolean;
  /** One plain sentence combining squad fit and market context. Built from the numbers, not generated. */
  summary: string;
  rule_version: string;
  evidence: { chemistry: "hypothesis" | "verified"; fit: "estimate"; market: "estimate" };
}

export function compareInSquad(
  squad: Squad,
  card: MarketCard,
  rules: ChemistryRules,
  market: { latest_price: number | null; assessment: SignalAssessment | null },
): SquadComparison {
  const present = squad.slots.find((s) => s.card?.id === card.id);
  const owned = !!card.owned;
  const cost = owned ? 0 : market.latest_price;
  const options: SquadSlotOption[] = [];
  const skipped_locked: SquadComparison["skipped_locked"] = [];
  const baseTotal = evaluateSquad(squad, rules).chemistry.total;
  const eligible = squad.slots.filter((s) => card.positions.some((p) => p.toUpperCase() === s.position.toUpperCase()));
  for (const s of eligible) {
    if (s.card?.id === card.id) continue;
    if (s.locked) {
      skipped_locked.push({ slot: s.slot, player: s.card?.name ?? null });
      continue;
    }
    // If the card is already elsewhere in the XI, moving it would empty that slot; compare a move honestly.
    let base = squad;
    if (present) base = { ...squad, slots: squad.slots.map((x) => (x.slot === present.slot ? { ...x, card: null } : x)) };
    const p = previewAssign(base, s.slot, { ...card, price: cost }, rules);
    const before = baseTotal;
    options.push({
      slot: s.slot,
      position: s.position,
      replaces: s.card?.name ?? null,
      chemistry_before: before,
      chemistry_after: p.total_after,
      chemistry_delta: p.total_after - before,
      changes: p.diff.changes.map((c) => ({ slot: c.slot, name: c.name_after ?? c.name_before, delta: c.delta, reasons: c.reasons })),
      fit_before: p.fit_before,
      fit_after: p.fit_after,
      fit_delta: p.fit_before === null || p.fit_after === null ? null : p.fit_after - p.fit_before,
    });
  }
  options.sort((a, b) => b.chemistry_delta - a.chemistry_delta || (b.fit_delta ?? -99) - (a.fit_delta ?? -99));
  const rule_status = (options[0] && rules.status === "verified" ? "verified" : "hypothesis") as "verified" | "hypothesis";
  return {
    card_id: card.id,
    squad_id: squad.id,
    already_in_squad: present?.slot ?? null,
    owned,
    cost,
    options,
    skipped_locked,
    no_eligible_slot: eligible.length === 0,
    summary: summarize(card, options, skipped_locked.length, owned, cost, market.assessment),
    rule_version: rules.id,
    evidence: { chemistry: rule_status, fit: "estimate", market: "estimate" },
  };
}

function summarize(card: MarketCard, options: SquadSlotOption[], locked: number, owned: boolean, cost: number | null, a: SignalAssessment | null): string {
  if (!options.length) return locked ? `${card.name} only fits slots you've locked.` : `${card.name} can't play any position in this formation.`;
  const best = options[0]!;
  const fit = best.fit_delta ?? 0;
  const upgrade = best.chemistry_delta >= 0 && fit >= 3;
  const where = best.replaces ? `for ${best.replaces} at ${best.slot}` : `at ${best.slot}`;
  const chem = best.chemistry_delta === 0 ? "keeps team chemistry" : `${best.chemistry_delta > 0 ? "adds" : "costs"} ${Math.abs(best.chemistry_delta)} team chemistry`;
  const fitTxt = best.fit_delta === null ? "" : `, fit estimate ${fit >= 0 ? "+" : ""}${fit}`;
  let s = `${card.name} ${where} ${chem}${fitTxt}.`;
  if (owned) return `${s} You already own it.`;
  if (cost === null) return `${s} No current price, so the cost can't be judged.`;
  if (a && (a.status === "overheated" || a.entry_risk.elevated))
    s += upgrade
      ? " It's a meaningful upgrade, but its recent price rise makes waiting or an alternative worth considering."
      : " Its recent price rise adds entry risk.";
  else if (a?.status === "elevated_risk") s += " Its price trend shows downside risk.";
  else if (!upgrade) s += " Not a clear upgrade on fit and chemistry.";
  return s;
}
