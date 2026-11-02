// Acceptance test against the real game. Skipped until data/manual/seed-352.json exists with every
// field filled from FC 27 (copy seed-352.template.json). When it passes, the rule version can be
// marked verified.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "../src/db/sqlite.js";
import { loadChemistryRules } from "../src/db/chemistry-rules.js";
import { computeSquadChemistry, type SquadInput } from "../src/chemistry/index.js";

const file = new URL("../data/manual/seed-352.json", import.meta.url);
type Seed = Omit<SquadInput, "slots"> & {
  expected_in_game: { total: number | null };
  slots: (SquadInput["slots"][number] & { expected_chemistry: number | null })[];
};
const seed: Seed | null = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
const complete =
  !!seed &&
  seed.expected_in_game.total !== null &&
  seed.slots.length === 11 &&
  seed.slots.every(
    (s) => s.slot && s.position && s.expected_chemistry !== null && s.card.name && s.card.club && s.card.league && s.card.nation && s.card.positions.length,
  );

describe.skipIf(!complete)("seed 3-5-2 with real cards matches the game", () => {
  it("agrees with the in-game chemistry for every player", () => {
    const db = openDb(":memory:");
    migrate(db);
    const r = computeSquadChemistry(seed!, loadChemistryRules(db));
    expect(Object.fromEntries(r.players.map((p) => [p.slot, p.chemistry]))).toEqual(
      Object.fromEntries(seed!.slots.map((s) => [s.slot, s.expected_chemistry])),
    );
    expect(r.total).toBe(seed!.expected_in_game.total);
  });
});
