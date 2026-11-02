# Chemistry engine

`src/chemistry/` computes FUT chemistry deterministically from a **rule version** (rows in
`chemistry_rule_versions`, `chemistry_thresholds`, `chemistry_modifiers`). It is pure TypeScript with no
database or Node imports, so the same code runs in tests, a Cloudflare Worker, or a Supabase Edge
Function. Callers load the rules (`loadChemistryRules` for SQLite/D1) and pass them in.

```ts
import { computeSquadChemistry, previewSwap, diffSquadChemistry } from "./src/chemistry/index.js";

const result = computeSquadChemistry(squad, rules);   // total, max, per-player breakdown
const { diff } = previewSwap(squad, "RCDM", newCard, rules); // who gains or loses, and why
```

## How a squad is scored

1. A player is **in position** when the slot's position is one of the card's positions. Out of position
   means 0 chemistry and contributing to no one's counts.
2. Each in-position player adds 1 to the count of their club, league and nation. Icons and Heroes add
   the extra counts the rule version gives them (`icon.*`, `hero.*`). An Icon also adds
   `icon.every_league_bonus` to every other league in the XI.
3. A player's points per link type come from the thresholds (`[2, 4, 7]` = 1 point at 2, 2 at 4, 3 at 7).
4. The manager adds `manager.nation_count` to their nation's count and `manager.league_count` to their
   league's count, like an extra player. The active version, `fc27-community-v1`, uses this (Jeff
   checked it in game on 2026-11-02). `manager.bonus` (direct +1 chemistry) is the older reading kept
   in `fc27-community-v0`, which is now inactive.
5. Chemistry is capped at `player.max_chemistry`; team max is that x 11.

Nothing above is a hardcoded number. A modifier key the engine doesn't know shows up as a warning.

## Trust

`fc27-community-v1` is **unverified** (community thresholds). While a rule version is unverified, every
result has `evidence: "hypothesis"` and `full_chemistry_verified: false`, even at 33/33. To verify it,
fill `data/manual/seed-352.json` from the game (copy the template) and run `npm test`: the gated test in
`tests/chemistry-seed-real.test.ts` compares the engine with the in-game numbers. Open questions to
check in game: whether Icons/Heroes get automatic max chemistry in FC 27 (`icon.always_max`, `hero.always_max`, off by default).

Bump `ENGINE_VERSION` in `engine.ts` when the interpretation of a rule changes.
