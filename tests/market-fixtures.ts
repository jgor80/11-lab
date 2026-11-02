import { DEFAULT_RULES, type WorkspaceCard } from "../src/workspace/index.js";
import { DEMO_POOL, demoSquad } from "../src/workspace/demo.js";
import type { MarketCard } from "../src/market/index.js";

export { DEFAULT_RULES };

const m = (c: WorkspaceCard): MarketCard => ({ ...c, rating: c.rating ?? 80, category: "base", tradeable: true });

/** The demo 3-5-2 (LST, RST, CAM, LCB locked) plus an RM and an ST from the demo pool. */
export function demoSquadFor() {
  const squad = demoSquad("u1");
  const rm = m({ ...DEMO_POOL.find((c) => c.id === "demo-m1")!, owned: false });
  const lockedSt = m({ id: "demo-st-x", name: "Demo Striker X", club: "Harbor", league: "NWSL", nation: "United States", positions: ["ST"], rating: 91, source: "fixture", stats: { pac: 95, sho: 94, pas: 80, dri: 90, def: 40, phy: 80 } });
  return { squad, rm, lockedSt };
}
