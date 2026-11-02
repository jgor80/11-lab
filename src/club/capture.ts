// Passive club capture (Jeff's choice, 2026-11-02): the XI Lab browser helper reads ONLY the club and squad
// lists the EA Web App has already downloaded because the user opened them, plus the Web App's own name files
// (players.json, and the localisation strings it loads) so ids can be shown as names. It never sends a request,
// clicks, moves, lists or quick-sells anything. This module is the pure part.
//
// UNVERIFIED: the field names below follow the Web App's public behaviour in earlier seasons (itemData with
// resourceId / assetId / rating / preferredPosition / possiblePositions / teamid / leagueId / nation / rareflag /
// untradeable / attributeArray). Nothing here has been checked against FC 27 yet; the first real capture does
// that. Anything unexpected is skipped, never guessed.

export interface ClubItem {
  /** The item instance in this club (EA's `id`); unique per copy you own. */
  item_id: number;
  /** EA's item (resource) id: the card version. Matches player_cards.ea_item_id. */
  ea_item_id: number;
  asset_id: number | null;
  kind: "player" | "manager";
  rating: number | null;
  position: string | null;
  positions: string[];
  team_id: number | null;
  league_id: number | null;
  nation_id: number | null;
  rare_flag: number | null;
  untradeable: boolean;
  loan: boolean;
  /** pac, sho, pas, dri, def, phy when the Web App sent exactly six face stats. */
  stats: [number, number, number, number, number, number] | null;
  skill_moves: number | null;
  weak_foot: number | null;
  /** Where it was seen: the club list or a squad. */
  seen_in: "club" | "squad";
}

/** Names the Web App itself loaded, keyed by EA id. Only the ids that appear in captured items are exported. */
export interface ClubNames {
  players: Record<string, string>;
  teams: Record<string, string>;
  leagues: Record<string, string>;
  nations: Record<string, string>;
}

export interface ClubExport {
  format: "xilab-club-capture";
  version: 1;
  verified: false;
  captured_at: string;
  items: ClubItem[];
  names: ClubNames;
}

const path = (url: string) => {
  try {
    return new URL(url, "https://example.invalid").pathname;
  } catch {
    return "";
  }
};

/** Club list and squad responses (your own items). Kept separate from the transfer-market check on purpose. */
export function isClubResponse(url: string): "club" | "squad" | null {
  const p = path(url);
  if (/\/ut\/game\/fc\d+\/club$/i.test(p)) return "club";
  if (/\/ut\/game\/fc\d+\/squad\/(\d+|active)$/i.test(p)) return "squad";
  return null;
}

/** The Web App's player name file. */
export const isPlayerNames = (url: string) => /\/players\.json$/i.test(path(url));
/** The Web App's localisation strings (team, league and nation names live here). */
export const isLocalisation = (url: string) => /\/loc\/[^/]*\.json$/i.test(path(url)) || /\/loc\/[a-z]{2}[_-][A-Z]{2}\.json$/i.test(path(url));

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const nonNeg = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const POS = /^[A-Z]{2,3}$/;

function itemsOf(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const j = json as Record<string, unknown>;
  // Club: { itemData: [...] }. Squad: { players: [{ itemData }], manager: [{ itemData }] } in past seasons.
  const out: Record<string, unknown>[] = [];
  const push = (v: unknown) => {
    if (v && typeof v === "object") out.push(((v as Record<string, unknown>).itemData as Record<string, unknown>) ?? (v as Record<string, unknown>));
  };
  if (Array.isArray(j.itemData)) j.itemData.forEach(push);
  if (Array.isArray(j.players)) j.players.forEach(push);
  if (Array.isArray(j.manager)) j.manager.forEach(push);
  return out;
}

export function summarizeClub(json: unknown, seen_in: "club" | "squad"): ClubItem[] {
  const out: ClubItem[] = [];
  for (const it of itemsOf(json)) {
    const kind = it.itemType === "manager" ? "manager" : it.itemType === undefined || it.itemType === "player" ? "player" : null;
    const item_id = int(it.id);
    const ea_item_id = int(it.resourceId);
    if (!kind || !item_id || !ea_item_id) continue;
    const attrs = Array.isArray(it.attributeArray) && it.attributeArray.length === 6 && it.attributeArray.every((n) => typeof n === "number" && n >= 1 && n <= 99)
      ? (it.attributeArray as ClubItem["stats"])
      : null;
    const positions = Array.isArray(it.possiblePositions) ? (it.possiblePositions as unknown[]).filter((p): p is string => typeof p === "string" && POS.test(p)) : [];
    const position = typeof it.preferredPosition === "string" && POS.test(it.preferredPosition) ? it.preferredPosition : null;
    out.push({
      item_id, ea_item_id, asset_id: int(it.assetId), kind,
      rating: typeof it.rating === "number" && it.rating >= 1 && it.rating <= 99 ? it.rating : null,
      position, positions: position && !positions.includes(position) ? [position, ...positions] : positions,
      team_id: int(it.teamid), league_id: int(it.leagueId), nation_id: int(it.nation), rare_flag: nonNeg(it.rareflag),
      untradeable: it.untradeable === true, loan: typeof it.loans === "number" && it.loans > 0,
      stats: attrs, skill_moves: nonNeg(it.skillmoves), weak_foot: nonNeg(it.weakfootabilityrating), seen_in,
    });
  }
  return out;
}

/** players.json: { Players: [{ id, f, l, c }], LegendsPlayers: [...] } in past seasons. Common name wins. */
export function parsePlayerNames(json: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const j = json as Record<string, unknown> | null;
  for (const key of ["Players", "LegendsPlayers"]) {
    const list = j && Array.isArray(j[key]) ? (j[key] as Record<string, unknown>[]) : [];
    for (const p of list) {
      const id = int(p?.id);
      if (!id) continue;
      const c = typeof p.c === "string" ? p.c.trim() : "";
      const f = typeof p.f === "string" ? p.f.trim() : "";
      const l = typeof p.l === "string" ? p.l.trim() : "";
      const name = c || [f, l].filter(Boolean).join(" ");
      if (name) out[id] = name;
    }
  }
  return out;
}

/**
 * Localisation strings: a flat { key: text } object. Team, league and nation names were keyed like
 * "global.teamFull.<year>.<id>", "global.leagueFull.<year>.<id>" and "search.nationName.nation<id>" in past
 * seasons; the patterns are deliberately loose and anything else is ignored.
 */
export function parseLocalisedNames(json: unknown): Pick<ClubNames, "teams" | "leagues" | "nations"> {
  const out = { teams: {} as Record<string, string>, leagues: {} as Record<string, string>, nations: {} as Record<string, string> };
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (typeof v !== "string" || !v.trim()) continue;
    let m = k.match(/^global\.teamFull\.\d{4}\.(\d+)$/i);
    if (m) { out.teams[m[1]!] = v.trim(); continue; }
    m = k.match(/^global\.leagueFull\.\d{4}\.(\d+)$/i);
    if (m) { out.leagues[m[1]!] = v.trim(); continue; }
    m = k.match(/^search\.nationName\.nation(\d+)$/i);
    if (m) out.nations[m[1]!] = v.trim();
  }
  return out;
}

/** Newest copy of each owned item wins (re-opening the club refreshes it). */
export function mergeClubItems(have: ClubItem[], add: ClubItem[]): ClubItem[] {
  const m = new Map(have.map((i) => [i.item_id, i]));
  for (const i of add) m.set(i.item_id, { ...m.get(i.item_id), ...i, seen_in: m.get(i.item_id)?.seen_in === "club" ? "club" : i.seen_in });
  return [...m.values()];
}

/** The file you import into XI Lab: your items plus only the names those items need. */
export function buildClubExport(items: ClubItem[], names: ClubNames, captured_at = new Date().toISOString()): ClubExport {
  const pick = (all: Record<string, string>, ids: (number | null)[]) =>
    Object.fromEntries([...new Set(ids.filter((x): x is number => x !== null).map(String))].filter((id) => all[id]).map((id) => [id, all[id]!]));
  return {
    format: "xilab-club-capture", version: 1, verified: false, captured_at, items,
    names: {
      players: pick(names.players, items.map((i) => i.asset_id)),
      teams: pick(names.teams, items.map((i) => i.team_id)),
      leagues: pick(names.leagues, items.map((i) => i.league_id)),
      nations: pick(names.nations, items.map((i) => i.nation_id)),
    },
  };
}
