// Public entry point for the chemistry engine. Worker-safe: no Node-only imports anywhere below.
export { computeSquadChemistry, isInPosition, ENGINE_VERSION, SquadInputError } from "./engine.js";
export { diffSquadChemistry, previewSwap, type SlotChange, type SquadChemistryDiff } from "./diff.js";
export {
  KNOWN_MODIFIERS,
  LINK_TYPES,
  RulesError,
  nextThreshold,
  pointsFor,
  validateRules,
  type ChemistryRules,
  type LinkType,
} from "./rules.js";
export type * from "./types.js";
