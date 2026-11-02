// Browser-only adapters: persist to localStorage. Storage can be unavailable (private mode), so every
// access is guarded and the app still works in memory.
import { MemorySquadStore, type Manager, type Squad, type WorkspaceCard } from "../src/workspace/index.js";

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

export class LocalSquadStore extends MemorySquadStore {
  constructor(private key = "xilab.squads.v1") {
    super(read<Squad[]>(key, []));
  }
  private persist() {
    write(this.key, [...this.rows.values()]);
  }
  override async save(squad: Squad) {
    const r = await super.save(squad);
    this.persist();
    return r;
  }
  override async delete(owner: string, id: string) {
    await super.delete(owner, id);
    this.persist();
  }
}

export const userCards = {
  load: () => read<WorkspaceCard[]>("xilab.cards.v1", []),
  save: (c: WorkspaceCard[]) => write("xilab.cards.v1", c),
};
export const userManagers = {
  load: () => read<Manager[]>("xilab.managers.v1", []),
  save: (m: Manager[]) => write("xilab.managers.v1", m),
};
export const prefs = {
  load: () => read<{ lastSquad?: string; profiles?: Record<string, string> }>("xilab.prefs.v1", {}),
  save: (p: { lastSquad?: string; profiles?: Record<string, string> }) => write("xilab.prefs.v1", p),
};
