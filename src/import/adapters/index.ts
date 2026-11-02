import type { AdapterOutput } from "../record.js";
import { readManualCsv, readManualJson } from "./manual.js";
import { readKaggleFc27 } from "./kaggle-fc27.js";

export interface Adapter {
  /** data_sources.id this adapter writes as. */
  sourceId: string;
  description: string;
  read(text: string, fileName: string): AdapterOutput;
}

export const ADAPTERS: Record<string, Adapter> = {
  manual: {
    sourceId: "manual",
    description: "Cards entered from your own game (.json or .csv)",
    read: (text, fileName) => (fileName.toLowerCase().endsWith(".csv") ? readManualCsv(text) : readManualJson(text)),
  },
  "kaggle-fc27": {
    sourceId: "kaggle-mikedpad-fc27",
    description: "Kaggle MikeDPad FC 27 ratings CSV (terms pending review)",
    read: (text) => readKaggleFc27(text),
  },
};
