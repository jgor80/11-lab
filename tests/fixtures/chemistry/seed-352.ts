// The brief's 3-5-2 seed scenario with FIXTURE metadata. Clubs, leagues and nations here are made up
// so the test can be checked by hand; they are NOT the real cards. The real-card version lives in
// data/manual/seed-352.json once Jeff enters it from the game (see chemistry-seed-real.test.ts).
import type { SquadCard, SquadInput } from "../../../src/chemistry/index.js";

const card = (name: string, club: string, league: string, nation: string, positions: string[]): SquadCard => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  club,
  league,
  nation,
  positions,
});

export const seed352: SquadInput = {
  formation: "3-5-2",
  manager: { nation: "United States", league: "NWSL" },
  slots: [
    { slot: "GK", position: "GK", card: card("Locked A", "Club 1", "League 1", "Nation 1", ["GK"]) },
    { slot: "LCB", position: "CB", card: card("Fixture LCB", "Club 1", "League 1", "Nation 1", ["CB", "LB"]) },
    { slot: "CB", position: "CB", card: card("Fixture CB", "Club 3", "League 1", "Nation 1", ["CB"]) },
    { slot: "RCB", position: "CB", card: card("Locked B", "Club 4", "League 1", "Nation 2", ["CB"]) },
    { slot: "LCDM", position: "CDM", card: card("Fixture LCDM", "Club 5", "League 1", "Nation 3", ["CDM", "CM"]) },
    { slot: "RCDM", position: "CDM", card: card("Fixture RCDM", "Club 6", "League 2", "Nation 6", ["CDM"]) },
    { slot: "CAM", position: "CAM", card: card("Locked C", "Club 2", "League 2", "Nation 5", ["CAM", "CM"]) },
    { slot: "LM", position: "LM", card: card("Fixture LM", "Club 7", "NWSL", "United States", ["LM", "LW"]) },
    { slot: "RM", position: "RM", card: card("Fixture RM", "Club 8", "NWSL", "United States", ["RM"]) },
    { slot: "LST", position: "ST", card: card("Fixture ST2", "Club 9", "NWSL", "United States", ["ST"]) },
    { slot: "RST", position: "ST", card: card("Locked D", "Club 2", "League 2", "Nation 4", ["ST"]) },
  ],
};

/** Stand-ins for the brief's four locked players (Wilson, Haaland, Bruno, Van Dijk). Their real slots and metadata are not assumed. */
export const locked = ["GK", "RCB", "CAM", "RST"];
