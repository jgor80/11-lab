// The Market Lab service surface. The web Market Lab, Gaffer Bot's fut-api routes and the FUT MCP tools all call
// these, the same way the squad workspace works. Every result carries provenance (rules, sources, demo flag, as_of).
import { cardUtility, comparableCards } from "../intelligence/card.js";
import type { ChemistryRules } from "../chemistry/index.js";
import { DEFAULT_RULES, squadSchema, type Squad } from "../workspace/index.js";
import { DEFAULT_BASKETS, computeIndex, rebalance, summarizeIndex, type BasketDefinition, type BasketMembership, type IndexSummary } from "./baskets.js";
import { parsePriceImport, type UnmatchedCapture } from "./import.js";
import { classifyRegime, type RegimeResult } from "./regime.js";
import { DEFAULT_MARKET_RULES, MARKET_ENGINE_VERSION, type MarketRules } from "./rules.js";
import { change, freshness, iso, ms, round, toSeriesByCard, window, type Point } from "./series.js";
import { assessSignals, meanReversion, momentum, peerGroupKey, relativeStrength, type Benchmark, type SignalAssessment, type SignalStatus } from "./signals.js";
import { DEFAULT_PRICE_SOURCES, assertUsable } from "./sources.js";
import { compareInSquad } from "./squad-link.js";
import type { CaptureHoldStore, MarketCardSource, MembershipStore, PriceStore, WatchItem, WatchlistStore } from "./store.js";
import { analyzeTrade, type ThesisInput } from "./thesis.js";
import { WINDOWS, type MarketCard, type MarketProvenance, type Platform, type PriceObservation, type PriceSource, type Window } from "./types.js";

export interface MarketDeps {
  prices: PriceStore;
  memberships: MembershipStore;
  watchlists: WatchlistStore;
  cards: MarketCardSource;
  /** Optional: keeps captured prices for EA items not in the card database yet. Without it they're rejected. */
  holds?: CaptureHoldStore;
  sources?: PriceSource[];
  baskets?: BasketDefinition[];
  rules?: MarketRules;
  chemistry?: ChemistryRules;
  /** Injectable clock for tests and backtests. */
  now?: () => string;
  /**
   * Optional: keeps a built snapshot between requests. Building one loads every tracked card and eight days of
   * prices, so pages opened within a short time share it. Only "now" snapshots are cached, never a backtest's as_of.
   */
  snapshots?: SnapshotCache;
}

/** Remembers a snapshot under a key until the cache decides it is too old or the owner changed their data. */
export interface SnapshotCache {
  /** Part of the key that changes when shared data changes (e.g. the latest FUT.GG refresh). */
  version(): Promise<string>;
  remember<T>(owner: string, key: string, build: () => Promise<T>): Promise<T>;
}

export class MarketNotFoundError extends Error {}

const scanned = new WeakMap<object, unknown>();

type PeerBenchmark = Exclude<Benchmark, "market">;
const PEER_BENCHMARKS: readonly PeerBenchmark[] = ["category", "rating", "position", "utility"];
interface Peers {
  /** Median change of the card's peers per window (null under 3 peers) and how many peers had a change. */
  changes(b: PeerBenchmark, card: MarketCard): Record<Window, { value: number | null; n: number }>;
  /** Fresh latest prices of other cards with the same rating and primary position. */
  prices(card: MarketCard): number[];
}
const peerIndex = new WeakMap<object, Peers>();
const splitUtility = (key: string): [string, number] => {
  const i = key.lastIndexOf("|");
  return [key.slice(0, i), Number(key.slice(i + 1))];
};

/** Size and median of a sorted list with one occurrence of `skip` left out (null or not in the list = nothing left out). */
function withoutOne(sorted: number[], skip: number | null): { n: number; median: number | null } {
  let at = -1;
  if (skip !== null) {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < skip) lo = mid + 1;
      else if (sorted[mid]! > skip) hi = mid - 1;
      else {
        at = mid;
        break;
      }
    }
  }
  const n = sorted.length - (at < 0 ? 0 : 1);
  if (!n) return { n, median: null };
  const el = (k: number) => sorted[at >= 0 && k >= at ? k + 1 : k]!;
  const m = n >> 1;
  return { n, median: n % 2 ? el(m) : (el(m - 1) + el(m)) / 2 };
}

const LOOKBACK_H = 8 * 24;

/** Everything one analysis needs, loaded once at a point in time. */
interface Snapshot {
  as_of: string;
  platform: Platform;
  cards: MarketCard[];
  byId: Map<string, MarketCard>;
  series: Map<string, Point[]>;
  rows: PriceObservation[];
  members: BasketMembership[];
  indexes: IndexSummary[];
  indexSeries: Map<string, Point[]>;
  regime: RegimeResult;
}

export function createMarketService(deps: MarketDeps) {
  const rules = deps.rules ?? DEFAULT_MARKET_RULES;
  const chem = deps.chemistry ?? DEFAULT_RULES;
  const sources = deps.sources ?? DEFAULT_PRICE_SOURCES;
  const baskets = deps.baskets ?? DEFAULT_BASKETS;
  const now = deps.now ?? (() => new Date().toISOString());
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const provenance = (snap: Pick<Snapshot, "as_of" | "rows">): MarketProvenance => {
    const used = [...new Set(snap.rows.map((r) => r.source_id))];
    const demo = used.some((id) => sourceById.get(id)?.is_demo);
    return { rules_version: rules.id, engine_version: MARKET_ENGINE_VERSION, as_of: snap.as_of, demo, sources: used, evidence: demo ? "hypothesis" : "estimate" };
  };

  /** Only rows whose source is enabled and allows derived analytics feed any calculation. */
  const usable = (rows: PriceObservation[]) => rows.filter((r) => {
    const s = sourceById.get(r.source_id);
    return s && s.status === "enabled" && s.permissions.derived_analytics;
  });

  async function snapshot(owner: string, platform: Platform, as_of?: string): Promise<Snapshot> {
    const cache = deps.snapshots;
    if (as_of !== undefined || !cache) return buildSnapshot(owner, platform, as_of ?? now());
    return cache.remember(owner, `${platform}|${await cache.version()}`, () => buildSnapshot(owner, platform, now()));
  }

  async function buildSnapshot(owner: string, platform: Platform, as_of: string): Promise<Snapshot> {
    const cards = await deps.cards.list(owner);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const rows = usable(await deps.prices.query(owner, { platform, as_of, since: iso(ms(as_of) - LOOKBACK_H * 3_600_000) }));
    const series = toSeriesByCard(rows, platform, as_of);
    const members = await deps.memberships.list();
    const indexSeries = new Map<string, Point[]>();
    const indexes = baskets.map((b) => {
      const ix = computeIndex(b.id, platform, members, series, iso(ms(as_of) - LOOKBACK_H * 3_600_000), as_of, { rules });
      indexSeries.set(b.id, ix.points.map((p) => ({ t: ms(p.t), price: p.value })));
      const ids = members.filter((m) => m.basket_id === b.id && m.effective_to === null).map((m) => m.card_id);
      const current = ids.flatMap((id) => {
        const s = series.get(id);
        const f = s && freshness(s, as_of, rules);
        return s && f?.status === "fresh" ? [s.at(-1)!.price] : [];
      });
      return summarizeIndex(b, ix, current, rules);
    });
    return { as_of, platform, cards, byId, series, rows, members, indexes, indexSeries, regime: classifyRegime(indexes, rules) };
  }

  /**
   * Peer lookups for one snapshot, built once and reused for every card. Cards that share a peer rule (same
   * category, same rating, same position...) share one sorted list of peer changes, and each card just leaves
   * itself out, so scoring every card no longer compares it against every other card.
   */
  function peersOf(snap: Snapshot): Peers {
    const hit = peerIndex.get(snap);
    if (hit) return hit;
    const own = new Map<string, Record<Window, number | null>>();
    const latest = new Map<string, number>();
    for (const c of snap.cards) {
      const s = snap.series.get(c.id);
      if (!s || freshness(s, snap.as_of, rules).status !== "fresh") continue;
      own.set(c.id, Object.fromEntries(WINDOWS.map((w) => [w, change(s, w)])) as Record<Window, number | null>);
      latest.set(c.id, s.at(-1)!.price);
    }
    const keys = new Map<string, Record<PeerBenchmark, string | null>>();
    const keyOf = (c: MarketCard) => {
      let k = keys.get(c.id);
      if (!k) keys.set(c.id, (k = Object.fromEntries(PEER_BENCHMARKS.map((b) => [b, peerGroupKey(b, c)])) as Record<PeerBenchmark, string | null>));
      return k;
    };
    const groups = new Map<string, Record<Window, number[]>>();
    const group = (b: PeerBenchmark, key: string, sample: MarketCard) => {
      const id = `${b}|${key}`;
      let g = groups.get(id);
      if (g) return g;
      // "rating" and "utility" are ranges around the card, so membership is checked against a card with this key
      const inGroup = (o: MarketCard) => {
        const ok = keyOf(o)[b];
        if (ok === null) return false;
        if (b === "rating") return Math.abs(o.rating - sample.rating) <= 1;
        if (b === "utility") {
          const [line, fit] = splitUtility(key);
          const [oLine, oFit] = splitUtility(ok);
          return line === oLine && Math.abs(fit - oFit) <= 3;
        }
        return ok === key;
      };
      g = Object.fromEntries(WINDOWS.map((w) => [w, [] as number[]])) as Record<Window, number[]>;
      for (const o of snap.cards) {
        const ch = own.get(o.id);
        if (!ch || !inGroup(o)) continue;
        for (const w of WINDOWS) if (ch[w] !== null) g[w].push(ch[w]!);
      }
      for (const w of WINDOWS) g[w].sort((x, y) => x - y);
      groups.set(id, g);
      return g;
    };
    const sameSlot = new Map<string, { id: string; price: number }[]>();
    for (const c of snap.cards) {
      const price = latest.get(c.id);
      if (price === undefined) continue;
      const k = `${c.rating}|${c.positions[0]}`;
      (sameSlot.get(k) ?? sameSlot.set(k, []).get(k)!).push({ id: c.id, price });
    }
    const peers: Peers = {
      changes(b, card) {
        const key = keyOf(card)[b];
        const mine = own.get(card.id);
        const out = {} as Record<Window, { value: number | null; n: number }>;
        for (const w of WINDOWS) {
          const xs = key === null ? [] : group(b, key, card)[w];
          // The card is in its own group when it has a change of its own: leave that one value out
          const self = key !== null && mine && mine[w] !== null ? mine[w] : null;
          const rest = withoutOne(xs, self);
          out[w] = { value: rest.n >= 3 ? rest.median : null, n: rest.n };
        }
        return out;
      },
      prices: (card) => (sameSlot.get(`${card.rating}|${card.positions[0]}`) ?? []).flatMap((p) => (p.id === card.id ? [] : [p.price])),
    };
    peerIndex.set(snap, peers);
    return peers;
  }

  function benchmarksFor(snap: Snapshot, card: MarketCard) {
    const out: { benchmark: Benchmark; changes: Record<Window, number | null>; peers: number }[] = [];
    const peers = peersOf(snap);
    for (const b of PEER_BENCHMARKS) {
      const pc = peers.changes(b, card);
      out.push({ benchmark: b, changes: Object.fromEntries(WINDOWS.map((w) => [w, pc[w].value])) as Record<Window, number | null>, peers: pc["24h"].n });
    }
    const m = snap.indexes.find((i) => i.basket_id === "market");
    const ms_ = snap.indexSeries.get("market") ?? [];
    out.push({ benchmark: "market", changes: Object.fromEntries(WINDOWS.map((w) => [w, m?.value === null ? null : change(ms_, w)])) as Record<Window, number | null>, peers: m?.constituents_now ?? 0 });
    return out;
  }

  function analyse(snap: Snapshot, card: MarketCard) {
    const s = snap.series.get(card.id) ?? [];
    const fresh = freshness(s, snap.as_of, rules);
    const rs = relativeStrength(s, benchmarksFor(snap, card), rules);
    const mom = momentum(s);
    const peerPrices = peersOf(snap).prices(card);
    const mr = meanReversion(s, peerPrices, rules);
    const assessment = assessSignals({ fresh, points: window(s, LOOKBACK_H).length, rs, mom, mr, regime_primary: snap.regime.primary, rules });
    const latest = fresh.status === "fresh" ? s.at(-1)!.price : null;
    return { series: s, fresh, rs, mom, mr, assessment, latest };
  }

  const getCard = (snap: Snapshot, id: string) => {
    const c = snap.byId.get(id);
    if (!c) throw new MarketNotFoundError(`No card ${id}`);
    return c;
  };

  async function initBaskets(at: string, opts: { backfilled?: boolean } = {}) {
    const cards = await deps.cards.catalogue();
    for (const b of baskets) {
      const cur = await deps.memberships.list(b.id);
      if (opts.backfilled && cur.length) continue;
      const next = rebalance(b, cards, cur, at).map((m) => (opts.backfilled && !cur.length ? { ...m, backfilled: true } : m));
      await deps.memberships.replace(b.id, next);
    }
  }

  /** EA item id → card id: exact item id, or (base cards) the asset id when the rating matches too. */
  function eaResolver(cards: MarketCard[]) {
    const byEa = new Map<number, MarketCard>();
    for (const c of cards) if (c.ea_item_id) byEa.set(c.ea_item_id, c);
    return (ea: number, asset: number | null, rating: number | null) => {
      const hit = byEa.get(ea);
      if (hit && (rating === null || hit.rating === rating)) return hit.id;
      const base = asset ? byEa.get(asset) : undefined;
      return base && rating !== null && base.rating === rating ? base.id : null;
    };
  }

  function unmatchedReason(u: UnmatchedCapture) {
    const special = u.details?.rare_flag !== undefined && u.details.rare_flag > 1;
    return `EA item ${u.ea_item_id}${u.rating ? ` (rated ${u.rating})` : ""} isn't in your card database${special ? " (a special version: promo, Icon or Hero)" : ""}. Add the card to use this price.`;
  }

  async function relink(owner: string, cards: MarketCard[]) {
    const held = await deps.holds!.list(owner);
    if (!held.length) return { linked: 0, still_held: 0, rows: [] as PriceObservation[] };
    const resolve = eaResolver(cards);
    const linked: UnmatchedCapture[] = [];
    const rows: PriceObservation[] = [];
    for (const h of held) {
      const card_id = resolve(h.ea_item_id, h.asset_id, h.rating);
      if (!card_id) continue;
      linked.push(h);
      rows.push({ ...h.observation, card_id, quality: [...(h.observation.quality ?? []), `Captured before this card was in your database; linked by EA item id on ${now().slice(0, 10)}.`] });
    }
    if (rows.length) {
      await deps.prices.insert(owner, rows);
      await deps.holds!.release(owner, linked);
    }
    return { linked: rows.length, still_held: held.length - rows.length, rows };
  }

  /** Scores every card with prices once per snapshot; filters and pages then reuse it. */
  function scan(snap: Snapshot) {
    const rank: Record<SignalStatus, number> = { favorable_setup: 0, research_further: 1, overheated: 2, elevated_risk: 3, watch: 4, insufficient_evidence: 5 };
    const items = snap.cards
      .filter((c) => snap.series.has(c.id))
      .map((c) => {
        const a = analyse(snap, c);
        return {
          card_id: c.id,
          name: c.name,
          rating: c.rating,
          category: c.category,
          platform: snap.platform,
          latest_price: a.latest,
          latest_observed_at: a.fresh.latest_observed_at,
          freshness: a.fresh.status,
          status: a.assessment.status,
          categories: a.assessment.categories,
          reasons: a.assessment.reasons,
          could_be_wrong: a.assessment.could_be_wrong,
          change_24h: a.mom.changes["24h"],
          change_72h: a.mom.changes["72h"],
          vs_market_24h_pp: a.rs.find((r) => r.benchmark === "market")?.cells.find((x) => x.window === "24h")?.diff_pp ?? null,
        };
      })
      .sort((x, y) => rank[x.status] - rank[y.status] || (y.vs_market_24h_pp ?? -999) - (x.vs_market_24h_pp ?? -999));
    return items;
  }

  return {
    rules,
    /** Data sources panel: every provider, enabled or not, with its terms. */
    getDataSourceStatus() {
      return sources.map((s) => ({ ...s }));
    },

    /** get_market_overview */
    async getMarketOverview(owner: string, opts: { platform?: Platform; as_of?: string } = {}) {
      const snap = await snapshot(owner, opts.platform ?? "console", opts.as_of);
      const rows = snap.cards.flatMap((c) => {
        const s = snap.series.get(c.id);
        if (!s) return [];
        const f = freshness(s, snap.as_of, rules);
        if (f.status !== "fresh") return [{ c, f, rel: null as number | null, c24: null as number | null }];
        const c24 = change(s, "24h");
        const m = snap.indexes.find((i) => i.basket_id === "market")?.changes["24h"] ?? null;
        return [{ c, f, c24, rel: c24 === null || m === null ? null : c24 - m }];
      });
      const ranked = rows.filter((r) => r.rel !== null).sort((a, b) => b.rel! - a.rel!);
      const mover = (r: (typeof rows)[number]) => ({ card_id: r.c.id, name: r.c.name, rating: r.c.rating, change_24h: round(r.c24!), vs_market_pp: round(r.rel!), latest_observed_at: r.f.latest_observed_at });
      const backfilled = snap.members.some((m) => m.backfilled);
      return {
        platform: snap.platform,
        indexes: snap.indexes,
        index_history: Object.fromEntries([...snap.indexSeries.entries()].map(([k, v]) => [k, v.filter((_, i) => i % 6 === 0 || i === v.length - 1).map((p) => ({ t: iso(p.t), value: p.price }))])),
        regime: snap.regime,
        relative_strength_leaders: ranked.filter((r) => r.rel! >= rules.thresholds.relative_strength_pp).slice(0, 8).map(mover),
        largest_declines: ranked.filter((r) => r.rel! <= -rules.thresholds.relative_strength_pp).reverse().slice(0, 8).map(mover),
        coverage: {
          cards: snap.cards.length,
          fresh: rows.filter((r) => r.f.status === "fresh").length,
          stale: rows.filter((r) => r.f.status === "stale").length,
          missing: snap.cards.length - rows.length,
        },
        upcoming_events: { items: [] as unknown[], note: "The catalyst calendar (SBCs, Evolutions, promos) arrives in Stage B. No events are shown rather than invented ones." },
        notes: [
          "Indexes are chained equal-weight geometric means of hourly price relatives; a card only counts while it is a member and has a fresh price at both ends of the hour.",
          ...(backfilled ? ["Basket membership was backfilled from today's card list when history was first imported, so early index history may carry survivorship bias."] : []),
          "Volume, listings and supply are not available from any authorised source yet.",
        ],
        provenance: provenance(snap),
      };
    },

    /** get_card_market_intelligence: the Card Intelligence page. */
    async getCardMarketIntelligence(owner: string, card_id: string, opts: { platform?: Platform; as_of?: string } = {}) {
      const snap = await snapshot(owner, opts.platform ?? "console", opts.as_of);
      const card = getCard(snap, card_id);
      const a = analyse(snap, card);
      const comps = comparableCards(card, snap.cards).map((o) => {
        const s = snap.series.get(o.id) ?? [];
        const f = freshness(s, snap.as_of, rules);
        const u = cardUtility(o);
        return {
          card_id: o.id,
          name: o.name,
          rating: o.rating,
          positions: o.positions,
          best_fit: u.gameplay.best,
          latest_price: f.status === "fresh" ? s.at(-1)!.price : null,
          freshness: f.status,
          change_24h: f.status === "fresh" ? round(change(s, "24h") ?? NaN) : null,
          price_vs_subject: f.status === "fresh" && a.latest ? round(s.at(-1)!.price / a.latest) : null,
        };
      });
      const watch = (await deps.watchlists.list(owner)).find((w) => w.card_id === card_id && w.platform === snap.platform) ?? null;
      const cardRows = snap.rows.filter((r) => r.card_id === card_id);
      return {
        card,
        platform: snap.platform,
        utility: cardUtility(card),
        price: {
          latest: a.latest,
          freshness: a.fresh,
          /** Hourly last-price series, 7 days, for the chart. */
          history: window(a.series, 168).map((p) => ({ t: iso(p.t), price: p.price })),
          sources: [...new Set(cardRows.map((r) => r.source_id))],
        },
        relative_strength: a.rs,
        momentum: a.mom,
        mean_reversion: a.mr,
        assessment: a.assessment,
        regime: { primary: snap.regime.primary, flags: snap.regime.flags },
        comparables: comps,
        watch,
        catalysts: { items: [] as unknown[], note: "Event mapping arrives in Stage B." },
        community: { note: "Community ratings and social signals arrive in Stage C. Nothing is shown rather than guessed." },
        provenance: provenance({ as_of: snap.as_of, rows: cardRows }),
      };
    },

    /** find_market_opportunities: the scanner across every card with prices. */
    async findMarketOpportunities(owner: string, opts: { platform?: Platform; as_of?: string; status?: SignalStatus[]; max_price?: number; category?: MarketCard["category"]; limit?: number; offset?: number } = {}) {
      const snap = await snapshot(owner, opts.platform ?? "console", opts.as_of);
      // A cached snapshot keeps its scan too, so paging and filtering the radar doesn't rescore every card
      const all = (scanned.get(snap) as ReturnType<typeof scan> | undefined) ?? scan(snap);
      scanned.set(snap, all);
      const items = all.filter((i) => (!opts.status || opts.status.includes(i.status)) && (!opts.category || i.category === opts.category) && (opts.max_price === undefined || (i.latest_price !== null && i.latest_price <= opts.max_price)));
      const offset = opts.offset ?? 0;
      return {
        regime: snap.regime.primary,
        items: items.slice(offset, offset + (opts.limit ?? 50)),
        total: items.length,
        offset,
        // Every category in the scan, so the filter can list them without a second unfiltered request
        categories: [...new Set(all.flatMap((i) => [i.category, ...i.categories]).filter(Boolean))].sort(),
        provenance: provenance(snap),
      };
    },

    /** compare_card_relative_value: fit and price against named cards (or its comparables). */
    async compareCardRelativeValue(owner: string, card_id: string, opts: { platform?: Platform; as_of?: string; others?: string[] } = {}) {
      const snap = await snapshot(owner, opts.platform ?? "console", opts.as_of);
      const card = getCard(snap, card_id);
      const others = opts.others?.length ? opts.others.map((id) => getCard(snap, id)) : comparableCards(card, snap.cards);
      const row = (c: MarketCard) => {
        const s = snap.series.get(c.id) ?? [];
        const f = freshness(s, snap.as_of, rules);
        const u = cardUtility(c);
        const price = f.status === "fresh" ? s.at(-1)!.price : null;
        const fit = u.gameplay.best?.score ?? null;
        return { card_id: c.id, name: c.name, rating: c.rating, best_fit: u.gameplay.best, versatility: u.gameplay.versatility, latest_price: price, freshness: f.status, coins_per_fit_point: price !== null && fit ? Math.round(price / fit) : null };
      };
      return { subject: row(card), others: others.map(row), note: "Fit is a face-stat estimate. Coins per fit point compares price to that estimate only; PlayStyles, roles and chemistry aren't in it yet.", provenance: provenance(snap) };
    },

    /** analyze_trade_thesis */
    async analyzeTradeThesis(owner: string, input: ThesisInput, opts: { as_of?: string } = {}) {
      const snap = await snapshot(owner, input.platform, opts.as_of);
      getCard(snap, input.card_id);
      const s = snap.series.get(input.card_id) ?? [];
      const f = freshness(s, snap.as_of, rules);
      return { ...analyzeTrade(input, { latest_price: f.status === "fresh" ? s.at(-1)!.price : null, freshness: f }, rules), provenance: provenance({ as_of: snap.as_of, rows: snap.rows.filter((r) => r.card_id === input.card_id) }) };
    },

    /** Compare in My Squad: respects locks, ownership and the chemistry engine. */
    async compareInMySquad(owner: string, card_id: string, squadInput: unknown, opts: { platform?: Platform; as_of?: string } = {}) {
      const squad = squadSchema.parse(squadInput) as Squad;
      if (squad.owner_id !== owner) throw new Error("Squad owner does not match the signed-in user");
      const snap = await snapshot(owner, opts.platform ?? "console", opts.as_of);
      const card = getCard(snap, card_id);
      const a = analyse(snap, card);
      return compareInSquad(squad, card, chem, { latest_price: a.latest, assessment: a.assessment });
    },

    /** Watchlist with change since added. */
    async getWatchlist(owner: string, opts: { platform?: Platform; as_of?: string } = {}) {
      const items = await deps.watchlists.list(owner);
      const out = [];
      for (const platform of ["console", "pc"] as const) {
        const mine = items.filter((i) => i.platform === platform && (!opts.platform || opts.platform === platform));
        if (!mine.length) continue;
        const snap = await snapshot(owner, platform, opts.as_of);
        for (const w of mine) {
          const card = snap.byId.get(w.card_id);
          const a = card ? analyse(snap, card) : null;
          out.push({
            ...w,
            name: card?.name ?? "(card removed)",
            latest_price: a?.latest ?? null,
            freshness: a?.fresh.status ?? "missing",
            status: a?.assessment.status ?? "insufficient_evidence",
            since_added_pct: a?.latest && w.price_at_add ? round(((a.latest - w.price_at_add) / w.price_at_add) * 100) : null,
            at_target_buy: !!(a?.latest && w.target_buy && a.latest <= w.target_buy),
            at_target_sell: !!(a?.latest && w.target_sell && a.latest >= w.target_sell),
          });
        }
      }
      return { items: out, note: "Targets are reminders for you. XI Lab never bids, buys or lists." };
    },

    async addToWatchlist(owner: string, item: { card_id: string; platform: Platform; note?: string | null; target_buy?: number | null; target_sell?: number | null }, opts: { as_of?: string } = {}) {
      const snap = await snapshot(owner, item.platform, opts.as_of);
      getCard(snap, item.card_id);
      const s = snap.series.get(item.card_id) ?? [];
      const f = freshness(s, snap.as_of, rules);
      const w: WatchItem = {
        card_id: item.card_id,
        platform: item.platform,
        added_at: snap.as_of,
        note: item.note ?? null,
        target_buy: item.target_buy ?? null,
        target_sell: item.target_sell ?? null,
        price_at_add: f.status === "fresh" ? s.at(-1)!.price : null,
        price_at_add_observed_at: f.status === "fresh" ? f.latest_observed_at : null,
      };
      return deps.watchlists.upsert(owner, w);
    },

    async removeFromWatchlist(owner: string, card_id: string, platform: Platform) {
      await deps.watchlists.remove(owner, card_id, platform);
    },

    /** Import a CSV/JSON price history the user owns. Rows stay private to them. */
    async importPriceHistory(owner: string, text: string, opts: { source_id?: string; received_at?: string } = {}) {
      // A Web App capture file (from the XI Lab browser helper) is recognised by its header.
      const captured = /^\s*ea_item_id,/.test(text);
      const source = sourceById.get(opts.source_id ?? (captured ? "web_app_capture" : "user_import"));
      assertUsable(source, "storage");
      const cards = await deps.cards.list(owner);
      const resolveEaItem = eaResolver(cards);
      const res = parsePriceImport(text, { source, received_at: opts.received_at ?? now(), knownCardIds: new Set(cards.map((c) => c.id)), rules, resolveEaItem });
      const rejected = [...res.rejected];
      let held = 0;
      if (res.unmatched.length && deps.holds) held = (await deps.holds.hold(owner, res.unmatched)).held;
      else for (const u of res.unmatched) rejected.push({ line: 0, reason: unmatchedReason(u), raw: { ea_item_id: u.ea_item_id, rating: u.rating } });
      const stored = await deps.prices.insert(source.is_demo ? null : owner, res.rows);
      // Anything held earlier whose card has been added since gets linked now too.
      const relinked = deps.holds ? await relink(owner, cards) : { linked: 0, still_held: 0, rows: [] as PriceObservation[] };
      if (res.rows.length || relinked.linked) {
        const all = [...res.rows, ...relinked.rows];
        const earliest = all.reduce((m, r) => (r.observed_at < m ? r.observed_at : m), all[0]!.observed_at);
        await initBaskets(earliest, { backfilled: true });
      }
      return { ...res, rows: undefined, unmatched: undefined, rejected, accepted: res.rows.length, held, linked_from_held: relinked.linked, still_held: relinked.still_held, ...stored };
    },

    /** Link held captures to cards added since (run after adding cards). */
    async relinkHeldCaptures(owner: string) {
      if (!deps.holds) return { linked: 0, still_held: 0 };
      const { linked, still_held } = await relink(owner, await deps.cards.list(owner));
      return { linked, still_held };
    },

    /** Link every held capture of one EA item to a card you chose (for cards that don't carry EA's item id). */
    async linkHeldCapture(owner: string, ea_item_id: number, card_id: string) {
      if (!deps.holds) return { linked: 0 };
      const card = (await deps.cards.list(owner)).find((c) => c.id === card_id);
      if (!card) throw new MarketNotFoundError(`Card ${card_id} isn't one of yours`);
      const held = (await deps.holds.list(owner)).filter((h) => h.ea_item_id === ea_item_id);
      if (held.some((h) => h.rating !== null && h.rating !== card.rating)) throw new Error(`EA item ${ea_item_id} is rated ${held.find((h) => h.rating !== null)!.rating}; ${card.name} is ${card.rating}. Pick the matching card.`);
      const rows = held.map((h) => ({ ...h.observation, card_id, quality: [...(h.observation.quality ?? []), `Linked by you to ${card.name} on ${now().slice(0, 10)}.`] }));
      if (rows.length) {
        await deps.prices.insert(owner, rows);
        await deps.holds.release(owner, held);
        const earliest = rows.reduce((m, r) => (r.observed_at < m ? r.observed_at : m), rows[0]!.observed_at);
        await initBaskets(earliest, { backfilled: true });
      }
      return { linked: rows.length };
    },

    /** Captured EA items that aren't in your card database yet, one entry per item, so you can add the cards. */
    async getHeldCaptures(owner: string) {
      const held = deps.holds ? await deps.holds.list(owner) : [];
      const by = new Map<number, UnmatchedCapture[]>();
      for (const h of held) by.set(h.ea_item_id, [...(by.get(h.ea_item_id) ?? []), h]);
      const items = [...by.values()].map((hs) => {
        const latest = hs.reduce((a, b) => (b.observation.observed_at > a.observation.observed_at ? b : a));
        return {
          ea_item_id: latest.ea_item_id,
          asset_id: latest.asset_id,
          rating: latest.rating,
          details: latest.details ?? null,
          special_version: latest.details?.rare_flag !== undefined ? latest.details.rare_flag > 1 : null,
          observations: hs.length,
          platforms: [...new Set(hs.map((h) => h.observation.platform))],
          latest_price: latest.observation.price,
          latest_platform: latest.observation.platform,
          latest_observed_at: latest.observation.observed_at,
          reason: unmatchedReason(latest),
        };
      });
      items.sort((a, b) => b.latest_observed_at.localeCompare(a.latest_observed_at));
      return { items, total_observations: held.length, evidence: "game_data" as const, note: "Prices you captured for items XI Lab can't match to a card yet. They're kept privately and linked automatically once the card is added." };
    },

    /** Re-apply basket rules at `at` (a scheduled job in production). Closes and opens memberships; never rewrites history. */
    async rebalanceBaskets(at = now()) {
      await initBaskets(at);
    },
  };
}

export type MarketService = ReturnType<typeof createMarketService>;
