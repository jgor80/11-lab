// The one service surface. The web workspace, the fut-api HTTP routes and the FUT MCP tools all call these,
// so a squad never has to be re-entered to ask a new question. Results always carry rule version + evidence.
import type { ChemistryRules } from "../chemistry/index.js";
import { compareSquads } from "./compare.js";
import { optimizeSquad, type OptimizeGoal, type OptimizeOptions } from "./optimizer.js";
import { optimizeRequestSchema, squadSchema } from "./schema.js";
import { evaluateSquad, previewAssign } from "./squad.js";
import { saveSquadAs, type CardSource, type SquadStore } from "./store.js";
import { diagnoseSlot, diagnoseSquad } from "./surgeon.js";
import type { Squad, WorkspaceCard } from "./types.js";

export interface WorkspaceDeps {
  rules: ChemistryRules;
  store: SquadStore;
  cards: CardSource;
}

export class NotFoundError extends Error {}

export function createWorkspaceService(deps: WorkspaceDeps) {
  const { rules, store, cards } = deps;
  const parse = (squad: unknown) => squadSchema.parse(squad) as Squad;
  const load = async (owner: string, id: string) => {
    const s = await store.get(owner, id);
    if (!s) throw new NotFoundError(`No squad ${id}`);
    return s;
  };
  /** Accept either a saved squad id or a squad object. */
  const resolve = async (owner: string, ref: string | unknown) => (typeof ref === "string" ? load(owner, ref) : parse(ref));

  return {
    /** calculate_fut_chemistry */
    async calculateChemistry(owner: string, squad: string | unknown) {
      return evaluateSquad(await resolve(owner, squad), rules);
    },
    /** Chemistry Surgeon for one slot, or the whole squad when slot is omitted. */
    async diagnose(owner: string, squad: string | unknown, slot?: string) {
      const s = await resolve(owner, squad);
      return slot ? diagnoseSlot(s, slot, rules) : diagnoseSquad(s, rules);
    },
    /** What happens to all 11 if this card goes in this slot. */
    async previewAssign(owner: string, squad: string | unknown, slot: string, card: WorkspaceCard | null) {
      return previewAssign(await resolve(owner, squad), slot, card, rules);
    },
    /** optimize_fut_squad: candidate pool = the owner's club cards plus priced market cards from the card source. */
    async optimize(owner: string, squad: string | unknown, request: { goal: OptimizeGoal; options?: OptimizeOptions }) {
      const req = optimizeRequestSchema.parse(request);
      const s = await resolve(owner, squad);
      const budget = req.options?.budget ?? s.budget;
      const pool = { cards: await cards.search(owner, { max_price: budget, limit: 5000 }), managers: await cards.managers(owner) };
      return optimizeSquad(s, req.goal, pool, rules, req.options);
    },
    async compare(owner: string, a: string | unknown, b: string | unknown, base?: string | unknown) {
      return compareSquads(await resolve(owner, a), await resolve(owner, b), rules, base === undefined ? undefined : await resolve(owner, base));
    },
    async listSquads(owner: string) {
      return store.list(owner);
    },
    async getSquad(owner: string, id: string) {
      return load(owner, id);
    },
    async saveSquad(owner: string, squad: unknown) {
      const s = parse(squad);
      if (s.owner_id !== owner) throw new Error("Squad owner does not match the signed-in user");
      return store.save({ ...s, updated_at: new Date().toISOString() });
    },
    /** Save a solution or edited copy as a NEW squad; the original stays as it was. */
    async saveSquadAs(owner: string, squad: unknown, name: string) {
      const s = parse(squad);
      if (s.owner_id !== owner) throw new Error("Squad owner does not match the signed-in user");
      return saveSquadAs(store, s, name);
    },
    async searchCards(owner: string, q: Parameters<CardSource["search"]>[1]) {
      return cards.search(owner, q);
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
