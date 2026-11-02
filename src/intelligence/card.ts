// Card Intelligence: the ONE place card usefulness is scored. The Squad Builder and Market Lab both call this,
// so there are never two competing scoring systems. Stage A covers gameplay utility from what we hold today
// (positions and face-stat fit estimates). SBC, Evolution and scarcity utility are separate models that arrive
// with event data in Stage B; they are listed as unavailable rather than folded into one number.
import { DEFAULT_PROFILES, fitScore, type FitProfile, type WorkspaceCard } from "../workspace/index.js";

export interface PositionFit {
  position: string;
  profile: string;
  score: number | null;
}

export interface CardUtility {
  card_id: string;
  gameplay: {
    /** Fit estimate at each position the card can play, best first. */
    by_position: PositionFit[];
    best: PositionFit | null;
    /** Positions playable without penalty. */
    versatility: number;
    evidence: "estimate";
    basis: string;
  };
  /** Kept separate and NOT combined into one score until each is defined and validated. */
  unavailable: { model: "sbc" | "evolution" | "scarcity" | "playstyles_roles"; reason: string }[];
}

export function cardUtility(card: WorkspaceCard, profiles: Record<string, FitProfile> = {}): CardUtility {
  const by_position = card.positions
    .map((p) => {
      const prof = profiles[p] ?? DEFAULT_PROFILES[p.toUpperCase()];
      const f = fitScore(card, p, prof);
      return { position: p, profile: f.profile, score: f.score };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    card_id: card.id,
    gameplay: {
      by_position,
      best: by_position[0] ?? null,
      versatility: card.positions.length,
      evidence: "estimate",
      basis: "Weighted face stats per position profile (same model as the Squad Builder's tactical fit). Chemistry depends on the squad: use Compare in My Squad.",
    },
    unavailable: [
      { model: "sbc", reason: "Needs SBC requirement data (Stage B)." },
      { model: "evolution", reason: "Needs Evolution eligibility and outcome data (Stage B)." },
      { model: "scarcity", reason: "Needs pack availability and supply data." },
      { model: "playstyles_roles", reason: "PlayStyles and Role+ are stored but not yet weighted in fit." },
    ],
  };
}

/** Same primary position, rating within ±range: the comparable set both screens use. */
export function comparableCards<C extends WorkspaceCard & { rating?: number }>(card: C, pool: C[], range = 2): C[] {
  const r = card.rating ?? 0;
  return pool.filter((c) => c.id !== card.id && c.positions[0] === card.positions[0] && Math.abs((c.rating ?? 0) - r) <= range);
}
