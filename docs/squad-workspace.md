# Squad workspace

The squad builder is the workspace. Chemistry Surgeon and the Squad Optimizer are actions on the squad
that is already loaded, so nobody re-enters their team to ask a new question.

```
src/workspace/   pure TypeScript, no DB or Node imports (bundles for Workers and Deno)
web/             the mobile-first screen (Vite, no framework), calls src/workspace directly
```

## One service surface

`createWorkspaceService({ rules, store, cards })` is what the website, the `fut-api` HTTP routes and the
FUT MCP tools all call. Every method takes an owner id (GafferBot's auth user id) and either a saved
squad id or a squad object. Every result carries `rule_version`, `rule_status`, `engine_version` and
`evidence` (`hypothesis` until the rule version is verified).

| Method | What it answers | Suggested route / MCP tool |
| --- | --- | --- |
| `calculateChemistry(owner, squad)` | Chemistry per player and total, plus tactical fit (separate number) | `POST /squads/chemistry` · `calculate_fut_chemistry` |
| `diagnose(owner, squad, slot?)` | Chemistry Surgeon: why a player is 2/3 and what would fix it; without `slot`, everyone below max | `POST /squads/diagnose` |
| `previewAssign(owner, squad, slot, card)` | What happens to all 11 if this card goes here | `POST /squads/preview` |
| `optimize(owner, squad, { goal, options })` | Cheapest valid ways to reach the goal | `POST /squads/optimize` · `optimize_fut_squad` |
| `compare(owner, a, b, base?)` | Side by side, with costs against the base | `POST /squads/compare` |
| `listSquads` / `getSquad` / `saveSquad` / `saveSquadAs` | Saved squads; `saveSquadAs` never overwrites the original | `GET/PUT /squads`, `POST /squads/:id/copy` · `get_my_fut_squad` |
| `searchCards(owner, query)` | Club and card search | `GET /cards` · `get_my_fut_inventory` |

Storage sits behind two small async interfaces in `store.ts`: `SquadStore` and `CardSource`. This PR
ships in-memory and browser (localStorage) versions. The GafferBot Postgres `fut` schema adapter
implements the same interfaces.

## Chemistry Surgeon

`diagnoseSlot` reads the engine's per-player breakdown and adds, for each of club, league and nation: the
count, the next threshold ("4 / 5 toward next threshold"), the teammates (and manager) counted, and
plain levers ("One in-position player who is NWSL + United States would improve 2 link groups at once").
It never computes links itself. A lever is a hint; only the optimizer's full-squad check says whether a
change is actually good.

## Squad Optimizer

`optimizeSquad(squad, goal, pool, rules, options)`:

1. **Hard constraints.** Locked players and the goal's own player are never replaced. Positions must be
   on the card. No card or player twice. Budget. Unknown prices are never bought.
2. **Candidate pruning.** Per open slot, keep the top cards (default 8) by links shared with the goal
   player and the rest of the XI. Managers likewise (top 4).
3. **Combinations.** Beam search over 1 to 4 swaps plus an optional manager change.
4. **Validation.** Every candidate squad goes through the chemistry engine; all 11 are recalculated.
5. **Rejection.** A squad that meets the goal but lowers team chemistry is rejected as net-negative
   (unless `allow_net_loss`) and listed under `rejected` with who loses what.
6. **Ranking.** Cheapest, then fewest changes, then team chemistry, then fit. Supersets of a cheaper
   option that add nothing are dropped.
7. **Explanation.** Each option lists the swaps, who gains and loses, and a buy list.

If nothing works, it re-runs with one constraint relaxed at a time and says which would have to change
(budget, swaps or manager change, a locked player, or the net-loss rule). No CP-SAT yet; the search is
fast enough for one squad (about 700 squads checked in under 0.1 s on the demo).

## Tactical fit is not chemistry

`fit.ts` gives a 0-99 **estimate** from face stats, weighted by a per-position profile the user can
change (e.g. "Defensive wide midfielder" for the 3-5-2 RM: defending 30, pace 25, passing 20, dribbling
15, physical 10). It is shown next to chemistry, never added to it. Sub-attributes, PlayStyles and
Role++ come later.

## Demo data

`src/workspace/demo.ts` is made up (players, clubs, prices) so the public repo carries no EA data. It is
shaped like the brief: a 3-5-2 whose US/NWSL striker sits at 2/3 with 4/5 nation and 4/5 league, with
four locked players. Import your real squad from **My squads > Import** (paste a saved squad or a filled
`data/manual/seed-352.json`), or add cards with **Add card**.

## Run it

```sh
npm run dev         # http://localhost:5173
npm run build:web   # out/web; XI_BASE=/fut/ npm run build:web for gafferbot.app/fut
```
