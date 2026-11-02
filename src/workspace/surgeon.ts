// Chemistry Surgeon: explains a slot's chemistry from the engine's breakdown. It never computes links itself.
import { LINK_TYPES, isInPosition, type ChemistryRules, type LinkType } from "../chemistry/index.js";
import { evaluateSquad, getSlot, toSquadInput, type SquadEvaluation } from "./squad.js";
import type { Provenance, Squad } from "./types.js";

const LABEL: Record<LinkType, string> = { club: "Club", league: "League", nation: "Nationality" };
const norm = (s: string | null | undefined) => s?.trim().toLowerCase() || null;

export interface LinkDiagnosis {
  type: LinkType;
  label: string;
  key: string | null;
  /** Weighted count toward this key (Icons, Heroes and some manager rules can add more than 1). */
  count: number;
  points: number;
  max_points: number;
  next_threshold: number | null;
  needed_for_next: number | null;
  /** In-position teammates (including this player) counted for this key. */
  contributors: string[];
  /** e.g. "4 / 5 toward next threshold" */
  progress: string;
}

export interface SlotDiagnosis extends Provenance {
  slot: string;
  position: string;
  name: string | null;
  locked: boolean;
  chemistry: number;
  max: number;
  in_position: boolean;
  links: LinkDiagnosis[];
  manager_bonus: number;
  /** One-line answer to "why is she at 2/3?" */
  summary: string;
  /** Concrete changes that could raise this player's chemistry. Each one still needs a full-squad check. */
  levers: string[];
  /** What a helpful incoming player would share with this one; the optimizer uses it to prune candidates. */
  wants: Partial<Record<LinkType, string>>;
  caveat: string;
}

export function diagnoseSlot(squad: Squad, slot: string, rules: ChemistryRules, evaluation?: SquadEvaluation): SlotDiagnosis {
  const s = getSlot(squad, slot);
  const ev = evaluation ?? evaluateSquad(squad, rules);
  const prov: Provenance = { rule_version: ev.rule_version, rule_status: ev.rule_status, engine_version: ev.engine_version, evidence: ev.evidence };
  const max = rules.modifiers["player.max_chemistry"] ?? 3;
  const caveat = "Any swap also changes other players' links, so every suggestion is re-checked across all 11 before it is shown.";
  if (!s.card) {
    return { ...prov, slot: s.slot, position: s.position, name: null, locked: false, chemistry: 0, max, in_position: false, links: [], manager_bonus: 0, summary: "Empty slot.", levers: [], wants: {}, caveat };
  }
  const p = ev.chemistry.players.find((x) => x.slot === s.slot)!;
  const inPos = toSquadInput(squad).slots.filter(isInPosition);
  const links: LinkDiagnosis[] = LINK_TYPES.map((t) => {
    const b = p.breakdown[t];
    const key = norm(b.key);
    const contributors = key ? inPos.filter((x) => norm(x.card[t]) === key).map((x) => x.card.name) : [];
    const mgrKey = t === "nation" ? norm(squad.manager?.nation) : t === "league" ? norm(squad.manager?.league) : null;
    const mgrCount = t === "nation" ? rules.modifiers["manager.nation_count"] ?? 0 : t === "league" ? rules.modifiers["manager.league_count"] ?? 0 : 0;
    if (key && mgrCount && mgrKey === key) contributors.push(`${squad.manager!.name} (manager, +${mgrCount})`);
    return {
      type: t,
      label: LABEL[t],
      key: b.key,
      count: b.count,
      points: b.points,
      max_points: rules.thresholds[t].length,
      next_threshold: b.next_threshold,
      needed_for_next: b.needed_for_next,
      contributors,
      progress: b.key === null ? "not entered" : b.next_threshold === null ? `${b.count} (top threshold reached)` : `${b.count} / ${b.next_threshold} toward next threshold`,
    };
  });

  const levers: string[] = [];
  const wants: Partial<Record<LinkType, string>> = {};
  const gap = max - p.chemistry;
  let summary: string;
  if (!p.in_position) {
    summary = `${s.card.name} is out of position: ${s.slot} needs ${s.position} and the card plays ${s.card.positions.join("/") || "nothing entered"}, so 0 chemistry and no links for teammates.`;
    levers.push(`Move ${s.card.name} to a ${s.card.positions.join("/")} slot, or put a ${s.position} in ${s.slot}.`);
  } else if (gap <= 0) {
    summary = `${s.card.name} is at full chemistry (${p.chemistry}/${max}).`;
  } else {
    const parts = links.filter((l) => l.key).map((l) => `${l.label.toLowerCase()} ${l.points}`);
    if (p.manager_bonus) parts.push(`manager +${p.manager_bonus}`);
    summary = `${s.card.name} is at ${p.chemistry}/${max}: ${parts.join(", ")}.`;
    const close = links.filter((l) => l.key && l.needed_for_next !== null).sort((a, b) => a.needed_for_next! - b.needed_for_next!);
    for (const l of close) {
      levers.push(`${l.needed_for_next} more in-position ${l.key} ${l.type === "nation" ? "player" : `${l.type} player`}${l.needed_for_next === 1 ? "" : "s"} would reach ${l.next_threshold} and add a ${l.label.toLowerCase()} point.`);
      if (l.needed_for_next! <= 2) wants[l.type] = l.key!;
    }
    const one = close.filter((l) => l.needed_for_next === 1);
    if (one.length >= 2) {
      const desc = one.map((l) => (l.type === "nation" ? l.key : `${l.key} (${l.type})`)).join(" + ");
      levers.unshift(`One in-position player who is ${desc} would improve ${one.length} link groups at once.`);
    }
    const bonus = rules.modifiers["manager.bonus"] ?? 0;
    if (bonus > 0 && p.manager_bonus === 0) {
      const m = [s.card.nation, s.card.league].filter(Boolean).join(" or ");
      if (m) levers.push(`A manager from ${m} would add +${bonus} (rule version ${rules.id}: manager.bonus).`);
    }
    // Rule versions where the manager counts toward links instead (fc27-community-v1).
    const mParts: string[] = [];
    for (const t of ["nation", "league"] as const) {
      const c = rules.modifiers[`manager.${t}_count`] ?? 0;
      const l = links.find((x) => x.type === t)!;
      const already = norm(t === "nation" ? squad.manager?.nation : squad.manager?.league) === norm(l.key);
      if (c && l.key && !already && l.needed_for_next !== null && l.needed_for_next <= c) mParts.push(`${l.key} ${t}`);
    }
    if (mParts.length) levers.push(`A manager matching ${mParts.join(" and ")} would count toward ${mParts.length === 2 ? "both thresholds" : "that threshold"} (rule version ${rules.id}: the manager adds to link counts).`);
  }
  return {
    ...prov,
    slot: s.slot,
    position: s.position,
    name: s.card.name,
    locked: s.locked,
    chemistry: p.chemistry,
    max,
    in_position: p.in_position,
    links,
    manager_bonus: p.manager_bonus,
    summary,
    levers,
    wants,
    caveat,
  };
}

/** Squad-level view: who is below max, worst first. */
export function diagnoseSquad(squad: Squad, rules: ChemistryRules) {
  const ev = evaluateSquad(squad, rules);
  const below = squad.slots
    .filter((s) => s.card)
    .map((s) => diagnoseSlot(squad, s.slot, rules, ev))
    .filter((d) => d.chemistry < d.max)
    .sort((a, b) => a.chemistry - b.chemistry);
  return {
    rule_version: ev.rule_version,
    rule_status: ev.rule_status,
    engine_version: ev.engine_version,
    evidence: ev.evidence,
    total: ev.chemistry.total,
    max: ev.chemistry.max,
    below_max: below.map((d) => ({ slot: d.slot, name: d.name, chemistry: d.chemistry, summary: d.summary })),
    warnings: ev.chemistry.warnings,
  };
}
