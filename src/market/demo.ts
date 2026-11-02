// DEMO DATASET. Every card and every price here is MADE UP, generated deterministically so Market Lab can be
// tried without a licensed price feed. It is tagged source "xilab_demo" (is_demo), and every result built on it
// carries provenance.demo = true, which the UI shows as a DEMO banner. It is not market data and says nothing
// about real FC 27 prices.
import { DEMO_POOL, DEMO_XI } from "../workspace/demo.js";
import { rebalance, DEFAULT_BASKETS, type BasketMembership } from "./baskets.js";
import { roundToStep } from "./rules.js";
import type { CardCategory, MarketCard, Platform, PriceObservation } from "./types.js";

export const DEMO_SOURCE_ID = "xilab_demo";
const HOUR = 3_600_000;
const HOURS = 8 * 24;

type S = MarketCard["stats"];
const st = (pac: number, sho: number, pas: number, dri: number, def: number, phy: number): S => ({ pac, sho, pas, dri, def, phy });
const LEAGUES = ["Premier League", "NWSL", "Liga F", "LaLiga", "Bundesliga", "Serie A"];
const NATIONS = ["England", "United States", "Spain", "France", "Brazil", "Germany", "Netherlands"];
const POS = ["CB", "CDM", "CM", "ST", "LM", "RB", "CAM"];

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

/** How each demo card's price moves. Shapes are chosen to exercise each signal, not to mimic any real card. */
type Shape = "flat" | "steady_climb" | "spike_72h" | "recent_dip" | "persistent_decline" | "stale" | "none" | "sbc_bump" | "volatile";

interface DemoSpec {
  card: MarketCard;
  base: number;
  shape: Shape;
}

const fromWorkspace = (c: (typeof DEMO_POOL)[number], category: CardCategory = "base"): MarketCard => ({
  ...c,
  rating: c.rating ?? 80,
  category,
  version: "Demo",
  tradeable: true,
  source: "fixture",
});

function fodder(): DemoSpec[] {
  const out: DemoSpec[] = [];
  const basePrice: Record<number, number> = { 84: 1200, 85: 1900, 86: 3200, 87: 6500, 88: 11000, 89: 17500, 90: 29000 };
  for (const r of [84, 85, 86, 87, 88, 89, 90]) {
    for (let i = 0; i < 6; i++) {
      const rnd = rng(`f${r}${i}`);
      const pos = POS[(r + i) % POS.length]!;
      const v = (n: number) => Math.max(30, Math.min(97, Math.round(n + normal(rnd) * 5)));
      const card: MarketCard = {
        id: `demo-f${r}-${i + 1}`,
        name: `Demo Fodder ${r}·${String.fromCharCode(65 + i)}`,
        club: `Demo Club ${((r * 7 + i) % 9) + 1}`,
        league: LEAGUES[(r + i * 2) % LEAGUES.length]!,
        nation: NATIONS[(r * 3 + i) % NATIONS.length]!,
        positions: [pos],
        rating: r,
        category: "base",
        version: "Demo gold",
        tradeable: true,
        source: "fixture",
        stats: st(v(r - 6), v(r - 12), v(r - 6), v(r - 4), v(pos === "ST" ? 40 : r - 8), v(r - 6)),
      };
      // 86-88 get an SBC-like bump in the last day, so the regime classifier has something to see.
      const shape: Shape = r >= 86 && r <= 88 ? "sbc_bump" : "flat";
      out.push({ card, base: Math.round(basePrice[r]! * (0.9 + rnd() * 0.25)), shape });
    }
  }
  return out;
}

function specials(): DemoSpec[] {
  const mk = (id: string, name: string, rating: number, category: CardCategory, positions: string[], stats: S, base: number, shape: Shape): DemoSpec => ({
    card: { id: `demo-${id}`, name, club: "Demo Club X", league: "Premier League", nation: "England", positions, rating, category, version: `Demo ${category}`, tradeable: true, source: "fixture", stats, is_icon: category === "icon", is_hero: category === "hero" },
    base,
    shape,
  });
  return [
    mk("p1", "Demo Promo Winger", 91, "promo", ["RW", "RM"], st(95, 86, 84, 92, 45, 70), 145_000, "volatile"),
    mk("p2", "Demo Promo Pivot", 90, "promo", ["CDM", "CM"], st(78, 70, 86, 84, 89, 86), 98_000, "volatile"),
    mk("p3", "Demo Promo Forward", 92, "promo", ["ST"], st(93, 92, 78, 89, 40, 84), 210_000, "volatile"),
    mk("i1", "Demo Icon Stopper", 91, "icon", ["CB"], st(84, 50, 72, 74, 93, 90), 520_000, "flat"),
    mk("i2", "Demo Icon Maestro", 92, "icon", ["CAM", "CM"], st(80, 88, 93, 92, 55, 72), 880_000, "flat"),
    mk("h1", "Demo Hero Runner", 89, "hero", ["LM", "LW"], st(94, 82, 80, 88, 40, 66), 160_000, "flat"),
  ];
}

const SHAPED: Record<string, Shape> = {
  "demo-m1": "steady_climb", // Nora Quill: outperforms with higher highs and lows
  "demo-m8": "spike_72h", // Dani Cruz: +40% before you see it
  "demo-m4": "recent_dip", // Ella Ward: stable week then a sharp dip
  "demo-m5": "persistent_decline", // Mo Kader: falling all week
  "demo-m6": "stale", // Gwen Rhee: no new price for 12h
  "demo-m3": "none", // Paige Lund: no prices at all
};

export function demoMarketCards(): MarketCard[] {
  return demoSpecs().map((s) => s.card);
}

function demoSpecs(): DemoSpec[] {
  const ws: DemoSpec[] = [...Object.values(DEMO_XI), ...DEMO_POOL].map((c) => ({
    card: fromWorkspace(c),
    base: c.price ?? Math.max(1000, ((c.rating ?? 80) - 80) * 3500),
    shape: SHAPED[c.id] ?? "flat",
  }));
  return [...ws, ...fodder(), ...specials()];
}

function path(shape: Shape, h: number): number {
  // h = hours before the anchor (HOURS..0). Returns a multiplicative trend factor.
  const t = (HOURS - h) / HOURS; // 0..1 across the window
  switch (shape) {
    case "steady_climb":
      return 1 + 0.4 * t * t + 0.015 * Math.sin(h / 5);
    case "spike_72h":
      return h > 72 ? 1 : 1 + 0.42 * ((72 - h) / 72);
    case "recent_dip":
      return h > 20 ? 1 : 1 - 0.16 * Math.min(1, (20 - h) / 8);
    case "persistent_decline":
      return 1 - 0.3 * t;
    case "sbc_bump":
      return h > 24 ? 1 : 1 + 0.1 * ((24 - h) / 24);
    default:
      return 1;
  }
}

/**
 * Hourly demo prices for 8 days up to `anchor` (rounded down to the hour), both platforms. PC trades ~8% lower.
 * received_at is 5 minutes after observed_at, like a polling feed would be.
 */
export function demoPriceHistory(anchor: string): PriceObservation[] {
  const end = Math.floor(Date.parse(anchor) / HOUR) * HOUR;
  const out: PriceObservation[] = [];
  for (const spec of demoSpecs()) {
    if (spec.shape === "none") continue;
    for (const platform of ["console", "pc"] as Platform[]) {
      const rnd = rng(`${spec.card.id}|${platform}`);
      const noise = spec.shape === "volatile" ? 0.035 : 0.008;
      const pf = platform === "pc" ? 0.92 : 1;
      let drift = 0;
      for (let h = HOURS; h >= 0; h--) {
        if (spec.shape === "stale" && h < 12) continue;
        drift += normal(rnd) * noise * (spec.shape === "steady_climb" ? 0.3 : 1);
        drift *= 0.9; // mean-reverting noise, so shapes stay recognisable
        const price = roundToStep(spec.base * pf * path(spec.shape, h) * Math.exp(drift), "nearest");
        const t = end - h * HOUR;
        out.push({
          card_id: spec.card.id,
          platform,
          price,
          kind: "lowest_bin",
          observed_at: new Date(t).toISOString(),
          received_at: new Date(t + 5 * 60_000).toISOString(),
          season: "FC27",
          source_id: DEMO_SOURCE_ID,
          evidence: "hypothesis",
          quality: ["DEMO: made-up price"],
        });
      }
    }
  }
  return out;
}

/** Basket memberships as of the start of the demo window (so indexes have point-in-time history). */
export function demoMemberships(anchor: string): BasketMembership[] {
  const start = new Date(Math.floor(Date.parse(anchor) / HOUR) * HOUR - HOURS * HOUR).toISOString();
  const cards = demoMarketCards();
  return DEFAULT_BASKETS.flatMap((b) => rebalance(b, cards, [], start));
}
