// Cards typed in from the game. Two formats:
//  - JSON: an array of CardRecord objects (see src/import/record.ts)
//  - CSV:  one card per row, see data/manual/cards.template.csv for the columns
import type { AdapterOutput, CardRecordInput } from "../record.js";
import { intOrUndef, parseCsv, splitList } from "../csv.js";

export function readManualJson(text: string): AdapterOutput {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) throw new Error("Manual JSON must be an array of card records.");
  return {
    records: data.map((r) => ({ evidence: "game_data", ...(r as object) }) as CardRecordInput),
    rejected: [],
  };
}

const CORE_COLUMNS = new Set([
  "card_key", "person_key", "name", "version", "rarity", "overall", "positions", "club", "league", "nation",
  "is_icon", "is_hero", "skill_moves", "weak_foot", "attacking_work_rate", "defensive_work_rate",
  "preferred_foot", "height_cm", "playstyles", "roles", "evidence", "ea_item_id",
]);

const bool = (v: string | undefined) => /^(1|true|yes|y)$/i.test(v ?? "");

export function readManualCsv(text: string): AdapterOutput {
  const out: AdapterOutput = { records: [], rejected: [] };
  for (const [i, row] of parseCsv(text).entries()) {
    const ref = row.card_key || `row ${i + 2}`;
    try {
      const attributes: Record<string, number> = {};
      for (const [k, v] of Object.entries(row)) {
        if (CORE_COLUMNS.has(k) || v === "") continue;
        const n = intOrUndef(v);
        if (n === undefined) throw new Error(`column '${k}' is not a number: '${v}'`);
        attributes[k] = n;
      }
      out.records.push({
        card_key: row.card_key ?? "",
        // Optional: EA's item id, so prices captured from the Web App match this card (promos, Icons, Heroes).
        ea_item_id: intOrUndef(row.ea_item_id),
        person: {
          key: row.person_key || row.name || "",
          common_name: row.name ?? "",
          height_cm: intOrUndef(row.height_cm),
          preferred_foot: (row.preferred_foot?.toLowerCase() || undefined) as "left" | "right" | undefined,
        },
        version: row.version || "base",
        rarity: row.rarity || undefined,
        overall: intOrUndef(row.overall) ?? 0,
        positions: splitList(row.positions),
        nation: { name: row.nation ?? "" },
        league: row.league ? { name: row.league } : undefined,
        club: row.club ? { name: row.club } : undefined,
        is_icon: bool(row.is_icon),
        is_hero: bool(row.is_hero),
        skill_moves: intOrUndef(row.skill_moves),
        weak_foot: intOrUndef(row.weak_foot),
        attacking_work_rate: (row.attacking_work_rate?.toLowerCase() || undefined) as CardRecordInput["attacking_work_rate"],
        defensive_work_rate: (row.defensive_work_rate?.toLowerCase() || undefined) as CardRecordInput["defensive_work_rate"],
        attributes,
        // "Intercept+|Anticipate": a trailing + marks PlayStyle+
        playstyles: splitList(row.playstyles).map((p) => ({ name: p.replace(/\+$/, "").trim(), plus: p.endsWith("+") })),
        // "CDM:Holding++|CM:Box-to-Box+"
        roles: splitList(row.roles).map((r) => {
          const m = /^([A-Za-z]+)\s*:\s*(.+?)(\+\+|\+)$/.exec(r);
          if (!m) throw new Error(`role '${r}' should look like POS:Role+ or POS:Role++`);
          return { position: m[1]!, role: m[2]!.trim(), level: m[3] === "++" ? "plusplus" as const : "plus" as const };
        }),
        evidence: (row.evidence || "game_data") as CardRecordInput["evidence"],
      });
    } catch (e) {
      out.rejected.push({ ref, reason: (e as Error).message });
    }
  }
  return out;
}
