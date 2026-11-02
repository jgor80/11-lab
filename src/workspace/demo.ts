// DEMO DATA. Every player, club and price here is made up so the workflow can be tried and tested
// without EA data in this public repo. Leagues and nations are real names so the links read naturally.
// The shape mirrors Jeff's brief: a 3-5-2 with a US/NWSL striker at 2/3 (4/5 nation, 4/5 league, like Wilson in the brief)
// and four locked players. Replace with your own cards (or import seed-352.json) for real answers.
import { assignCard, createSquad, setLocked, setManager } from "./squad.js";
import type { Manager, Squad, WorkspaceCard } from "./types.js";

type S = WorkspaceCard["stats"];
const card = (id: string, name: string, club: string, league: string, nation: string, positions: string[], extra: Partial<WorkspaceCard> = {}): WorkspaceCard => ({
  id: `demo-${id}`,
  name,
  club,
  league,
  nation,
  positions,
  source: "fixture",
  ...extra,
});
const st = (pac: number, sho: number, pas: number, dri: number, def: number, phy: number): S => ({ pac, sho, pas, dri, def, phy });

export const DEMO_MANAGERS: Manager[] = [
  { id: "demo-mgr-eng", name: "D. Ashby (demo)", nation: "England", league: "Premier League", owned: true, source: "fixture" },
  { id: "demo-mgr-usa", name: "K. Moreno (demo)", nation: "United States", league: "NWSL", price: 1500, source: "fixture" },
  { id: "demo-mgr-esp", name: "L. Ibarra (demo)", nation: "Spain", league: "Liga F", price: 1200, source: "fixture" },
];

/** The starting XI (all owned). */
export const DEMO_XI: Record<string, WorkspaceCard> = {
  GK: card("gk", "Tom Harlow", "Northgate", "Premier League", "England", ["GK"], { rating: 86, owned: true, stats: st(50, 20, 60, 55, 30, 75) }),
  LCB: card("lcb", "Joris Veld", "Northgate", "Premier League", "Netherlands", ["CB"], { rating: 90, owned: true, stats: st(78, 60, 70, 72, 91, 88) }),
  CB: card("cb", "Ben Carrow", "Riverside", "Premier League", "England", ["CB"], { rating: 85, owned: true, stats: st(74, 45, 66, 68, 86, 84) }),
  RCB: card("rcb", "Sam Odell", "Ashford", "Premier League", "England", ["CB", "RB"], { rating: 84, owned: true, stats: st(80, 40, 64, 70, 84, 80) }),
  LCDM: card("lcdm", "Maya Brooks", "Bay City", "NWSL", "United States", ["CDM", "CM"], { rating: 85, owned: true, stats: st(72, 62, 80, 79, 82, 78) }),
  RCDM: card("rcdm", "Ana Duarte", "Valle", "Liga F", "United States", ["CDM"], { rating: 86, owned: true, stats: st(70, 66, 83, 80, 81, 76) }),
  LM: card("lm", "Jade Kessler", "Summit", "NWSL", "United States", ["LM", "LW"], { rating: 85, owned: true, stats: st(92, 78, 80, 86, 45, 66) }),
  CAM: card("cam", "Rui Matos", "Riverside", "Premier League", "Portugal", ["CAM", "CM"], { rating: 89, owned: true, stats: st(72, 85, 90, 86, 60, 72) }),
  RM: card("rm", "Claire Dumont", "Lumière", "NWSL", "Canada", ["RM", "RB"], { rating: 84, owned: true, stats: st(88, 62, 75, 80, 70, 72) }),
  LST: card("lst", "Rae Whitlock", "Harbor", "NWSL", "United States", ["ST"], { rating: 90, owned: true, stats: st(93, 89, 76, 88, 35, 72) }),
  RST: card("rst", "Erik Haldor", "Fjord", "Premier League", "Norway", ["ST"], { rating: 91, owned: true, stats: st(88, 93, 66, 80, 45, 90) }),
};

/** Club bench plus priced "market" cards (prices are invented). */
export const DEMO_POOL: WorkspaceCard[] = [
  // owned bench
  card("b1", "Lena Holt", "Valle", "Liga F", "Canada", ["CB"], { rating: 82, owned: true, stats: st(70, 35, 60, 62, 83, 80) }),
  card("b2", "Kai Mensah", "Northgate", "Premier League", "Ghana", ["CDM", "CM"], { rating: 83, owned: true, stats: st(74, 60, 78, 77, 80, 82) }),
  card("b3", "Ivy Tran", "Summit", "NWSL", "United States", ["CM", "CAM"], { rating: 83, owned: true, stats: st(78, 74, 84, 85, 55, 60) }),
  // market
  card("m1", "Nora Quill", "Harbor", "NWSL", "United States", ["RM", "RW"], { rating: 84, price: 12000, stats: st(90, 72, 76, 83, 58, 64) }),
  card("m2", "Tess Avery", "Bay City", "NWSL", "United States", ["CB"], { rating: 85, price: 3000, stats: st(76, 40, 62, 66, 85, 82) }),
  card("m3", "Paige Lund", "Summit", "NWSL", "United States", ["CDM"], { rating: 86, price: 27000, stats: st(74, 60, 80, 78, 86, 80) }),
  card("m4", "Ella Ward", "Riverside", "Premier League", "England", ["RM"], { rating: 85, price: 9000, stats: st(86, 75, 79, 83, 52, 66) }),
  card("m5", "Mo Kader", "Ashford", "Premier League", "England", ["CDM"], { rating: 86, price: 21000, stats: st(68, 64, 82, 78, 85, 84) }),
  card("m6", "Gwen Rhee", "Lumière", "NWSL", "United States", ["GK"], { rating: 84, price: 2000, stats: st(45, 20, 55, 50, 30, 70) }),
  card("m7", "Sara Lind", "Fjord", "Premier League", "Norway", ["LM"], { rating: 85, price: 15000, stats: st(88, 74, 78, 84, 50, 62) }),
  card("m8", "Dani Cruz", "Valle", "Liga F", "Spain", ["RM"], { rating: 87, price: 40000, stats: st(89, 76, 82, 88, 55, 60) }),
];

export function demoSquad(owner_id = "local"): Squad {
  let s = createSquad({ formation: "3-5-2", name: "My Rivals Squad (demo)", owner_id, budget: 200_000, id: "demo-352" });
  s = { ...s, platform: "Xbox" };
  for (const [slot, c] of Object.entries(DEMO_XI)) s = assignCard(s, slot, c);
  s = setManager(s, DEMO_MANAGERS[0]!);
  for (const slot of ["LST", "RST", "CAM", "LCB"]) s = setLocked(s, slot, true);
  return s;
}
