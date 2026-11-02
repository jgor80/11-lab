// Deterministic chemistry engine. Pure: same input + same rule version = same output.
// Every number comes from the rule version; nothing about thresholds or bonuses is hardcoded here.
import { LINK_TYPES, mod, nextThreshold, pointsFor, validateRules, type ChemistryRules, type LinkType } from "./rules.js";
import type { LinkBreakdown, PlayerChemistry, SquadChemistryResult, SquadInput, SquadSlot } from "./types.js";

/** Bump when the engine's interpretation of a rule changes, so stored results can be traced. */
export const ENGINE_VERSION = "chem-engine-1";

export class SquadInputError extends Error {}

const norm = (s: string | null | undefined): string | null => {
  const t = s?.trim().toLowerCase();
  return t ? t : null;
};
const normPos = (s: string) => s.trim().toUpperCase();

function cardKey(slot: SquadSlot, type: LinkType): string | null {
  return norm(slot.card[type]);
}

export function isInPosition(slot: SquadSlot): boolean {
  const want = normPos(slot.position);
  return slot.card.positions.some((p) => normPos(p) === want);
}

function validateInput(input: SquadInput, size: number): string[] {
  const warnings: string[] = [];
  if (input.slots.length > size) throw new SquadInputError(`A squad has at most ${size} players, got ${input.slots.length}`);
  const seen = new Set<string>();
  for (const s of input.slots) {
    const k = normPos(s.slot);
    if (seen.has(k)) throw new SquadInputError(`Slot "${s.slot}" is used twice`);
    seen.add(k);
    if (!s.position?.trim()) throw new SquadInputError(`Slot "${s.slot}" has no position`);
    if (!s.card.positions?.length) warnings.push(`${s.card.name} has no positions entered, so counts as out of position`);
  }
  const names = new Map<string, number>();
  for (const s of input.slots) names.set(norm(s.card.name) ?? "", (names.get(norm(s.card.name) ?? "") ?? 0) + 1);
  for (const [n, c] of names) if (n && c > 1) warnings.push(`"${n}" appears ${c} times; the game allows one version of a player per squad`);
  if (input.slots.length < size) warnings.push(`Only ${input.slots.length} of ${size} slots filled`);
  return warnings;
}

export function computeSquadChemistry(input: SquadInput, rules: ChemistryRules): SquadChemistryResult {
  const warnings = validateRules(rules);
  const size = mod(rules, "squad.size") || 11;
  warnings.push(...validateInput(input, size));
  const maxPerPlayer = mod(rules, "player.max_chemistry");

  // Only players in position contribute to counts.
  const contributors = input.slots.filter(isInPosition);
  const counts: Record<LinkType, Map<string, number>> = { club: new Map(), league: new Map(), nation: new Map() };
  const add = (t: LinkType, key: string | null, n: number) => {
    if (key === null || n === 0) return;
    counts[t].set(key, (counts[t].get(key) ?? 0) + n);
  };

  for (const s of contributors) {
    const icon = !!s.card.is_icon;
    const hero = !!s.card.is_hero;
    add("club", cardKey(s, "club"), 1);
    add("league", cardKey(s, "league"), 1 + (icon ? mod(rules, "icon.league_bonus") : 0) + (hero ? mod(rules, "hero.league_bonus") : 0));
    add("nation", cardKey(s, "nation"), 1 + (icon ? mod(rules, "icon.nation_bonus") : 0) + (hero ? mod(rules, "hero.nation_bonus") : 0));
  }

  // An Icon adds to every other league present among in-position non-Icons.
  const everyLeague = mod(rules, "icon.every_league_bonus");
  if (everyLeague) {
    const otherLeagues = new Set(contributors.filter((s) => !s.card.is_icon).map((s) => cardKey(s, "league")));
    for (const icon of contributors.filter((s) => s.card.is_icon)) {
      const own = cardKey(icon, "league");
      for (const l of otherLeagues) if (l !== own) add("league", l, everyLeague);
    }
  }

  const mgrNation = norm(input.manager?.nation);
  const mgrLeague = norm(input.manager?.league);
  add("nation", mgrNation, mod(rules, "manager.nation_count"));
  add("league", mgrLeague, mod(rules, "manager.league_count"));

  const players: PlayerChemistry[] = input.slots.map((s) => {
    const inPos = isInPosition(s);
    const notes: string[] = [];
    const breakdown = {} as Record<LinkType, LinkBreakdown>;
    const links = {} as Record<LinkType, number>;
    for (const t of LINK_TYPES) {
      const key = cardKey(s, t);
      const count = key === null ? 0 : counts[t].get(key) ?? 0;
      const points = inPos && key !== null ? pointsFor(rules.thresholds[t], count) : 0;
      const next = key === null ? null : nextThreshold(rules.thresholds[t], count);
      breakdown[t] = {
        key: s.card[t]?.trim() || null,
        count,
        points,
        next_threshold: next,
        needed_for_next: next === null ? null : next - count,
      };
      links[t] = points;
      if (key === null) notes.push(`No ${t} entered, so no ${t} links`);
    }

    let managerBonus = 0;
    const bonus = mod(rules, "manager.bonus");
    if (inPos && bonus) {
      const by = [
        mgrNation !== null && mgrNation === cardKey(s, "nation") ? "nation" : null,
        mgrLeague !== null && mgrLeague === cardKey(s, "league") ? "league" : null,
      ].filter(Boolean);
      if (by.length) {
        managerBonus = bonus;
        notes.push(`Manager bonus +${bonus} (matches manager ${by.join(" and ")})`);
      }
    }

    let chemistry = 0;
    if (!inPos) {
      notes.push(`Out of position: ${s.slot} needs ${normPos(s.position)}, card plays ${s.card.positions.map(normPos).join("/") || "nothing"}. 0 chemistry and adds no links`);
    } else {
      const raw = links.club + links.league + links.nation + managerBonus;
      const alwaysMax =
        (s.card.is_icon && mod(rules, "icon.always_max") === 1) || (s.card.is_hero && mod(rules, "hero.always_max") === 1);
      if (alwaysMax) {
        chemistry = maxPerPlayer;
        notes.push(`${s.card.is_icon ? "Icon" : "Hero"} in position: always max chemistry under this rule version`);
      } else {
        chemistry = Math.min(raw, maxPerPlayer);
        if (raw > maxPerPlayer) notes.push(`Capped at ${maxPerPlayer} (links add up to ${raw})`);
      }
    }

    return {
      slot: s.slot,
      ...(s.card.id !== undefined ? { card_id: s.card.id } : {}),
      name: s.card.name,
      chemistry,
      in_position: inPos,
      links,
      manager_bonus: managerBonus,
      breakdown,
      notes,
    };
  });

  const total = players.reduce((a, p) => a + p.chemistry, 0);
  const max = maxPerPlayer * size;
  const verified = rules.status === "verified";
  if (!verified) warnings.push(`Rule version ${rules.id} is ${rules.status}: chemistry is not confirmed against the game`);

  return {
    engine_version: ENGINE_VERSION,
    rule_version: rules.id,
    rule_status: rules.status,
    formation: input.formation,
    total,
    max,
    full_chemistry_verified: verified && total === max,
    players,
    warnings,
    evidence: verified ? "verified" : "hypothesis",
  };
}
