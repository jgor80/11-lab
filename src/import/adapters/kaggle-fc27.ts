// Adapter for the Kaggle dataset "EA SPORTS FC 27 Player Ratings" by MikeDPad
// (https://www.kaggle.com/datasets/mikedpad/ea-sports-fc27-player-ratings).
//
// TERMS: this source is 'pending_review' in data_sources. The dataset says its data comes from EA's
// ratings feed, belongs to Electronic Arts, and is a non-commercial snapshot. The importer will not run
// it without an explicit --accept-terms decision, which is recorded on the import run.
//
// Coverage: launch gold/silver/bronze base items only. No promos, Icons, Heroes, Role+/++ or prices.
// The column list comes from the dataset description (60 columns). The exact cell formats for
// alternate_positions, playstyles and gender were not visible before download, so the parsing below
// is tolerant and rejects rows it can't read rather than guessing.
import type { AdapterOutput, CardRecordInput } from "../record.js";
import { intOrUndef, parseCsv, splitList } from "../csv.js";

/** Dataset column -> attribute_defs.key */
export const KAGGLE_ATTRIBUTE_MAP: Record<string, string> = {
  pace: "pac", shooting: "sho", passing: "pas", dribbling: "dri", defending: "def", physicality: "phy",
  attacking_crossing: "crossing",
  attacking_finishing: "finishing",
  attacking_heading_accuracy: "heading_accuracy",
  attacking_short_passing: "short_passing",
  attacking_volleys: "volleys",
  skill_dribbling: "dribbling",
  skill_curve: "curve",
  skill_fk_accuracy: "free_kick_accuracy",
  skill_long_passing: "long_passing",
  skill_ball_control: "ball_control",
  movement_acceleration: "acceleration",
  movement_sprint_speed: "sprint_speed",
  movement_agility: "agility",
  movement_reactions: "reactions",
  movement_balance: "balance",
  power_shot_power: "shot_power",
  power_jumping: "jumping",
  power_stamina: "stamina",
  power_strength: "strength",
  power_long_shots: "long_shots",
  mentality_aggression: "aggression",
  mentality_interceptions: "interceptions",
  mentality_positioning: "positioning",
  mentality_vision: "vision",
  mentality_penalties: "penalties",
  mentality_composure: "composure",
  defending_awareness: "defensive_awareness",
  defending_standing_tackle: "standing_tackle",
  defending_sliding_tackle: "sliding_tackle",
  goalkeeping_diving: "gk_diving",
  goalkeeping_handling: "gk_handling",
  goalkeeping_kicking: "gk_kicking",
  goalkeeping_positioning: "gk_positioning",
  goalkeeping_reflexes: "gk_reflexes",
};

export const KAGGLE_REQUIRED_COLUMNS = [
  "player_id", "common_name", "overall_rating", "position", "nationality",
];

function gender(v: string | undefined): "men" | "women" | undefined {
  const s = (v ?? "").toLowerCase();
  if (["m", "male", "men", "man"].includes(s)) return "men";
  if (["f", "female", "women", "woman", "w"].includes(s)) return "women";
  return undefined;
}

function foot(v: string | undefined): "left" | "right" | undefined {
  const s = (v ?? "").toLowerCase();
  if (s.startsWith("l")) return "left";
  if (s.startsWith("r")) return "right";
  return undefined;
}

function isoDate(v: string | undefined): string | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v ?? "");
  return m?.[1];
}

export function readKaggleFc27(text: string): AdapterOutput {
  const rows = parseCsv(text);
  const out: AdapterOutput = { records: [], rejected: [] };
  const first = rows[0];
  if (!first) return out;
  const missing = KAGGLE_REQUIRED_COLUMNS.filter((c) => !(c in first));
  if (missing.length) {
    throw new Error(`This doesn't look like the MikeDPad FC 27 file: missing columns ${missing.join(", ")}`);
  }
  for (const row of rows) {
    const ref = row.player_id || row.common_name || "?";
    const attributes: Record<string, number> = {};
    for (const [col, key] of Object.entries(KAGGLE_ATTRIBUTE_MAP)) {
      const n = intOrUndef(row[col]);
      if (n !== undefined && n > 0) attributes[key] = n;
    }
    const primary = (row.position ?? "").trim().toUpperCase();
    const alternates = splitList(row.alternate_positions).map((p) => p.toUpperCase()).filter((p) => p !== primary);
    const g = gender(row.gender);
    const name = row.common_name || [row.first_name, row.last_name].filter(Boolean).join(" ");
    const rec: CardRecordInput = {
      card_key: `fc27:${row.player_id}`,
      person: {
        key: String(row.player_id),
        common_name: name,
        first_name: row.first_name || undefined,
        last_name: row.last_name || undefined,
        birth_date: isoDate(row.birthdate),
        gender: g,
        height_cm: intOrUndef(row.height_cm),
        weight_kg: intOrUndef(row.weight_kg),
        preferred_foot: foot(row.preferred_foot),
      },
      season: "FC27",
      version: "base",
      overall: intOrUndef(row.overall_rating) ?? 0,
      nation: { name: row.nationality ?? "" },
      league: row.league ? { name: row.league, gender: g } : undefined,
      club: row.club ? { name: row.club } : undefined,
      positions: [primary, ...alternates],
      skill_moves: intOrUndef(row.skill_moves),
      weak_foot: intOrUndef(row.weak_foot),
      attributes,
      playstyles: splitList(row.playstyles).map((p) => ({ name: p.replace(/\+$/, "").trim(), plus: p.endsWith("+") })),
      source_updated_at: isoDate(row.snapshot_date),
      // EA's own launch ratings, but taken second-hand from a dataset: game data, not verified in our own game.
      evidence: "game_data",
    };
    if (!rec.person.common_name || !primary) {
      out.rejected.push({ ref, reason: "missing name or position" });
      continue;
    }
    out.records.push(rec);
  }
  out.snapshotAt = out.records.find((r) => r.source_updated_at)?.source_updated_at;
  return out;
}
