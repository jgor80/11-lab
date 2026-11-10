// Passive account capture (Jeff, 2026-11-09): while the user is signed in to the EA Web App, the XI Lab helper copies
// what the Web App already downloaded about their own account: coins, FC Points and other currencies, club record,
// the transfer list, watchlist and unassigned pile, Squad Building Challenges, objectives and season progress.
// It never sends a request of its own, and never lists, bids, buys, claims or submits anything. This module is the
// pure part: which responses count, and what is kept from each.
//
// What loads when (docs/web-app-endpoints.md, FC 27 sign-in capture 2026-11-08): `usermassinfo`, `purchased/items`,
// `tradepile`, `watchlist` and `scmp/data/lite` load at sign-in by themselves; `sbs/sets` when the user opens SBCs;
// `scmp/campaign…` when they open Objectives; `user/credits` after the balance changes.
//
// UNVERIFIED on FC 27: the addresses above are verified, the BODIES are not (field names follow earlier seasons as
// community clients read them). Anything unexpected is skipped, never guessed, and each section keeps the field
// names it saw (`shape`, names only, never values) so the first real capture can confirm or correct this.
// Personal ids (persona id, Nucleus id, seller names) are never kept.

import { evolutionShape, isEvolutions, readEvolutions, type EvolutionRaw } from "./evolutions.js";
export type { EvolutionRaw } from "./evolutions.js";

export interface Currency { name: string; funds: number }

export interface Balance {
  coins: number | null;
  points: number | null;
  draft_tokens: number | null;
  /** Every currency EA listed, by its own name (COINS, POINTS, DRAFT_TOKEN and anything new this season). */
  currencies: Currency[];
}

export interface Profile {
  persona_name: string | null;
  club_name: string | null;
  club_abbr: string | null;
  established: string | null;
  won: number | null;
  lost: number | null;
  draw: number | null;
  trophies: number | null;
  division_online: number | null;
  division_offline: number | null;
  unopened_packs: number | null;
  unassigned_count: number | null;
  /** Pile capacities from EA's pile sizes (transfer list, watchlist, unassigned, club), when sent. */
  tradepile_max: number | null;
  watchlist_max: number | null;
  platform_name: string | null;
}

export type TradeState = "listed" | "sold" | "expired" | "unlisted";
export type WatchState = "winning" | "outbid" | "won" | "lost" | "expired" | "watching";

export interface PileItem {
  item_id: number;
  ea_item_id: number;
  item_type: string | null;
  rating: number | null;
  rare_flag: number | null;
  untradeable: boolean;
}

export interface TradeItem extends PileItem {
  trade_id: string | null;
  state: TradeState | WatchState;
  buy_now: number | null;
  current_bid: number | null;
  starting_bid: number | null;
  /** When the listing ends (from EA's seconds-left), null when not listed. */
  expires_at: string | null;
  last_sale_price: number | null;
}

export interface UnassignedItem extends PileItem { duplicate: boolean }

export interface SbcAward { type: string; value: number | null; count: number | null; untradeable: boolean }

export interface SbcSet {
  set_id: number;
  name: string;
  category: string | null;
  description: string | null;
  challenges: number | null;
  completed: number | null;
  times_completed: number | null;
  /** How many times it can be done; null = once, 0 or "unlimited" become null too with repeatable true. */
  repeat_limit: number | null;
  repeatable: boolean;
  end_at: string | null;
  awards: SbcAward[];
}

/** One SBC requirement as EA sent it (FC 27 field names unverified): read by the site, never here. */
export interface SbcRequirementRaw {
  /** EA's requirement type, e.g. TEAM_RATING, CHEMISTRY_POINTS, LEAGUE_ID (or the numeric key when no name came). */
  type: string;
  /** GREATER / LOWER / EXACT (min / max / exactly) when sent. */
  scope: string | null;
  values: number[];
  /** How many players it applies to (-1 or null = all / the squad). */
  count: number | null;
  slot: number | null;
}

/** One challenge inside an SBC set, from the answer the Web App loads when the user opens that set. */
export interface SbcChallenge {
  set_id: number;
  challenge_id: number;
  name: string;
  description: string | null;
  /** EA's formation code, e.g. f4231. */
  formation: string | null;
  status: string | null;
  /** AND / OR between requirements, when sent. */
  operation: string | null;
  requirements: SbcRequirementRaw[];
  awards: SbcAward[];
  end_at: string | null;
}

export interface Objective {
  id: number | null;
  name: string;
  group: string | null;
  progress: number | null;
  target: number | null;
  done: boolean;
  end_at: string | null;
  xp: number | null;
}

export interface Section<T> { seen_at: string; data: T }

export interface AccountState {
  balance?: Section<Balance>;
  profile?: Section<Profile>;
  tradepile?: Section<TradeItem[]>;
  watchlist?: Section<TradeItem[]>;
  unassigned?: Section<UnassignedItem[]>;
  sbcs?: Section<SbcSet[]>;
  /** Challenges (with requirements) of the SBC sets the user opened, newest first. */
  sbc_challenges?: Section<SbcChallenge[]>;
  /** Evolutions the Web App showed (Evolutions screen), newest copy of each. */
  evolutions?: Section<EvolutionRaw[]>;
  objectives?: Section<Objective[]>;
  /** Season progress numbers (level, XP and the like) by EA's own key. */
  season?: Section<Record<string, number>>;
  /** Field names seen per response kind, to check EA's FC 27 shape. */
  shape?: Record<string, string[]>;
}

export interface AccountExport extends AccountState {
  format: "xilab-account-capture";
  version: 1;
  verified: false;
  captured_at: string;
}

// ------------------------------------------------------------------ which responses

const path = (url: string) => {
  try {
    return new URL(url, "https://example.invalid").pathname;
  } catch {
    return "";
  }
};
const ut = (rest: string) => new RegExp(`/ut/game/fc\\d+/${rest}$`, "i");

export type AccountKind = "massinfo" | "credits" | "tradepile" | "watchlist" | "unassigned" | "sbcs" | "sbc_challenges" | "evolutions" | "objectives" | "season";

/** The account response this URL is, or null. Only GETs the Web App makes by itself or on the user's own clicks. */
export function accountKind(url: string, method = "GET"): AccountKind | null {
  if (method.toUpperCase() !== "GET") return null;
  const p = path(url);
  if (ut("usermassinfo").test(p)) return "massinfo";
  if (ut("user/credits").test(p)) return "credits";
  if (ut("tradepile").test(p)) return "tradepile";
  if (ut("watchlist").test(p)) return "watchlist";
  if (ut("purchased/items").test(p)) return "unassigned";
  if (ut("sbs/sets").test(p)) return "sbcs";
  if (ut("sbs/setId/\\d+/challenges").test(p)) return "sbc_challenges";
  if (isEvolutions(url, method)) return "evolutions";
  if (/\/ut\/game\/fc\d+\/scmp\/campaign/i.test(p)) return "objectives";
  if (ut("scmp/data/lite").test(p) || /\/fc\/user\/season(\/lite)?$/i.test(p)) return "season";
  return null;
}

// ------------------------------------------------------------------ helpers

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const nonNeg = (v: unknown, max = 2_000_000_000): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const keys = (o: unknown) => (rec(o) ? Object.keys(rec(o)!).sort().slice(0, 80) : []);
/** Personal ids and other people's names: never kept, even in the shape. */
const PERSONAL = /^(persona(id)?|nucleus|nucpersid|userid|sellerid|sellername|sellerestablished|pid|email|gamertag|displayname)$/i;

const secondsToIso = (v: unknown, now: number, max = 400 * 86_400): string | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v < max ? new Date(now + v * 1000).toISOString() : null;
const epochToIso = (v: unknown): string | null => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const ms = v > 1e12 ? v : v * 1000;
  return ms > Date.UTC(2005, 0, 1) && ms < Date.UTC(2040, 0, 1) ? new Date(ms).toISOString() : null;
};

// ------------------------------------------------------------------ balance and profile

/** Coins, FC Points, draft tokens and every other currency from any object carrying `credits` / `currencies`. */
export function readBalance(raw: unknown): Balance | null {
  const o = rec(raw);
  if (!o) return null;
  const currencies: Currency[] = [];
  for (const c of Array.isArray(o.currencies) ? o.currencies : []) {
    const r = rec(c);
    const name = str(r?.name, 40)?.toUpperCase();
    const funds = nonNeg(r?.finalFunds) ?? nonNeg(r?.funds);
    if (name && funds !== null && !currencies.some((x) => x.name === name)) currencies.push({ name, funds });
  }
  const find = (re: RegExp) => currencies.find((c) => re.test(c.name))?.funds ?? null;
  const coins = find(/^COINS?$/) ?? nonNeg(o.credits);
  if (coins === null && !currencies.length) return null;
  return { coins, points: find(/^(FC_?)?POINTS?$/), draft_tokens: find(/DRAFT/), currencies: currencies.slice(0, 20) };
}

function pileSizes(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  const entries = rec(raw)?.entries;
  for (const e of Array.isArray(entries) ? entries : []) {
    const r = rec(e);
    const k = nonNeg(r?.key), v = nonNeg(r?.value);
    if (k !== null && v !== null) out[k] = v;
  }
  return out;
}

/** The sign-in summary: club name, record, divisions, pile counts and the balance. */
export function readMassInfo(json: unknown): { profile: Profile | null; balance: Balance | null } {
  const j = rec(json);
  const u = rec(j?.userInfo);
  if (!u) return { profile: null, balance: readBalance(j) };
  const piles = pileSizes(j?.pileSizeClientData);
  const unopened = rec(u.unopenedPacks);
  const unopenedCount = unopened ? Object.values(unopened).reduce<number>((n, v) => n + (nonNeg(v) ?? 0), 0) : nonNeg(u.unopenedPacks);
  const purchased = rec(j?.purchasedItems);
  const purchasedCount = Array.isArray(purchased?.itemData) ? (purchased!.itemData as unknown[]).length : null;
  return {
    profile: {
      persona_name: str(u.personaName, 60),
      club_name: str(u.clubName, 60),
      club_abbr: str(u.clubAbbr, 10),
      established: str(u.established, 40),
      won: nonNeg(u.won), lost: nonNeg(u.loss ?? u.lost), draw: nonNeg(u.draw), trophies: nonNeg(u.trophies),
      division_online: nonNeg(u.divisionOnline, 100), division_offline: nonNeg(u.divisionOffline, 100),
      unopened_packs: unopenedCount,
      unassigned_count: nonNeg(u.unassignedPileSize) ?? purchasedCount,
      // EA pile ids in earlier seasons: 2 = transfer list, 4 = watchlist.
      tradepile_max: piles[2] ?? null, watchlist_max: piles[4] ?? null,
      platform_name: str(u.accountCreatedPlatformName, 20),
    },
    balance: readBalance(u) ?? readBalance(j),
  };
}

// ------------------------------------------------------------------ piles

function pileItem(raw: unknown): PileItem | null {
  const it = rec(raw);
  if (!it) return null;
  const item_id = int(it.id), ea_item_id = int(it.resourceId) ?? int(it.assetId);
  if (!item_id || !ea_item_id) return null;
  return {
    item_id, ea_item_id, item_type: str(it.itemType, 30),
    rating: typeof it.rating === "number" && it.rating >= 1 && it.rating <= 99 ? it.rating : null,
    rare_flag: nonNeg(it.rareflag, 1000), untradeable: it.untradeable === true,
  };
}

function tradeStateOf(a: Record<string, unknown>, watch: boolean): TradeState | WatchState {
  const ts = typeof a.tradeState === "string" ? a.tradeState.toLowerCase() : null;
  const bid = typeof a.bidState === "string" ? a.bidState.toLowerCase() : null;
  if (!watch) {
    if (!int(a.tradeId) || !ts || ts === "inactive") return "unlisted";
    if (ts === "closed") return "sold";
    if (ts === "expired") return "expired";
    return "listed";
  }
  if (ts === "active") return bid === "highest" ? "winning" : bid === "outbid" ? "outbid" : "watching";
  if (ts === "closed") return bid === "highest" ? "won" : "lost";
  if (ts === "expired") return "expired";
  return "watching";
}

/** Transfer list or watchlist: { auctionInfo: [{ tradeId, tradeState, bidState, buyNowPrice, …, itemData }] }. */
export function readTradeList(json: unknown, watch: boolean, now = Date.now()): TradeItem[] | null {
  const j = rec(json);
  if (!j || !Array.isArray(j.auctionInfo)) return null;
  const out: TradeItem[] = [];
  for (const raw of j.auctionInfo.slice(0, 200)) {
    const a = rec(raw);
    const item = pileItem(a?.itemData);
    if (!a || !item) continue;
    const state = tradeStateOf(a, watch);
    const live = state === "listed" || state === "winning" || state === "outbid" || state === "watching";
    out.push({
      ...item, trade_id: int(a.tradeId) ? String(a.tradeId) : null, state,
      buy_now: int(a.buyNowPrice), current_bid: int(a.currentBid), starting_bid: int(a.startingBid),
      expires_at: live ? secondsToIso(a.expires, now, 3 * 86_400) : null,
      last_sale_price: int(rec(a.itemData)?.lastSalePrice),
    });
  }
  return out;
}

/** Unassigned pile: { itemData: [...], duplicateItemIdList: [{ itemId, duplicateItemId }] }. */
export function readUnassigned(json: unknown): UnassignedItem[] | null {
  const j = rec(json);
  if (!j || !Array.isArray(j.itemData)) return null;
  const dupes = new Set<number>();
  for (const d of Array.isArray(j.duplicateItemIdList) ? j.duplicateItemIdList : []) {
    const id = int(rec(d)?.itemId);
    if (id) dupes.add(id);
  }
  return j.itemData.slice(0, 500).map(pileItem).filter((i): i is PileItem => !!i).map((i) => ({ ...i, duplicate: dupes.has(i.item_id) }));
}

// ------------------------------------------------------------------ SBCs, objectives, season

function award(raw: unknown): SbcAward | null {
  const a = rec(raw);
  const type = str(a?.type, 30) ?? str(a?.awardType, 30);
  if (!a || !type) return null;
  return { type: type.toLowerCase(), value: nonNeg(a.value) ?? nonNeg(a.itemId) ?? nonNeg(a.packId), count: nonNeg(a.count, 1000), untradeable: a.untradeable === true || a.isUntradeable === true };
}

/** SBC hub: { categories: [{ name, sets: [{ setId, name, challengesCount, challengesCompletedCount, endTime, … }] }] }. */
export function readSbcSets(json: unknown, now = Date.now()): SbcSet[] | null {
  const j = rec(json);
  if (!j) return null;
  const cats = Array.isArray(j.categories) ? j.categories : Array.isArray(j.sets) ? [{ name: null, sets: j.sets }] : null;
  if (!cats) return null;
  const out: SbcSet[] = [];
  const seen = new Set<number>();
  for (const c of cats) {
    const cat = rec(c);
    for (const s of Array.isArray(cat?.sets) ? (cat!.sets as unknown[]) : []) {
      const r = rec(s);
      const set_id = int(r?.setId) ?? int(r?.id);
      const name = str(r?.name, 120);
      if (!r || !set_id || !name || seen.has(set_id) || r.hidden === true) continue;
      seen.add(set_id);
      const mode = typeof r.repeatabilityMode === "string" ? r.repeatabilityMode.toUpperCase() : null;
      const repeats = nonNeg(r.repeats, 100_000);
      out.push({
        set_id, name, category: str(cat?.name, 60), description: str(r.description, 300),
        challenges: nonNeg(r.challengesCount, 500), completed: nonNeg(r.challengesCompletedCount, 500), times_completed: nonNeg(r.timesCompleted, 100_000),
        repeat_limit: mode === "LIMITED" ? repeats : null, repeatable: !!mode && mode !== "NON_REPEATABLE",
        end_at: secondsToIso(r.endTime, now) ?? epochToIso(r.endTimeStamp),
        awards: (Array.isArray(r.awards) ? r.awards : []).map(award).filter((a): a is SbcAward => !!a).slice(0, 10),
      });
      if (out.length >= 600) return out;
    }
  }
  return out;
}

/** The set id in `sbs/setId/<id>/challenges`. */
export function sbcSetIdFromUrl(url: string): number | null {
  const m = /\/sbs\/setId\/(\d{1,10})\/challenges/i.exec(path(url));
  return m ? int(m[1]) : null;
}

const SCOPES: Record<string, string> = { "0": "GREATER", "1": "LOWER", "2": "EXACT" };

function requirement(raw: unknown): SbcRequirementRaw | null {
  const r = rec(raw);
  if (!r) return null;
  const type = str(r.type, 60) ?? str(r.eligibilityKey, 60) ?? (nonNeg(r.eligibilityKey, 1000) !== null ? String(r.eligibilityKey) : null);
  if (!type) return null;
  const raws = Array.isArray(r.eligibilityValues) ? r.eligibilityValues : Array.isArray(r.values) ? r.values : [r.eligibilityValue ?? r.value];
  const values = raws.map((v) => (typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? v : typeof v === "string" && /^-?\d{1,10}$/.test(v) ? Number(v) : null))
    .filter((v): v is number => v !== null).slice(0, 40);
  const scopeRaw = r.scope ?? r.eligibilityScope ?? r.operation;
  const scope = typeof scopeRaw === "string" ? scopeRaw.toUpperCase().slice(0, 20) : typeof scopeRaw === "number" ? SCOPES[String(scopeRaw)] ?? String(scopeRaw) : null;
  const count = typeof r.count === "number" && Number.isInteger(r.count) && r.count >= -1 && r.count <= 30 ? r.count : null;
  const slot = typeof r.eligibilitySlot === "number" && Number.isInteger(r.eligibilitySlot) && r.eligibilitySlot >= -1 && r.eligibilitySlot <= 30 ? r.eligibilitySlot : null;
  return { type: type.toUpperCase(), scope, values, count, slot };
}

/** An opened SBC set: { challenges: [{ challengeId, name, formation, elgReq: [...], awards, status, … }] }. */
export function readSbcChallenges(json: unknown, setId: number | null, now = Date.now()): SbcChallenge[] | null {
  const j = rec(json);
  const list = Array.isArray(j?.challenges) ? j!.challenges as unknown[] : Array.isArray(json) ? json as unknown[] : null;
  if (!list || !setId) return null;
  const out: SbcChallenge[] = [];
  for (const c of list.slice(0, 60)) {
    const r = rec(c);
    const challenge_id = int(r?.challengeId) ?? int(r?.id);
    const name = str(r?.name, 120);
    if (!r || !challenge_id || !name) continue;
    const reqs = Array.isArray(r.elgReq) ? r.elgReq : Array.isArray(r.requirements) ? r.requirements : Array.isArray(r.eligibilityRequirements) ? r.eligibilityRequirements : [];
    out.push({
      set_id: setId, challenge_id, name, description: str(r.description, 300),
      formation: str(r.formation, 20), status: str(r.status, 30), operation: str(r.elgOperation, 10) ?? str(r.operation, 10),
      requirements: reqs.map(requirement).filter((x): x is SbcRequirementRaw => !!x).slice(0, 20),
      awards: (Array.isArray(r.awards) ? r.awards : []).map(award).filter((a): a is SbcAward => !!a).slice(0, 10),
      end_at: secondsToIso(r.endTime, now) ?? epochToIso(r.endTimeStamp),
    });
  }
  return out;
}

const NAME_KEYS = ["name", "title", "description", "nameLoc", "titleLoc"] as const;
const PROGRESS_PAIRS: [string, string][] = [
  ["progress", "target"], ["currentValue", "targetValue"], ["progressValue", "targetValue"], ["completedCount", "totalCount"],
  ["objectivesCompleted", "objectivesTotal"], ["progressCount", "count"], ["current", "target"], ["value", "target"],
];

/**
 * Objectives: the campaign answers' exact layout isn't known for FC 27, so any object below the answer that has a name
 * and a progress / target pair is read as one objective, under the nearest named parent as its group.
 */
export function readObjectives(json: unknown, now = Date.now()): Objective[] | null {
  const out: Objective[] = [];
  const walk = (v: unknown, group: string | null, depth: number) => {
    if (out.length >= 400 || depth > 7) return;
    if (Array.isArray(v)) return void v.slice(0, 300).forEach((x) => walk(x, group, depth + 1));
    const o = rec(v);
    if (!o) return;
    const name = NAME_KEYS.map((k) => str(o[k], 160)).find(Boolean) ?? null;
    const pair = PROGRESS_PAIRS.find(([p, t]) => nonNeg(o[p]) !== null && int(o[t]) !== null);
    if (name && pair) {
      const progress = nonNeg(o[pair[0]]), target = int(o[pair[1]]);
      const state = typeof o.state === "string" ? o.state.toLowerCase() : typeof o.status === "string" ? o.status.toLowerCase() : "";
      out.push({
        id: int(o.id) ?? int(o.objectiveId) ?? int(o.groupId), name, group,
        progress, target,
        done: o.completed === true || o.isCompleted === true || /complete|claimed|redeemed|done/.test(state) || (progress !== null && target !== null && progress >= target),
        end_at: secondsToIso(o.endTime ?? o.expiryTime ?? o.secondsRemaining, now) ?? epochToIso(o.endTimestamp ?? o.endDate),
        xp: nonNeg(o.xp) ?? nonNeg(o.awardXp) ?? nonNeg(o.xpReward) ?? nonNeg(o.seasonXp),
      });
    }
    for (const [k, child] of Object.entries(o)) if (child && typeof child === "object" && !PERSONAL.test(k)) walk(child, name ?? group, depth + 1);
  };
  walk(json, null, 0);
  return out.length ? out : rec(json) || Array.isArray(json) ? [] : null;
}

const SEASON_KEY = /level|xp|tier|season|points|rank|progress|stars/i;

/** Season progress: numeric fields named like level / XP / tier / points, from the top two levels of the answer. */
export function readSeason(json: unknown): Record<string, number> | null {
  const j = rec(json);
  if (!j) return null;
  const out: Record<string, number> = {};
  const take = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (Object.keys(out).length >= 40 || PERSONAL.test(k) || /id$/i.test(k)) continue;
      if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e10 && SEASON_KEY.test(k)) out[`${prefix}${k}`.slice(0, 60)] = v;
    }
  };
  take(j, "");
  for (const [k, v] of Object.entries(j)) if (rec(v) && !PERSONAL.test(k)) take(rec(v)!, `${k}.`);
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ one response → state patch

/** What one Web App response adds to the account state (sections it doesn't carry are left out). */
export function readAccountResponse(kind: AccountKind, json: unknown, now = Date.now(), url = ""): AccountState {
  const seen_at = new Date(now).toISOString();
  const patch: AccountState = { shape: { [kind]: keys(json).filter((k) => !PERSONAL.test(k)) } };
  const balanceFrom = (b: Balance | null) => { if (b) patch.balance = { seen_at, data: b }; };
  switch (kind) {
    case "massinfo": {
      const { profile, balance } = readMassInfo(json);
      if (profile) patch.profile = { seen_at, data: profile };
      balanceFrom(balance);
      const u = rec(rec(json)?.userInfo);
      if (u) patch.shape!.massinfo_user = keys(u).filter((k) => !PERSONAL.test(k));
      break;
    }
    case "credits": balanceFrom(readBalance(json)); break;
    case "tradepile": {
      const items = readTradeList(json, false, now);
      if (items) patch.tradepile = { seen_at, data: items };
      balanceFrom(readBalance(json));
      break;
    }
    case "watchlist": {
      const items = readTradeList(json, true, now);
      if (items) patch.watchlist = { seen_at, data: items };
      balanceFrom(readBalance(json));
      break;
    }
    case "unassigned": {
      const items = readUnassigned(json);
      if (items) patch.unassigned = { seen_at, data: items };
      break;
    }
    case "sbcs": {
      const sets = readSbcSets(json, now);
      if (sets) patch.sbcs = { seen_at, data: sets };
      break;
    }
    case "sbc_challenges": {
      const list = readSbcChallenges(json, sbcSetIdFromUrl(url), now);
      if (list?.length) patch.sbc_challenges = { seen_at, data: list };
      const first = rec(Array.isArray(rec(json)?.challenges) ? (rec(json)!.challenges as unknown[])[0] : null);
      if (first) {
        patch.shape!.sbc_challenge = keys(first);
        const req = rec(Array.isArray(first.elgReq) ? first.elgReq[0] : null);
        if (req) patch.shape!.sbc_requirement = keys(req);
      }
      break;
    }
    case "evolutions": {
      const list = readEvolutions(json, now);
      if (list?.length) patch.evolutions = { seen_at, data: list };
      Object.assign(patch.shape!, evolutionShape(json));
      break;
    }
    case "objectives": {
      const list = readObjectives(json, now);
      // Several campaign answers load one after another (one per tab): an empty one doesn't wipe the others.
      if (list?.length) patch.objectives = { seen_at, data: list };
      break;
    }
    case "season": {
      const s = readSeason(json);
      if (s) patch.season = { seen_at, data: s };
      break;
    }
  }
  return patch;
}

/** Newer sections replace older ones; objectives from separate tabs (seen within 10 minutes) are combined. */
export function mergeAccount(have: AccountState | undefined, add: AccountState): AccountState {
  const out: AccountState = { ...(have ?? {}) };
  const newer = <T>(a: Section<T> | undefined, b: Section<T> | undefined) => (!a || (b && b.seen_at >= a.seen_at) ? b ?? a : a);
  out.balance = newer(out.balance, add.balance);
  out.profile = newer(out.profile, add.profile);
  out.tradepile = newer(out.tradepile, add.tradepile);
  out.watchlist = newer(out.watchlist, add.watchlist);
  out.unassigned = newer(out.unassigned, add.unassigned);
  out.sbcs = newer(out.sbcs, add.sbcs);
  if (add.evolutions) {
    // The hub and each evolution's own page add up; an evolution seen again replaces its copy; ended ones drop off.
    const now = Date.parse(add.evolutions.seen_at);
    const m = new Map((out.evolutions?.data ?? []).filter((e) => !e.end_at || Date.parse(e.end_at) > now).map((e) => [e.evo_id, e]));
    for (const e of add.evolutions.data) m.set(e.evo_id, e);
    out.evolutions = { seen_at: add.evolutions.seen_at, data: [...m.values()].slice(-150) };
  }
  if (add.sbc_challenges) {
    // Each opened set adds its challenges; a set opened again replaces its own. Newest sets first, 300 challenges kept.
    const sets = new Set(add.sbc_challenges.data.map((c) => c.set_id));
    const kept = (out.sbc_challenges?.data ?? []).filter((c) => !sets.has(c.set_id));
    out.sbc_challenges = { seen_at: add.sbc_challenges.seen_at, data: [...add.sbc_challenges.data, ...kept].slice(0, 300) };
  }
  out.season = add.season && out.season && Date.parse(add.season.seen_at) - Date.parse(out.season.seen_at) < 10 * 60_000
    ? { seen_at: add.season.seen_at, data: { ...out.season.data, ...add.season.data } } : newer(out.season, add.season);
  if (add.objectives) {
    const prev = out.objectives;
    if (prev && Date.parse(add.objectives.seen_at) - Date.parse(prev.seen_at) < 10 * 60_000) {
      const key = (o: Objective) => `${o.group ?? ""}|${o.id ?? o.name}`;
      const m = new Map(prev.data.map((o) => [key(o), o]));
      for (const o of add.objectives.data) m.set(key(o), o);
      out.objectives = { seen_at: add.objectives.seen_at, data: [...m.values()].slice(0, 600) };
    } else out.objectives = add.objectives;
  }
  if (add.shape) out.shape = { ...(out.shape ?? {}), ...add.shape };
  for (const k of Object.keys(out) as (keyof AccountState)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** The newest seen_at across sections: the helper re-uploads when this moves. */
export function accountStamp(s: AccountState | undefined): string | null {
  if (!s) return null;
  const all = [s.balance, s.profile, s.tradepile, s.watchlist, s.unassigned, s.sbcs, s.sbc_challenges, s.evolutions, s.objectives, s.season].map((x) => x?.seen_at).filter((x): x is string => !!x);
  return all.length ? all.sort().at(-1)! : null;
}

export function buildAccountExport(s: AccountState, captured_at = new Date().toISOString()): AccountExport {
  return { format: "xilab-account-capture", version: 1, verified: false, captured_at, ...s };
}
