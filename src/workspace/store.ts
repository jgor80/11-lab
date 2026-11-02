// Thin storage adapters. Async and keyed by owner id so a Postgres (GafferBot `fut` schema) adapter drops in.
import { newId } from "./squad.js";
import type { Manager, Squad, WorkspaceCard } from "./types.js";

export interface SquadStore {
  list(owner_id: string): Promise<Squad[]>;
  get(owner_id: string, id: string): Promise<Squad | null>;
  /** Insert or update by id. */
  save(squad: Squad): Promise<Squad>;
  delete(owner_id: string, id: string): Promise<void>;
}

export interface CardQuery {
  text?: string;
  position?: string;
  league?: string;
  nation?: string;
  club?: string;
  max_price?: number;
  owned_only?: boolean;
  limit?: number;
}

export interface CardSource {
  search(owner_id: string, q: CardQuery): Promise<WorkspaceCard[]>;
  managers(owner_id: string): Promise<Manager[]>;
}

/** Save a copy as a new squad. The original is never overwritten. */
export async function saveSquadAs(store: SquadStore, squad: Squad, name: string): Promise<Squad> {
  const t = new Date().toISOString();
  return store.save({ ...structuredClone(squad), id: newId(), name, parent_id: squad.id, created_at: t, updated_at: t });
}

export class MemorySquadStore implements SquadStore {
  protected rows = new Map<string, Squad>();
  constructor(initial: Squad[] = []) {
    for (const s of initial) this.rows.set(s.id, structuredClone(s));
  }
  async list(owner_id: string) {
    return [...this.rows.values()].filter((s) => s.owner_id === owner_id).map((s) => structuredClone(s)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async get(owner_id: string, id: string) {
    const s = this.rows.get(id);
    return s && s.owner_id === owner_id ? structuredClone(s) : null;
  }
  async save(squad: Squad) {
    const prev = this.rows.get(squad.id);
    if (prev && prev.owner_id !== squad.owner_id) throw new Error("Squad belongs to another owner");
    this.rows.set(squad.id, structuredClone(squad));
    return structuredClone(squad);
  }
  async delete(owner_id: string, id: string) {
    if (this.rows.get(id)?.owner_id === owner_id) this.rows.delete(id);
  }
}

const norm = (s: string | null | undefined) => s?.trim().toLowerCase() ?? "";

/** Filters an in-memory card list. Owner-scoped "owned" flags live on the cards themselves for now. */
export class MemoryCardSource implements CardSource {
  constructor(private cards: WorkspaceCard[], private mgrs: Manager[] = []) {}
  async search(_owner: string, q: CardQuery) {
    return filterCards(this.cards, q);
  }
  async managers() {
    return this.mgrs;
  }
}

export function filterCards(cards: WorkspaceCard[], q: CardQuery): WorkspaceCard[] {
  const text = norm(q.text);
  return cards
    .filter(
      (c) =>
        (!text || [c.name, c.club, c.league, c.nation].some((v) => norm(v).includes(text))) &&
        (!q.position || c.positions.some((p) => p.toUpperCase() === q.position!.toUpperCase())) &&
        (!q.league || norm(c.league) === norm(q.league)) &&
        (!q.nation || norm(c.nation) === norm(q.nation)) &&
        (!q.club || norm(c.club) === norm(q.club)) &&
        (!q.owned_only || c.owned) &&
        (q.max_price === undefined || c.owned || (typeof c.price === "number" && c.price <= q.max_price)),
    )
    .slice(0, q.limit ?? 200);
}
