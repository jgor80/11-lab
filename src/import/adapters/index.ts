import { readFileSync } from "node:fs";
import type { AdapterOutput, LoadedInput } from "../record.js";
import { readManualCsv, readManualJson } from "./manual.js";
import { readKaggleFc27 } from "./kaggle-fc27.js";
import { loadEaRatingsSnapshot } from "./ea-ratings.js";

export interface Adapter {
  /** data_sources.id this adapter writes as. */
  sourceId: string;
  description: string;
  /** Reads the input at `path`: a file, or a snapshot directory for paged sources. */
  load(path: string): LoadedInput;
}

function fromFile(read: (text: string, path: string) => AdapterOutput) {
  return (path: string): LoadedInput => {
    const bytes = readFileSync(path);
    return { output: read(bytes.toString("utf8"), path), hashInput: bytes };
  };
}

export const ADAPTERS: Record<string, Adapter> = {
  manual: {
    sourceId: "manual",
    description: "Cards entered from your own game (.json or .csv)",
    load: fromFile((text, path) => (path.toLowerCase().endsWith(".csv") ? readManualCsv(text) : readManualJson(text))),
  },
  "ea-ratings": {
    sourceId: "ea-ratings-site",
    description: "Snapshot folder written by `npm run fetch:ea` (EA's FC 27 ratings feed)",
    load: loadEaRatingsSnapshot,
  },
  "kaggle-fc27": {
    sourceId: "kaggle-mikedpad-fc27",
    description: "Kaggle MikeDPad FC 27 ratings CSV (terms pending review)",
    load: fromFile((text) => readKaggleFc27(text)),
  },
};
