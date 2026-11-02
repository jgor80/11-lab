export { parseCsv } from "../shared/csv.js";

/** Splits a multi-value cell like "CM|CDM" or "Intercept+, Anticipate". */
export function splitList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(/[|;,]/).map((x) => x.trim()).filter(Boolean);
}

export function intOrUndef(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}
