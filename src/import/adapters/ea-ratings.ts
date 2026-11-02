// Maps snapshots of EA's ratings feed (written by scripts/fetch-ea-ratings.ts) to CardRecords.
// The feed's shape was checked against live responses on 2026-11-02. Anything it can't map is
// counted in the run's warnings or rejected with a reason, never dropped silently.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CardRecordInput, LoadedInput } from "../record.js";
import { extractPage, type SnapshotManifest } from "../ea-feed.js";

interface EaRef { id?: number | string; label?: string; shortLabel?: string }
interface EaItem {
  id: number;
  overallRating: number;
  firstName?: string | null;
  lastName?: string | null;
  commonName?: string | null;
  birthdate?: string | null;            // "6/15/1992 12:00:00 AM"
  height?: number | null;
  weight?: number | null;
  skillMoves?: number | null;
  weakFootAbility?: number | null;
  preferredFoot?: number | null;        // 1 = right, 2 = left
  leagueName?: string | null;
  avatarUrl?: string | null;
  gender?: EaRef | null;
  nationality?: EaRef | null;
  team?: EaRef | null;
  position?: EaRef | null;
  alternatePositions?: EaRef[] | null;
  playerAbilities?: { label?: string; type?: { id?: string } }[] | null;
  stats?: Record<string, { value?: number | null } | null> | null;
}

/** Feed stat keys are camelCase versions of attribute_defs keys: ballControl -> ball_control. */
export const camelToSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const FEET: Record<number, "left" | "right"> = { 1: "right", 2: "left" };

function isoBirthdate(v: string | null | undefined): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v ?? "");
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : undefined;
}

function genderOf(g: EaRef | null | undefined): "men" | "women" | undefined {
  if (/women/i.test(g?.label ?? "")) return "women";
  if (/men/i.test(g?.label ?? "")) return "men";
  return g?.id === 0 ? "men" : g?.id === 1 ? "women" : undefined;
}

const asInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);

/** Counts things the adapter couldn't map so they can be reported once per run. */
class Tally {
  private counts = new Map<string, number>();
  add(what: string) { this.counts.set(what, (this.counts.get(what) ?? 0) + 1); }
  lines() { return [...this.counts].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} (${n} cards)`); }
}

export function mapEaItem(item: EaItem, season: string, knownAttributes: Set<string>, tally: Tally): CardRecordInput {
  const gender = genderOf(item.gender);
  const primary = item.position?.shortLabel?.toUpperCase();
  const positions = [primary, ...(item.alternatePositions ?? []).map((p) => p.shortLabel?.toUpperCase())]
    .filter((p, i, all): p is string => !!p && all.indexOf(p) === i);

  const attributes: Record<string, number> = {};
  for (const [key, stat] of Object.entries(item.stats ?? {})) {
    const attr = camelToSnake(key);
    const value = asInt(stat?.value);
    if (!knownAttributes.has(attr)) tally.add(`skipped unknown stat '${key}'`);
    else if (value === undefined || value < 1 || value > 99) tally.add(`skipped stat '${key}' with no usable value`);
    else attributes[attr] = value;
  }

  const playstyles: { name: string; plus: boolean }[] = [];
  for (const a of item.playerAbilities ?? []) {
    const type = a.type?.id;
    const label = (a.label ?? "").trim();
    if (!label) tally.add("skipped ability with no label");
    else if (type === "playStyle") playstyles.push({ name: label, plus: false });
    else if (type === "playStylePlus") playstyles.push({ name: label.replace(/\+$/, "").trim(), plus: true });
    else tally.add(`skipped ability type '${type}' (e.g. ${label})`);
  }

  const foot = item.preferredFoot == null ? undefined : FEET[item.preferredFoot];
  if (item.preferredFoot != null && !foot) tally.add(`unknown preferredFoot value ${item.preferredFoot}`);

  const name = item.commonName?.trim() || [item.firstName, item.lastName].filter(Boolean).join(" ").trim();
  return {
    card_key: `${season}:${item.id}`,
    ea_item_id: item.id,
    person: {
      key: String(item.id),
      ea_person_id: item.id,
      common_name: name,
      first_name: item.firstName ?? undefined,
      last_name: item.lastName ?? undefined,
      birth_date: isoBirthdate(item.birthdate),
      gender,
      height_cm: asInt(item.height),
      weight_kg: asInt(item.weight),
      preferred_foot: foot,
    },
    season,
    version: "base",
    overall: item.overallRating,
    nation: { name: item.nationality?.label ?? "", ea_id: asInt(item.nationality?.id) },
    league: item.leagueName ? { name: item.leagueName, gender } : undefined,
    club: item.team?.label ? { name: item.team.label, ea_id: asInt(item.team.id) } : undefined,
    positions,
    skill_moves: asInt(item.skillMoves),
    weak_foot: asInt(item.weakFootAbility),
    attributes,
    playstyles,
    image_url: item.avatarUrl ?? undefined,
    evidence: "game_data",
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Loads one snapshot folder (with manifest.json) or a folder of snapshot folders. */
export function loadEaRatingsSnapshot(path: string, knownAttributes?: Set<string>): LoadedInput {
  const dirs = existsSync(join(path, "manifest.json"))
    ? [path]
    : readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(path, d.name, "manifest.json")))
        .map((d) => join(path, d.name));
  if (!dirs.length) throw new Error(`No manifest.json in ${path} or its subfolders. Run \`npm run fetch:ea\` first.`);

  const known = knownAttributes ?? DEFAULT_ATTRIBUTES;
  const tally = new Tally();
  const warnings: string[] = [];
  const records: CardRecordInput[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const manifestTexts: string[] = [];
  let snapshotAt: string | undefined;

  for (const dir of dirs) {
    const manifestText = readFileSync(join(dir, "manifest.json"), "utf8");
    manifestTexts.push(manifestText);
    const manifest = JSON.parse(manifestText) as SnapshotManifest;
    const season = manifest.edition ?? "FC27";
    if (!snapshotAt || manifest.started_at < snapshotAt) snapshotAt = manifest.started_at;
    if (!manifest.complete) warnings.push(`${dir}: snapshot is incomplete (the download stopped early)`);
    let items = 0;
    for (const page of manifest.pages) {
      const text = readFileSync(join(dir, page.file), "utf8");
      if (sha256(text) !== page.sha256) throw new Error(`${join(dir, page.file)} doesn't match its manifest hash`);
      for (const raw of extractPage(JSON.parse(text)).items) {
        const item = raw as EaItem;
        const key = `${season}:${item.id}`;
        items++;
        // Rank-ordered paging can repeat an item if the feed changes mid-download.
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key);
        records.push(mapEaItem(item, season, known, tally));
      }
    }
    if (manifest.total_reported !== undefined && manifest.total_reported !== items) {
      warnings.push(`${dir}: feed reported ${manifest.total_reported} items, snapshot has ${items}`);
    }
  }
  if (duplicates) warnings.push(`skipped ${duplicates} duplicate items repeated across pages`);
  warnings.push(...tally.lines());
  return { output: { records, rejected: [], warnings, snapshotAt }, hashInput: manifestTexts.join("\n") };
}

// Mirrors attribute_defs in migrations/0002 (a test keeps the two in step).
export const DEFAULT_ATTRIBUTES = new Set([
  "pac", "sho", "pas", "dri", "def", "phy", "acceleration", "sprint_speed", "positioning", "finishing", "shot_power",
  "long_shots", "volleys", "penalties", "vision", "crossing", "free_kick_accuracy", "short_passing", "long_passing",
  "curve", "agility", "balance", "reactions", "ball_control", "dribbling", "composure", "interceptions",
  "heading_accuracy", "defensive_awareness", "standing_tackle", "sliding_tackle", "jumping", "stamina", "strength",
  "aggression", "gk_diving", "gk_handling", "gk_kicking", "gk_positioning", "gk_reflexes",
]);
