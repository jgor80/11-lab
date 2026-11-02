// A copy of the active seeded rule version for places with no database (the browser workspace, tests).
// tests/workspace.test.ts fails if this drifts from the active rule version in migrations/.
import type { ChemistryRules } from "../chemistry/index.js";

export const FC27_COMMUNITY_V1: ChemistryRules = {
  id: "fc27-community-v1",
  season: "FC27",
  status: "unverified",
  thresholds: { club: [2, 4, 7], league: [3, 5, 8], nation: [2, 5, 8] },
  modifiers: {
    "player.max_chemistry": 3,
    "manager.nation_count": 1,
    "manager.league_count": 1,
    "icon.nation_bonus": 1,
    "icon.every_league_bonus": 1,
    "hero.league_bonus": 1,
    "hero.nation_bonus": 1,
    "icon.always_max": 1,
    "hero.always_max": 0,
  },
};

/** The rule version the workspace uses when no database is available. */
export const DEFAULT_RULES = FC27_COMMUNITY_V1;
