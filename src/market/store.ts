// Storage interfaces for Market Lab. Async and owner-scoped so Gaffer Bot's Postgres `fut` adapter drops in.
// Prices from licensed/public sources are shared; user imports are private to their owner.
import type { BasketMembership } from "./baskets.js";
import type { MarketCard, Platform, PriceObservation } from "./types.js";
import type { UnmatchedCapture } from "./import.js";

export interface PriceQuery {
  card_ids?: string[];
  platform?: Platform;
  /** Only observations observed at or after this. */
  since?: string;
  /** Point-in-time cut-off on received_at (and observed_at). */
  as_of: string;
}

export interface PriceStore {
  /** Rows the owner may see: shared sources plus the owner's own imports. */
  query(owner_id: string, q: PriceQuery): Promise<PriceObservation[]>;
  /** owner_id null = shared (only for licensed/demo sources). Duplicates (same card, platform, observed_at, source, owner) are skipped. */
  insert(owner_id: string | null, rows: PriceObservation[]): Promise<{ inserted: number; skipped: number }>;
}

/** Captured prices for EA items not in the card database yet, private to the owner, linked once the card exists. */
export interface CaptureHoldStore {
  hold(owner_id: string, rows: UnmatchedCapture[]): Promise<{ held: number; skipped: number }>;
  list(owner_id: string): Promise<UnmatchedCapture[]>;
  /** Drop held rows (after they were linked to a card). */
  release(owner_id: string, rows: UnmatchedCapture[]): Promise<void>;
}

export interface MembershipStore {
  list(basket_id?: string): Promise<BasketMembership[]>;
  /** Replace a basket's membership history (closed rows stay closed; see rebalance()). */
  replace(basket_id: string, rows: BasketMembership[]): Promise<void>;
}

export interface WatchItem {
  card_id: string;
  platform: Platform;
  added_at: string;
  note?: string | null;
  /** Prices the user wants to act at. Advice only: XI Lab never places bids. */
  target_buy?: number | null;
  target_sell?: number | null;
  /** Latest fresh price when added, so "since added" is honest. null if none was fresh. */
  price_at_add: number | null;
  price_at_add_observed_at: string | null;
}

export interface WatchlistStore {
  list(owner_id: string): Promise<WatchItem[]>;
  upsert(owner_id: string, item: WatchItem): Promise<WatchItem>;
  remove(owner_id: string, card_id: string, platform: Platform): Promise<void>;
}

export interface MarketCardSource {
  /** Cards the owner can see (catalogue plus their own), with market metadata. */
  list(owner_id: string): Promise<MarketCard[]>;
  /** Shared catalogue cards only (no user-entered cards): what market baskets are built from. */
  catalogue(): Promise<MarketCard[]>;
}

// ---------------------------------------------------------------- in-memory implementations (browser, tests)

type Owned = PriceObservation & { _owner: string | null };

export class MemoryPriceStore implements PriceStore {
  protected rows: Owned[] = [];
  protected keys = new Set<string>();
  constructor(initial: { owner_id: string | null; rows: PriceObservation[] }[] = []) {
    for (const i of initial) this.add(i.owner_id, i.rows);
  }
  protected add(owner: string | null, rows: PriceObservation[]) {
    let inserted = 0;
    for (const r of rows) {
      const k = `${owner ?? ""}|${r.source_id}|${r.card_id}|${r.platform}|${r.observed_at}`;
      if (this.keys.has(k)) continue;
      this.keys.add(k);
      this.rows.push({ ...r, _owner: owner });
      inserted++;
    }
    return { inserted, skipped: rows.length - inserted };
  }
  async query(owner_id: string, q: PriceQuery) {
    const ids = q.card_ids ? new Set(q.card_ids) : null;
    const asOf = Date.parse(q.as_of);
    const since = q.since ? Date.parse(q.since) : -Infinity;
    return this.rows
      .filter(
        (r) =>
          (r._owner === null || r._owner === owner_id) &&
          (!ids || ids.has(r.card_id)) &&
          (!q.platform || r.platform === q.platform) &&
          Date.parse(r.received_at) <= asOf &&
          Date.parse(r.observed_at) <= asOf &&
          Date.parse(r.observed_at) >= since,
      )
      .map(({ _owner, ...r }) => r);
  }
  async insert(owner_id: string | null, rows: PriceObservation[]) {
    return this.add(owner_id, rows);
  }
  /** Everything, for persistence by subclasses. */
  dump() {
    return this.rows;
  }
}

export class MemoryMembershipStore implements MembershipStore {
  protected rows = new Map<string, BasketMembership[]>();
  constructor(initial: BasketMembership[] = []) {
    for (const m of initial) this.rows.set(m.basket_id, [...(this.rows.get(m.basket_id) ?? []), m]);
  }
  async list(basket_id?: string) {
    return basket_id ? [...(this.rows.get(basket_id) ?? [])] : [...this.rows.values()].flat();
  }
  async replace(basket_id: string, rows: BasketMembership[]) {
    this.rows.set(basket_id, rows.map((r) => ({ ...r })));
  }
}

export class MemoryWatchlistStore implements WatchlistStore {
  protected rows = new Map<string, WatchItem[]>();
  constructor(initial: Record<string, WatchItem[]> = {}) {
    for (const [k, v] of Object.entries(initial)) this.rows.set(k, v.map((x) => ({ ...x })));
  }
  async list(owner_id: string) {
    return (this.rows.get(owner_id) ?? []).map((x) => ({ ...x }));
  }
  async upsert(owner_id: string, item: WatchItem) {
    const list = (this.rows.get(owner_id) ?? []).filter((x) => !(x.card_id === item.card_id && x.platform === item.platform));
    list.push({ ...item });
    this.rows.set(owner_id, list);
    return { ...item };
  }
  async remove(owner_id: string, card_id: string, platform: Platform) {
    this.rows.set(owner_id, (this.rows.get(owner_id) ?? []).filter((x) => !(x.card_id === card_id && x.platform === platform)));
  }
}

export class MemoryMarketCardSource implements MarketCardSource {
  constructor(private cards: MarketCard[]) {}
  async list() {
    return this.cards;
  }
  async catalogue() {
    return this.cards.filter((c) => c.source !== "user");
  }
}

const holdKey = (h: UnmatchedCapture) => `${h.ea_item_id}|${h.observation.platform}|${h.observation.observed_at}`;

export class MemoryCaptureHoldStore implements CaptureHoldStore {
  protected rows = new Map<string, Map<string, UnmatchedCapture>>();
  async hold(owner_id: string, rows: UnmatchedCapture[]) {
    const m = this.rows.get(owner_id) ?? new Map<string, UnmatchedCapture>();
    let held = 0;
    for (const r of rows) if (!m.has(holdKey(r))) m.set(holdKey(r), structuredClone(r)), held++;
    this.rows.set(owner_id, m);
    return { held, skipped: rows.length - held };
  }
  async list(owner_id: string) {
    return [...(this.rows.get(owner_id)?.values() ?? [])].map((r) => structuredClone(r));
  }
  async release(owner_id: string, rows: UnmatchedCapture[]) {
    const m = this.rows.get(owner_id);
    for (const r of rows) m?.delete(holdKey(r));
  }
}
