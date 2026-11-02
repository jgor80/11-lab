// Chemistry rule version as plain data. No DB or Node imports: this module runs in a Cloudflare Worker too.

export type LinkType = "club" | "league" | "nation";
export const LINK_TYPES: readonly LinkType[] = ["club", "league", "nation"];

export interface ChemistryRules {
  id: string;
  season: string;
  status: "unverified" | "verified" | "retired";
  /** thresholds.club = [2, 4, 7] means 2 players -> 1 point, 4 -> 2, 7 -> 3 */
  thresholds: Record<LinkType, number[]>;
  modifiers: Record<string, number>;
}

/**
 * Modifier keys this engine understands. Anything else in a rule version is reported as a warning,
 * so a new rule never gets silently ignored.
 *
 * Required: player.max_chemistry.
 * Optional (missing = 0):
 *   manager.bonus           direct chemistry for a player matching the manager's nation or league
 *   manager.nation_count    extra count the manager adds to their nation (alternative reading)
 *   manager.league_count    extra count the manager adds to their league (alternative reading)
 *   icon.nation_bonus       extra nation count an Icon adds, on top of its normal 1
 *   icon.every_league_bonus count an Icon adds to every other league in the XI
 *   icon.league_bonus       extra count an Icon adds to its own league
 *   icon.always_max         1 = an in-position Icon always has max chemistry
 *   hero.league_bonus       extra league count a Hero adds
 *   hero.nation_bonus       extra nation count a Hero adds
 *   hero.always_max         1 = an in-position Hero always has max chemistry
 *   squad.size              players counted towards the team maximum (default 11)
 */
export const KNOWN_MODIFIERS = [
  "player.max_chemistry",
  "manager.bonus",
  "manager.nation_count",
  "manager.league_count",
  "icon.nation_bonus",
  "icon.every_league_bonus",
  "icon.league_bonus",
  "icon.always_max",
  "hero.league_bonus",
  "hero.nation_bonus",
  "hero.always_max",
  "squad.size",
] as const;

export class RulesError extends Error {}

export function mod(rules: ChemistryRules, key: (typeof KNOWN_MODIFIERS)[number]): number {
  return rules.modifiers[key] ?? 0;
}

/** Checks a rule version is complete enough to compute with. Returns warnings for things it can't use. */
export function validateRules(rules: ChemistryRules): string[] {
  const max = rules.modifiers["player.max_chemistry"];
  if (max === undefined || !Number.isInteger(max) || max < 1) {
    throw new RulesError(`Rule version ${rules.id} has no valid player.max_chemistry`);
  }
  for (const t of LINK_TYPES) {
    const th = rules.thresholds[t];
    if (!th || th.length === 0) throw new RulesError(`Rule version ${rules.id} has no ${t} thresholds`);
    for (let i = 1; i < th.length; i++) {
      if (th[i]! <= th[i - 1]!) throw new RulesError(`Rule version ${rules.id}: ${t} thresholds must increase (${th.join(", ")})`);
    }
  }
  const known = new Set<string>(KNOWN_MODIFIERS);
  return Object.keys(rules.modifiers)
    .filter((k) => !known.has(k))
    .map((k) => `Rule version ${rules.id} has modifier "${k}" that this engine doesn't apply`);
}

/** Points earned for `count` players sharing a key. */
export function pointsFor(thresholds: number[], count: number): number {
  let p = 0;
  for (const t of thresholds) if (count >= t) p++;
  return p;
}

/** The next count that earns a point, or null when already at the top threshold. */
export function nextThreshold(thresholds: number[], count: number): number | null {
  for (const t of thresholds) if (count < t) return t;
  return null;
}
