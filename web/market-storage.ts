// Browser adapters for Market Lab: imported prices, watchlist and basket memberships in localStorage.
// Demo prices are regenerated on every load (never stored), so they can't be mistaken for imported data.
import { MemoryCaptureHoldStore, MemoryMembershipStore, MemoryPriceStore, MemoryWatchlistStore, type BasketMembership, type MarketCard, type MarketCardSource, type PriceObservation, type UnmatchedCapture, type WatchItem } from "../src/market/index.js";
import type { Squad, WorkspaceCard } from "../src/workspace/index.js";

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: keep going in memory */
  }
};

const PRICES = "xilab.market.prices.v1";
export class LocalPriceStore extends MemoryPriceStore {
  constructor(owner: string, demo: PriceObservation[]) {
    super([
      { owner_id: null, rows: demo },
      { owner_id: owner, rows: read<PriceObservation[]>(PRICES, []) },
    ]);
  }
  override async insert(owner_id: string | null, rows: PriceObservation[]) {
    const r = await super.insert(owner_id, rows);
    write(PRICES, this.dump().filter((x) => x._owner !== null).map(({ _owner, ...x }) => x));
    return r;
  }
  clearImported() {
    write(PRICES, []);
  }
}

const HOLDS = "xilab.market.holds.v1";
/** Captured prices for EA items not in your cards yet, kept in this browser until the card is added. */
export class LocalCaptureHoldStore extends MemoryCaptureHoldStore {
  constructor(private owner: string) {
    super();
    void super.hold(owner, read<UnmatchedCapture[]>(HOLDS, []));
  }
  private async persist() {
    write(HOLDS, await super.list(this.owner));
  }
  override async hold(o: string, rows: UnmatchedCapture[]) {
    const r = await super.hold(o, rows);
    await this.persist();
    return r;
  }
  override async release(o: string, rows: UnmatchedCapture[]) {
    await super.release(o, rows);
    await this.persist();
  }
  clear() {
    write(HOLDS, []);
  }
}

const WATCH = "xilab.market.watch.v1";
export class LocalWatchlistStore extends MemoryWatchlistStore {
  constructor(private owner: string) {
    super({ [owner]: read<WatchItem[]>(WATCH, []) });
  }
  private persist() {
    write(WATCH, this.rows.get(this.owner) ?? []);
  }
  override async upsert(o: string, item: WatchItem) {
    const r = await super.upsert(o, item);
    this.persist();
    return r;
  }
  override async remove(o: string, id: string, p: WatchItem["platform"]) {
    await super.remove(o, id, p);
    this.persist();
  }
}

const MEMBERS = "xilab.market.members.v1";
/** With the demo on, memberships come from the demo; with it off, from what your imports created. */
export class LocalMembershipStore extends MemoryMembershipStore {
  constructor(private persistent: boolean, demo: BasketMembership[]) {
    super(persistent ? read<BasketMembership[]>(MEMBERS, []) : demo);
  }
  override async replace(basket_id: string, rows: BasketMembership[]) {
    await super.replace(basket_id, rows);
    if (this.persistent) write(MEMBERS, [...this.rows.values()].flat());
  }
}

/** Cards you entered in the squad builder, plus the cards in your saved squads, as market cards. */
export function userMarketCards(): MarketCard[] {
  const seen = new Map<string, MarketCard>();
  const add = (c: WorkspaceCard) => {
    if (seen.has(c.id) || c.source === "fixture") return;
    seen.set(c.id, { ...c, rating: c.rating ?? 0, category: c.is_icon ? "icon" : c.is_hero ? "hero" : "base", tradeable: true });
  };
  for (const c of read<WorkspaceCard[]>("xilab.cards.v1", [])) add(c);
  for (const s of read<Squad[]>("xilab.squads.v1", [])) for (const sl of s.slots) if (sl.card) add(sl.card);
  return [...seen.values()];
}

export const savedSquads = () => read<Squad[]>("xilab.squads.v1", []);

/** Single-user browser build: every visible card can join baskets. */
export class BrowserCardSource implements MarketCardSource {
  constructor(private cards: MarketCard[]) {}
  async list() {
    return this.cards;
  }
  async catalogue() {
    return this.cards;
  }
}

export const marketPrefs = {
  load: () => read<{ demo?: boolean; platform?: "console" | "pc" }>("xilab.market.prefs.v1", {}),
  save: (p: { demo?: boolean; platform?: "console" | "pc" }) => write("xilab.market.prefs.v1", p),
};
