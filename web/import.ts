// Turn pasted JSON (a saved squad, or data/manual/seed-352.json) into a workspace squad.
import { assignCard, createSquad, setLocked, setManager, squadSchema, type Squad, type WorkspaceCard } from "../src/workspace/index.js";

interface SeedSlot {
  slot?: string | null;
  position?: string | null;
  locked?: boolean;
  card: { name: string; club?: string | null; league?: string | null; nation?: string | null; positions?: string[]; is_icon?: boolean; is_hero?: boolean };
}

export function importSquad(text: string, owner: string): Squad {
  const raw = JSON.parse(text);
  const asSquad = squadSchema.safeParse({ ...raw, owner_id: owner });
  if (asSquad.success) return { ...(asSquad.data as Squad), id: `sq_import_${Date.now()}` };
  if (!raw || !Array.isArray(raw.slots)) throw new Error("Expected a squad, or the seed-352.json format with a slots array");
  let s = createSquad({ formation: raw.formation ?? "3-5-2", name: raw.name ?? "Imported squad", owner_id: owner, budget: raw.budget ?? 0 });
  const free = () => s.slots.filter((x) => !x.card);
  const locks: string[] = [];
  (raw.slots as SeedSlot[]).forEach((row, i) => {
    const c = row.card;
    const card: WorkspaceCard = {
      id: `user-${Date.now()}-${i}`,
      name: c.name,
      club: c.club ?? null,
      league: c.league ?? null,
      nation: c.nation ?? null,
      positions: (c.positions ?? []).map((p) => p.toUpperCase()),
      is_icon: !!c.is_icon,
      is_hero: !!c.is_hero,
      owned: true,
      source: "user",
    };
    const target =
      free().find((x) => row.slot && x.slot.toUpperCase() === row.slot.toUpperCase()) ??
      free().find((x) => row.position && x.position === row.position.toUpperCase()) ??
      free().find((x) => card.positions.includes(x.position)) ??
      free()[0];
    if (!target) return;
    s = assignCard(s, target.slot, card);
    if (row.locked) locks.push(target.slot);
  });
  for (const l of locks) s = setLocked(s, l, true);
  if (raw.manager && (raw.manager.nation || raw.manager.league)) {
    s = setManager(s, { id: `user-mgr-${Date.now()}`, name: raw.manager.name ?? "Manager", nation: raw.manager.nation ?? null, league: raw.manager.league ?? null, owned: true, source: "user" });
  }
  return s;
}
