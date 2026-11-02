// Squad workspace types. Plain JSON, no DB or Node imports: this module is bundled for Workers and Deno too.
import type { Evidence, SquadCard } from "../chemistry/index.js";

export type FaceStat = "pac" | "sho" | "pas" | "dri" | "def" | "phy";
export const FACE_STATS: readonly FaceStat[] = ["pac", "sho", "pas", "dri", "def", "phy"];

/** A card the workspace can place. Extends the engine's SquadCard with what the optimizer needs. */
export interface WorkspaceCard extends SquadCard {
  id: string;
  rating?: number;
  /** Coins to buy it, entered by the user. null/undefined = unknown, so the optimizer won't buy it. */
  price?: number | null;
  /** In the user's club: costs nothing to use. */
  owned?: boolean;
  stats?: Partial<Record<FaceStat, number>>;
  /** Where the card data came from. "fixture" cards are made up for demos and tests. */
  source?: "fixture" | "user" | "database";
}

export interface Manager {
  id: string;
  name: string;
  nation: string | null;
  league: string | null;
  price?: number | null;
  owned?: boolean;
  source?: WorkspaceCard["source"];
}

export interface WorkspaceSlot {
  /** Unique within the squad, e.g. "LST". */
  slot: string;
  /** Position code the formation puts here, e.g. "ST". */
  position: string;
  card: WorkspaceCard | null;
  /** The optimizer may never replace a locked player. */
  locked: boolean;
}

export interface Squad {
  id: string;
  /** Owner id from the host app (GafferBot auth user id); "local" in the browser-only build. */
  owner_id: string;
  name: string;
  formation: string;
  platform?: string;
  manager: Manager | null;
  slots: WorkspaceSlot[];
  /** Coins available for upgrades. */
  budget: number;
  /** Set when this squad was saved from another one (e.g. an optimizer solution). */
  parent_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** Every service result carries the rule version and how far to trust it. */
export interface Provenance {
  rule_version: string;
  rule_status: "unverified" | "verified" | "retired";
  engine_version: string;
  evidence: Evidence;
}
