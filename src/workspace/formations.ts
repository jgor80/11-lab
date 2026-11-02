// Formation templates: slot names and the position each slot asks for, ordered back to front.
export interface FormationSlot {
  slot: string;
  position: string;
  /** Row on the pitch, 0 = goalkeeper. For drawing only. */
  row: number;
}

const f = (rows: [string, string][][]): FormationSlot[] =>
  rows.flatMap((r, row) => r.map(([slot, position]) => ({ slot, position, row })));

export const FORMATIONS: Record<string, FormationSlot[]> = {
  "3-5-2": f([
    [["GK", "GK"]],
    [["LCB", "CB"], ["CB", "CB"], ["RCB", "CB"]],
    [["LCDM", "CDM"], ["RCDM", "CDM"]],
    [["LM", "LM"], ["CAM", "CAM"], ["RM", "RM"]],
    [["LST", "ST"], ["RST", "ST"]],
  ]),
  "4-4-2": f([
    [["GK", "GK"]],
    [["LB", "LB"], ["LCB", "CB"], ["RCB", "CB"], ["RB", "RB"]],
    [["LM", "LM"], ["LCM", "CM"], ["RCM", "CM"], ["RM", "RM"]],
    [["LST", "ST"], ["RST", "ST"]],
  ]),
  "4-3-3": f([
    [["GK", "GK"]],
    [["LB", "LB"], ["LCB", "CB"], ["RCB", "CB"], ["RB", "RB"]],
    [["LCM", "CM"], ["CM", "CM"], ["RCM", "CM"]],
    [["LW", "LW"], ["ST", "ST"], ["RW", "RW"]],
  ]),
  "3-4-3": f([
    [["GK", "GK"]],
    [["LCB", "CB"], ["CB", "CB"], ["RCB", "CB"]],
    [["LM", "LM"], ["LCM", "CM"], ["RCM", "CM"], ["RM", "RM"]],
    [["LW", "LW"], ["ST", "ST"], ["RW", "RW"]],
  ]),
};

export function formationSlots(formation: string): FormationSlot[] {
  const slots = FORMATIONS[formation];
  if (!slots) throw new Error(`Unknown formation "${formation}". Known: ${Object.keys(FORMATIONS).join(", ")}`);
  return slots;
}
