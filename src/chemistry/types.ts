import type { LinkType } from "./rules.js";

export type Evidence = "verified" | "game_data" | "estimate" | "hypothesis";

export interface SquadCard {
  /** Optional caller id, echoed back as card_id. */
  id?: string;
  name: string;
  club: string | null;
  league: string | null;
  nation: string | null;
  /** Every position the card can play without penalty (primary plus alternatives). */
  positions: string[];
  is_icon?: boolean;
  is_hero?: boolean;
}

export interface SquadSlot {
  /** Unique within the squad, e.g. "LCB". */
  slot: string;
  /** Position code the formation asks for here, e.g. "CB". */
  position: string;
  card: SquadCard;
}

export interface SquadInput {
  formation: string;
  manager?: { nation?: string; league?: string };
  /** Up to 11. Fewer is allowed for a squad still being built. */
  slots: SquadSlot[];
}

export interface LinkBreakdown {
  /** The club, league or nation as entered, or null if the card has none. */
  key: string | null;
  /** Weighted count of in-position players sharing this key (Icons/Heroes/manager can add more than 1). */
  count: number;
  points: number;
  /** Count needed for the next point, or null at the top threshold or with no key. */
  next_threshold: number | null;
  /** How much more count is needed for that point. */
  needed_for_next: number | null;
}

export interface PlayerChemistry {
  slot: string;
  card_id?: string;
  name: string;
  chemistry: number;
  in_position: boolean;
  /** Points from each link type before the cap. */
  links: Record<LinkType, number>;
  manager_bonus: number;
  breakdown: Record<LinkType, LinkBreakdown>;
  notes: string[];
}

export interface SquadChemistryResult {
  engine_version: string;
  rule_version: string;
  rule_status: "unverified" | "verified" | "retired";
  formation: string;
  total: number;
  max: number;
  /** True only when total === max AND the rule version is verified against the game. */
  full_chemistry_verified: boolean;
  players: PlayerChemistry[];
  warnings: string[];
  evidence: Evidence;
}
