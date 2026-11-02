// Reads a chemistry rule version from the DB as plain data for the chemistry engine (src/chemistry).
import type { Db } from "./sqlite.js";
import type { ChemistryRules } from "../chemistry/rules.js";

export type { ChemistryRules };

export function loadChemistryRules(db: Db, versionId?: string, season = "FC27"): ChemistryRules {
  const v = (versionId
    ? db.prepare("SELECT id, season, status FROM chemistry_rule_versions WHERE id = ?").get(versionId)
    : db.prepare("SELECT id, season, status FROM chemistry_rule_versions WHERE season = ? AND is_active = 1").get(season)) as
    | { id: string; season: string; status: ChemistryRules["status"] }
    | undefined;
  if (!v) throw new Error(`No chemistry rule version ${versionId ?? `active for ${season}`}`);
  const thresholds: ChemistryRules["thresholds"] = { club: [], league: [], nation: [] };
  const rows = db
    .prepare("SELECT link_type, players_required FROM chemistry_thresholds WHERE rule_version_id = ? ORDER BY points")
    .all(v.id) as { link_type: keyof ChemistryRules["thresholds"]; players_required: number }[];
  for (const r of rows) thresholds[r.link_type].push(r.players_required);
  const modifiers = Object.fromEntries(
    (db.prepare("SELECT key, value FROM chemistry_modifiers WHERE rule_version_id = ?").all(v.id) as { key: string; value: number }[])
      .map((m) => [m.key, m.value]),
  );
  return { id: v.id, season: v.season, status: v.status, thresholds, modifiers };
}
