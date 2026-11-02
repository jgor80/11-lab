// SQLite (node:sqlite) adapters for Market Lab over migrations/0004_market_lab.sql. Card ids are player_cards.id
// as strings, so the same canonical id is used by the squad builder, the importer and Market Lab.
// Gaffer Bot implements the same interfaces over its Postgres `fut` schema.
import type { Db } from "./sqlite.js";
import type { BasketDefinition, BasketMembership } from "../market/baskets.js";
import type { MarketRules } from "../market/rules.js";
import type { MarketCardSource, MembershipStore, PriceQuery, PriceStore, WatchItem, WatchlistStore } from "../market/store.js";
import type { CardCategory, MarketCard, Platform, PriceObservation, PriceSource } from "../market/types.js";

export class SqlitePriceStore implements PriceStore {
  constructor(private db: Db) {}
  async query(owner_id: string, q: PriceQuery): Promise<PriceObservation[]> {
    const where = ["(owner_id = '' OR owner_id = ?)", "received_at <= ?", "observed_at <= ?"];
    const args: (string | number)[] = [owner_id, q.as_of, q.as_of];
    if (q.platform) where.push("platform = ?"), args.push(q.platform);
    if (q.since) where.push("observed_at >= ?"), args.push(q.since);
    if (q.card_ids?.length) where.push(`card_id IN (${q.card_ids.map(() => "?").join(",")})`), args.push(...q.card_ids.map(Number));
    const rows = this.db.prepare(`SELECT * FROM market_price_observations WHERE ${where.join(" AND ")} ORDER BY observed_at`).all(...args) as Record<string, unknown>[];
    return rows.map((r) => ({
      card_id: String(r.card_id),
      platform: r.platform as Platform,
      price: Number(r.price),
      kind: r.kind as PriceObservation["kind"],
      observed_at: String(r.observed_at),
      received_at: String(r.received_at),
      event_at: (r.event_at as string | null) ?? null,
      season: String(r.season),
      source_id: String(r.source_id),
      evidence: r.evidence as PriceObservation["evidence"],
      ...(r.quality ? { quality: JSON.parse(String(r.quality)) } : {}),
    }));
  }
  async insert(owner_id: string | null, rows: PriceObservation[]) {
    const st = this.db.prepare(
      `INSERT OR IGNORE INTO market_price_observations (card_id, platform, price, kind, observed_at, received_at, event_at, season, source_id, owner_id, evidence, quality)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let inserted = 0;
    this.db.exec("BEGIN");
    try {
      for (const r of rows)
        inserted += Number(
          st.run(Number(r.card_id), r.platform, r.price, r.kind ?? "lowest_bin", r.observed_at, r.received_at, r.event_at ?? null, r.season, r.source_id, owner_id ?? "", r.evidence, r.quality ? JSON.stringify(r.quality) : null).changes,
        );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { inserted, skipped: rows.length - inserted };
  }
}

export class SqliteMembershipStore implements MembershipStore {
  constructor(private db: Db, baskets: BasketDefinition[]) {
    const st = db.prepare("INSERT OR REPLACE INTO market_baskets (id, label, grp, description, rule) VALUES (?, ?, ?, ?, ?)");
    for (const b of baskets) st.run(b.id, b.label, b.group, b.description, JSON.stringify(b.rule));
  }
  async list(basket_id?: string): Promise<BasketMembership[]> {
    const rows = (basket_id ? this.db.prepare("SELECT * FROM market_basket_members WHERE basket_id = ?").all(basket_id) : this.db.prepare("SELECT * FROM market_basket_members").all()) as Record<string, unknown>[];
    return rows.map((r) => ({ basket_id: String(r.basket_id), card_id: String(r.card_id), effective_from: String(r.effective_from), effective_to: (r.effective_to as string | null) ?? null, ...(r.backfilled ? { backfilled: true } : {}) }));
  }
  async replace(basket_id: string, rows: BasketMembership[]) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM market_basket_members WHERE basket_id = ?").run(basket_id);
      const st = this.db.prepare("INSERT INTO market_basket_members (basket_id, card_id, effective_from, effective_to, backfilled) VALUES (?, ?, ?, ?, ?)");
      for (const m of rows) st.run(basket_id, Number(m.card_id), m.effective_from, m.effective_to, m.backfilled ? 1 : 0);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

export class SqliteWatchlistStore implements WatchlistStore {
  constructor(private db: Db) {}
  async list(owner_id: string): Promise<WatchItem[]> {
    return (this.db.prepare("SELECT * FROM market_watchlist WHERE owner_id = ? ORDER BY added_at").all(owner_id) as Record<string, unknown>[]).map((r) => ({
      card_id: String(r.card_id),
      platform: r.platform as Platform,
      added_at: String(r.added_at),
      note: (r.note as string | null) ?? null,
      target_buy: (r.target_buy as number | null) ?? null,
      target_sell: (r.target_sell as number | null) ?? null,
      price_at_add: (r.price_at_add as number | null) ?? null,
      price_at_add_observed_at: (r.price_at_add_observed_at as string | null) ?? null,
    }));
  }
  async upsert(owner_id: string, w: WatchItem) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO market_watchlist (owner_id, card_id, platform, added_at, note, target_buy, target_sell, price_at_add, price_at_add_observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(owner_id, Number(w.card_id), w.platform, w.added_at, w.note ?? null, w.target_buy ?? null, w.target_sell ?? null, w.price_at_add, w.price_at_add_observed_at);
    return w;
  }
  async remove(owner_id: string, card_id: string, platform: Platform) {
    this.db.prepare("DELETE FROM market_watchlist WHERE owner_id = ? AND card_id = ? AND platform = ?").run(owner_id, Number(card_id), platform);
  }
}

/** Card category from the importer's version/flags. Anything not base, Icon, Hero or Evolution counts as a promo. */
export function categoryOf(version: string, is_icon: boolean, is_hero: boolean): CardCategory {
  if (is_icon) return "icon";
  if (is_hero) return "hero";
  const v = version.toLowerCase();
  if (v === "base" || v === "") return "base";
  if (v.includes("evo")) return "evolution";
  return "promo";
}

/** The existing FUT card records (player_cards + positions + face stats) as Market Lab cards. */
export class SqliteMarketCardSource implements MarketCardSource {
  private cache: MarketCard[] | null = null;
  constructor(private db: Db, private opts: { season?: string; min_overall?: number } = {}) {}
  async list(): Promise<MarketCard[]> {
    if (this.cache) return this.cache;
    const rows = this.db
      .prepare(
        `SELECT c.id, p.common_name AS name, c.version, c.overall, c.is_icon, c.is_hero, c.availability,
                cl.name AS club, l.name AS league, n.name AS nation,
                a.pac, a.sho, a.pas, a.dri, a.def, a.phy,
                (SELECT group_concat(position_code, '|') FROM (SELECT position_code FROM card_positions cp WHERE cp.card_id = c.id ORDER BY is_primary DESC, position_code)) AS positions
         FROM player_cards c JOIN players p ON p.id = c.player_id
         LEFT JOIN clubs cl ON cl.id = c.club_id LEFT JOIN leagues l ON l.id = c.league_id LEFT JOIN nations n ON n.id = c.nation_id
         LEFT JOIN card_attributes a ON a.card_id = c.id
         WHERE c.season = ? AND c.overall >= ?`,
      )
      .all(this.opts.season ?? "FC27", this.opts.min_overall ?? 1) as Record<string, unknown>[];
    this.cache = rows.map((r) => {
      const stats = Object.fromEntries((["pac", "sho", "pas", "dri", "def", "phy"] as const).flatMap((k) => (typeof r[k] === "number" ? [[k, r[k] as number]] : [])));
      return {
        id: String(r.id),
        name: String(r.name),
        club: (r.club as string | null) ?? null,
        league: (r.league as string | null) ?? null,
        nation: (r.nation as string | null) ?? null,
        positions: r.positions ? String(r.positions).split("|") : [],
        is_icon: !!r.is_icon,
        is_hero: !!r.is_hero,
        rating: Number(r.overall),
        version: String(r.version),
        category: categoryOf(String(r.version), !!r.is_icon, !!r.is_hero),
        tradeable: !/untradeable/i.test(String(r.availability ?? "")),
        stats,
        source: "database" as const,
      };
    });
    return this.cache;
  }
  async catalogue() {
    return this.list();
  }
}

export function loadPriceSources(db: Db): PriceSource[] {
  return (db.prepare("SELECT * FROM market_price_sources ORDER BY id").all() as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as PriceSource["kind"],
    status: r.status as PriceSource["status"],
    is_demo: !!r.is_demo,
    status_note: String(r.status_note),
    permissions: JSON.parse(String(r.permissions)),
    evidence: r.evidence as PriceSource["evidence"],
  }));
}

export function loadMarketRules(db: Db): MarketRules {
  const r = db.prepare("SELECT * FROM market_rule_versions WHERE is_active = 1").get() as Record<string, unknown> | undefined;
  if (!r) throw new Error("No active market rule version");
  return { id: String(r.id), status: r.status as MarketRules["status"], notes: String(r.notes), ...JSON.parse(String(r.body)) };
}
