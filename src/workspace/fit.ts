// Tactical fit: a configurable ESTIMATE of how well a card suits what the user wants from a position.
// Deliberately separate from chemistry, which comes from game rules. Never mix the two numbers.
import { FACE_STATS, type FaceStat, type WorkspaceCard } from "./types.js";

/** Weights over face stats; they don't need to add up to anything, they are normalised. */
export type FitProfile = { id: string; label: string; weights: Partial<Record<FaceStat, number>> };

export const DEFAULT_PROFILES: Record<string, FitProfile> = {
  GK: { id: "gk", label: "Goalkeeper (face stats don't describe GKs well)", weights: { def: 1, phy: 1 } },
  CB: { id: "cb", label: "Centre back", weights: { def: 45, phy: 25, pac: 20, pas: 10 } },
  LB: { id: "fb", label: "Full back", weights: { def: 35, pac: 30, pas: 20, phy: 15 } },
  RB: { id: "fb", label: "Full back", weights: { def: 35, pac: 30, pas: 20, phy: 15 } },
  CDM: { id: "cdm", label: "Holding midfielder", weights: { def: 40, pas: 30, phy: 20, dri: 10 } },
  CM: { id: "cm", label: "Central midfielder", weights: { pas: 35, dri: 25, def: 20, phy: 10, sho: 10 } },
  CAM: { id: "cam", label: "Attacking midfielder", weights: { pas: 35, dri: 30, sho: 25, pac: 10 } },
  LM: { id: "wm", label: "Wide midfielder", weights: { pac: 30, dri: 30, pas: 25, sho: 15 } },
  RM: { id: "wm", label: "Wide midfielder", weights: { pac: 30, dri: 30, pas: 25, sho: 15 } },
  LW: { id: "w", label: "Winger", weights: { pac: 30, dri: 35, sho: 20, pas: 15 } },
  RW: { id: "w", label: "Winger", weights: { pac: 30, dri: 35, sho: 20, pas: 15 } },
  ST: { id: "st", label: "Striker", weights: { sho: 45, pac: 25, phy: 15, dri: 15 } },
};

/** Jeff's example: the RM in a 3-5-2 is really a wing back. "Pace & stamina" maps to pac until sub-attributes are wired in. */
export const PRESET_PROFILES: FitProfile[] = [
  { id: "def-wide-mid", label: "Defensive wide midfielder", weights: { def: 30, pac: 25, pas: 20, dri: 15, phy: 10 } },
];

export interface FitScore {
  /** 0-99 weighted face-stat score, or null when the card has no stats entered. */
  score: number | null;
  profile: string;
  evidence: "estimate";
}

export function fitScore(card: WorkspaceCard | null, position: string, profile?: FitProfile): FitScore {
  const p = profile ?? DEFAULT_PROFILES[position.toUpperCase()] ?? { id: "flat", label: "Equal weights", weights: {} };
  const label = p.label;
  if (!card?.stats) return { score: null, profile: label, evidence: "estimate" };
  let sum = 0;
  let w = 0;
  for (const k of FACE_STATS) {
    const weight = Object.keys(p.weights).length ? p.weights[k] ?? 0 : 1;
    const v = card.stats[k];
    if (weight && typeof v === "number") {
      sum += v * weight;
      w += weight;
    }
  }
  return { score: w ? Math.round(sum / w) : null, profile: label, evidence: "estimate" };
}
