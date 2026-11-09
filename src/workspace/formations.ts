// Formation templates: slot names and the position each slot asks for, ordered back to front, left to right.
// Every formation EA SPORTS FC 27 Ultimate Team offers, under its in-game name. FC 27 has 12 positions (GK, LB, CB,
// RB, CDM, CM, CAM, LM, RM, LW, RW, ST): there are no LWB/RWB/CF/LF/RF slots any more, so wing-backs in back-five
// shapes are LB/RB slots and the "two 10s" of 4-3-2-1 / 3-4-2-1 are CAM slots. Sources: FIFPlay's FC 27 formation
// list (28 formations, 2026-11) and FUT.GG's FC 27 tactics pages for the positions in each; EA's numbered variants
// map to FUT.GG's names as 4-3-3 (2) Holding, (3) Defend, (4) Attack; 4-2-3-1 Narrow / (2) Wide; 4-1-2-1-2 Wide /
// (2) Narrow; 4-4-2 Flat / (2) Holding; 4-5-1 Attack / (2) Flat.
export interface FormationSlot {
  slot: string;
  position: string;
  /** Row on the pitch, 0 = goalkeeper, counting up toward the opponent's goal. For drawing only. */
  row: number;
}

type Row = [string, string][];
const f = (rows: Row[]): FormationSlot[] =>
  rows.flatMap((r, row) => r.map(([slot, position]) => ({ slot, position, row })));

const GK: Row = [["GK", "GK"]];
const BACK3: Row = [["LCB", "CB"], ["CB", "CB"], ["RCB", "CB"]];
const BACK4: Row = [["LB", "LB"], ["LCB", "CB"], ["RCB", "CB"], ["RB", "RB"]];
const BACK5: Row = [["LB", "LB"], ["LCB", "CB"], ["CB", "CB"], ["RCB", "CB"], ["RB", "RB"]];
const CDM: Row = [["CDM", "CDM"]];
const CDM2: Row = [["LCDM", "CDM"], ["RCDM", "CDM"]];
const CM: Row = [["CM", "CM"]];
const CM2: Row = [["LCM", "CM"], ["RCM", "CM"]];
const CM3: Row = [["LCM", "CM"], ["CM", "CM"], ["RCM", "CM"]];
const MID4: Row = [["LM", "LM"], ["LCM", "CM"], ["RCM", "CM"], ["RM", "RM"]];
const CAM: Row = [["CAM", "CAM"]];
const CAM2: Row = [["LCAM", "CAM"], ["RCAM", "CAM"]];
const ST: Row = [["ST", "ST"]];
const ST2: Row = [["LST", "ST"], ["RST", "ST"]];
const FRONT3: Row = [["LW", "LW"], ["ST", "ST"], ["RW", "RW"]];

export const FORMATIONS: Record<string, FormationSlot[]> = {
  "3-1-4-2": f([GK, BACK3, CDM, MID4, ST2]),
  "3-4-1-2": f([GK, BACK3, MID4, CAM, ST2]),
  "3-4-2-1": f([GK, BACK3, MID4, CAM2, ST]),
  "3-4-3": f([GK, BACK3, MID4, FRONT3]),
  "3-5-2": f([GK, BACK3, CDM2, [["LM", "LM"], ["CAM", "CAM"], ["RM", "RM"]], ST2]),
  "4-1-2-1-2": f([GK, BACK4, CDM, [["LM", "LM"], ["RM", "RM"]], CAM, ST2]),
  "4-1-2-1-2 (2)": f([GK, BACK4, CDM, CM2, CAM, ST2]),
  "4-1-3-2": f([GK, BACK4, CDM, [["LM", "LM"], ["CM", "CM"], ["RM", "RM"]], ST2]),
  "4-1-4-1": f([GK, BACK4, CDM, MID4, ST]),
  "4-2-1-3": f([GK, BACK4, CDM2, CAM, FRONT3]),
  "4-2-2-2": f([GK, BACK4, CDM2, CAM2, ST2]),
  "4-2-3-1": f([GK, BACK4, CDM2, [["LCAM", "CAM"], ["CAM", "CAM"], ["RCAM", "CAM"]], ST]),
  "4-2-3-1 (2)": f([GK, BACK4, CDM2, [["LM", "LM"], ["CAM", "CAM"], ["RM", "RM"]], ST]),
  "4-2-4": f([GK, BACK4, CM2, [["LW", "LW"], ["LST", "ST"], ["RST", "ST"], ["RW", "RW"]]]),
  "4-3-1-2": f([GK, BACK4, CM3, CAM, ST2]),
  "4-3-2-1": f([GK, BACK4, CM3, CAM2, ST]),
  "4-3-3": f([GK, BACK4, CM3, FRONT3]),
  "4-3-3 (2)": f([GK, BACK4, CDM, CM2, FRONT3]),
  "4-3-3 (3)": f([GK, BACK4, CDM2, CM, FRONT3]),
  "4-3-3 (4)": f([GK, BACK4, CM2, CAM, FRONT3]),
  "4-4-2": f([GK, BACK4, MID4, ST2]),
  "4-4-2 (2)": f([GK, BACK4, CDM2, [["LM", "LM"], ["RM", "RM"]], ST2]),
  "4-5-1": f([GK, BACK4, [["LM", "LM"], ["CM", "CM"], ["RM", "RM"]], CAM2, ST]),
  "4-5-1 (2)": f([GK, BACK4, [["LM", "LM"], ["LCM", "CM"], ["CM", "CM"], ["RCM", "CM"], ["RM", "RM"]], ST]),
  "5-2-1-2": f([GK, BACK5, CM2, CAM, ST2]),
  "5-2-3": f([GK, BACK5, CM2, FRONT3]),
  "5-3-2": f([GK, BACK5, CDM, CM2, ST2]),
  "5-4-1": f([GK, BACK5, MID4, ST]),
};

/** Formation names in the order FC 27's formation picker lists them. */
export const FORMATION_NAMES = Object.keys(FORMATIONS);

export function formationSlots(formation: string): FormationSlot[] {
  const slots = FORMATIONS[formation];
  if (!slots) throw new Error(`Unknown formation "${formation}". Known: ${FORMATION_NAMES.join(", ")}`);
  return slots;
}
