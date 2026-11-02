// The Market Lab service surface. The web Market Lab, Gaffer Bot's fut-api routes and the FUT MCP tools all call
// these, the same way the squad workspace works. Every result carries provenance (rules, sources, demo flag, as_of).
import { cardUtility, comparableCards } from "../intelligence/card.js";
import type { ChemistryRules } from "../chemistry/index.js";
import { DEFAULT_RULES, squadSchema, type Squad } from "../workspace/index.js";
import { DEFAULT_BASKETS, computeIndex, rebalance, summarizeIndex, type BasketDefinition, type BasketMembership, type IndexSummary } from "./baskets.js";
import { parsePriceImport } from "./import.js";
import { classifyRegime, type RegimeResult } from "./regime.js";
import { DEFAULT_MARKET_RULES, MARKET_ENGINE_VERSION, type MarketRules } from "./rules.js";
import { change, freshness, iso, ms, round, toSeries, window, type Point } from "./series.js";
import { assessSignals, isPeer, meanReversion, momentum, peerChanges, relativeStrength, type Benchmark, type SignalAssessment, type SignalStatus } from "./signals.js";
import { DEFAULT_PRICE_SOURCES, assertUsable } from "./sources.js";
import { compareInSquad } from "./squad-link.js";
import type { MarketCardSource, MembershipStore, PriceStore, WatchItem, WatchlistStore } from "./store.js";
import { analyzeTrade, type ThesisInput } from "./thesis.js";
import { WINDOWS, type MarketCard, type MarketProvenance, type Platform, type PriceObservation, type PriceSource, type Window } from "./types.js";

export interface MarketDeps {
  prices: PriceStore;
  memberships: MembershipStore;
  watchlists: WatchlistStore;
  cards: MarketCardSource;
  sources?: PriceSource[];
  baskets?: BasketDefinition[];
  rules?: MarketRules;
  chemistry?: ChemistryRules;
  /** Injectable clock for tests and backtests. */
  now?: () => string;
}

export class MarketNotFoundError extends Error {}

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

  async function snapshot(owner: string, platform: Platform, as_of = now()): Promise<Snapshot> {
    const cards = await deps.cards.list(owner);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const rows = usable(await deps.prices.query(owner, { platform, as_of, since: iso(ms(as_of) - LOOKBACK_H * 3_600_000) }));
    const series = new Map<string, Point[]>();
    for (const id of new Set(rows.map((r) => r.card_id))) series.set(id, toSeries(rows, id, platform, as_of));
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

  function benchmarksFor(snap: Snapshot, card: MarketCard) {
    const out: { benchmark: Benchmark; changes: Record<Window, number | null>; peers: number }[] = [];
    for (const b of ["category", "rating", "position", "utility"] as const) {
      const peers = snap.cards.filter((o) => isPeer(b, card, o)).flatMap((o) => {
        const s = snap.series.get(o.id);
        return s && freshness(s, snap.as_of, rules).status === "fresh" ? [s] : [];
      });
      const pc = peerChanges(peers);
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
    const peerPrices = snap.cards
      .filter((o) => o.id !== card.id && o.rating === card.rating && o.positions[0] === card.positions[0])
      .flatMap((o) => {
        const ps = snap.series.get(o.id);
        return ps && freshness(ps, snap.as_of, rules).status === "fresh" ? [ps.at(-1)!.price] : [];
      });
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
    async findMarketOpportunities(owner: string, opts: { platform?: Platform; as_of?: string; status?: SignalStatus[]; max_price?: number; category?: MarketCard["category"]; limit?: number } = {}) {
      const snap = await snapshot(owner, opts.platform ?? "console", opts.as_of);
      const rank: Record<SignalStatus, number> = { favorable_setup: 0, research_further: 1, overheated: 2, elevated_risk: 3, watch: 4, insufficient_evidence: 5 };
      const items = snap.cards
        .filter((c) => snap.series.has(c.id) && (!opts.category || c.category === opts.category))
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
        .filter((i) => (!opts.status || opts.status.includes(i.status)) && (opts.max_price === undefined || (i.latest_price !== null && i.latest_price <= opts.max_price)))
        .sort((x, y) => rank[x.status] - rank[y.status] || (y.vs_market_24h_pp ?? -999) - (x.vs_market_24h_pp ?? -999));
      return { regime: snap.regime.primary, items: items.slice(0, opts.limit ?? 50), total: items.length, provenance: provenance(snap) };
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
      const source = sourceById.get(opts.source_id ?? "user_import");
      assertUsable(source, "storage");
      const cards = await deps.cards.list(owner);
      const res = parsePriceImport(text, { source, received_at: opts.received_at ?? now(), knownCardIds: new Set(cards.map((c) => c.id)), rules });
      const stored = await deps.prices.insert(source.is_demo ? null : owner, res.rows);
      if (res.rows.length) {
        const earliest = res.rows.reduce((m, r) => (r.observed_at < m ? r.observed_at : m), res.rows[0]!.observed_at);
        await initBaskets(earliest, { backfilled: true });
      }
      return { ...res, rows: undefined, accepted: res.rows.length, ...stored };
    },

    /** Re-apply basket rules at `at` (a scheduled job in production). Closes and opens memberships; never rewrites history. */
    async rebalanceBaskets(at = now()) {
      await initBaskets(at);
    },
  };
}

export type MarketService = ReturnType<typeof createMarketService>;
