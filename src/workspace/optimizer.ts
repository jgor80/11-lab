// Squad Optimizer: constrained search over swaps, validated by the chemistry engine.
// Stages: read squad -> hard constraints -> prune candidates -> combine 1..N swaps (+ manager) with a beam
// search -> validate every squad with the engine -> rank -> explain. No link maths happens here.
import { diffSquadChemistry, LINK_TYPES, type ChemistryRules, type LinkType, type SquadChemistryDiff } from "../chemistry/index.js";
import { assignCard, costBetween, evaluateSquad, getSlot, setManager, type SquadEvaluation } from "./squad.js";
import type { Manager, Provenance, Squad, WorkspaceCard } from "./types.js";

export interface OptimizeGoal {
  /** Raise the player in this slot to `slot_target` chemistry (default: max). */
  slot?: string;
  slot_target?: number;
  /** Reach at least this team chemistry. */
  total_target?: number;
}

export interface OptimizeOptions {
  /** Coins available; defaults to squad.budget. */
  budget?: number;
  /** Player swaps per solution, 1-4 (default 3). A manager change doesn't count as a swap. */
  max_swaps?: number;
  allow_manager_change?: boolean;
  /** Default false: a solution that lowers team chemistry is rejected and reported. */
  allow_net_loss?: boolean;
  per_slot_candidates?: number;
  beam_width?: number;
  max_results?: number;
  /** When nothing fits, re-run with each constraint relaxed to say which one blocks it (default true). */
  explain_infeasible?: boolean;
}

export interface CandidatePool {
  cards: WorkspaceCard[];
  managers?: Manager[];
}

type Move =
  | { kind: "card"; slot: string; card: WorkspaceCard; cost: number }
  | { kind: "manager"; manager: Manager; cost: number };

export interface SwapStep {
  slot: string;
  position: string;
  out: { id: string; name: string } | null;
  in: { id: string; name: string; club: string | null; league: string | null; nation: string | null; owned: boolean };
  cost: number;
}

export interface Solution extends Provenance {
  id: string;
  swaps: SwapStep[];
  manager_change: { from: string | null; to: string; cost: number } | null;
  cost: number;
  new_starters: number;
  total_before: number;
  total_after: number;
  slot_before: number | null;
  slot_after: number | null;
  fit_before: number | null;
  fit_after: number | null;
  diff: SquadChemistryDiff;
  buy: { name: string; price: number; slot?: string }[];
  explanation: string[];
  squad: Squad;
}

export interface RejectedOption {
  swaps: string[];
  cost: number;
  total_before: number;
  total_after: number;
  reason: string;
}

export interface OptimizeResult extends Provenance {
  status: "already_met" | "solutions" | "infeasible";
  goal: OptimizeGoal & { description: string };
  constraints: { budget: number; max_swaps: number; allow_manager_change: boolean; allow_net_loss: boolean; protected_slots: string[] };
  total_before: number;
  slot_before: number | null;
  solutions: Solution[];
  /** Options that met the goal but broke a rule (e.g. net-negative), so the user can see why they weren't offered. */
  rejected: RejectedOption[];
  /** When infeasible: which constraint would need to change. */
  blockers: string[];
  stats: { candidates: number; managers: number; squads_checked: number };
}

const norm = (s: string | null | undefined) => s?.trim().toLowerCase() || null;
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const costOf = (x: { owned?: boolean; price?: number | null }): number | null => (x.owned ? 0 : typeof x.price === "number" ? x.price : null);
const moveKey = (m: Move) => (m.kind === "card" ? `${m.slot}=${m.card.id}` : `MGR=${m.manager.id}`);

interface State {
  moves: Move[];
  cost: number;
  squad: Squad;
  ev: SquadEvaluation;
}

export function optimizeSquad(squad: Squad, goal: OptimizeGoal, pool: CandidatePool, rules: ChemistryRules, options: OptimizeOptions = {}): OptimizeResult {
  const max = rules.modifiers["player.max_chemistry"] ?? 3;
  const budget = options.budget ?? squad.budget;
  const maxSwaps = Math.min(4, Math.max(1, options.max_swaps ?? 3));
  const allowMgr = options.allow_manager_change ?? true;
  const allowLoss = options.allow_net_loss ?? false;
  const K = options.per_slot_candidates ?? 8;
  const B = options.beam_width ?? 60;
  const maxResults = options.max_results ?? 5;

  const base = evaluateSquad(squad, rules);
  const prov: Provenance = { rule_version: base.rule_version, rule_status: base.rule_status, engine_version: base.engine_version, evidence: base.evidence };
  const target = goal.slot ? getSlot(squad, goal.slot) : null;
  if (goal.slot && !target?.card) throw new Error(`Slot ${goal.slot} is empty; put a player there first`);
  const slotTarget = goal.slot ? goal.slot_target ?? max : null;
  const slotChem = (ev: SquadEvaluation) => (target ? ev.chemistry.players.find((p) => p.slot === target.slot)?.chemistry ?? 0 : null);
  const description = [
    target ? `get ${target.card!.name} (${target.slot}) to ${slotTarget}/${max}` : null,
    goal.total_target !== undefined ? `reach ${goal.total_target}/${base.chemistry.max} team chemistry` : null,
  ].filter(Boolean).join(" and ") || "improve team chemistry";
  const met = (ev: SquadEvaluation) =>
    (slotTarget === null || (slotChem(ev) ?? 0) >= slotTarget) && (goal.total_target === undefined || ev.chemistry.total >= goal.total_target);

  // Hard constraints: locked players and the goal's own player are never replaced.
  const protectedSlots = squad.slots.filter((s) => s.locked || (target && s.slot === target.slot)).map((s) => s.slot);
  const swappable = squad.slots.filter((s) => !protectedSlots.includes(s.slot));
  const constraints = { budget, max_swaps: maxSwaps, allow_manager_change: allowMgr, allow_net_loss: allowLoss, protected_slots: protectedSlots };
  const result = (status: OptimizeResult["status"], extra: Partial<OptimizeResult> = {}): OptimizeResult => ({
    ...prov,
    status,
    goal: { ...goal, description },
    constraints,
    total_before: base.chemistry.total,
    slot_before: slotChem(base),
    solutions: [],
    rejected: [],
    blockers: [],
    stats: { candidates: 0, managers: 0, squads_checked: 0 },
    ...extra,
  });
  if (met(base)) return result("already_met");

  // Candidate pruning. Relevance = links the card would share with the goal player and with the protected core.
  const tp = target ? base.chemistry.players.find((p) => p.slot === target.slot) : null;
  const wantKeys = new Map<LinkType, string>();
  if (target?.card) for (const t of LINK_TYPES) { const k = norm(target.card[t]); if (k) wantKeys.set(t, k); }
  const coreCount = (t: LinkType, key: string | null, exceptSlot: string) =>
    key ? squad.slots.filter((s) => s.card && s.slot !== exceptSlot && norm(s.card[t]) === key).length : 0;
  const relevance = (c: WorkspaceCard, slot: string) => {
    let r = 0;
    for (const t of LINK_TYPES) {
      const key = norm(c[t]);
      if (!key) continue;
      if (wantKeys.get(t) === key) {
        const need = tp?.breakdown[t].needed_for_next;
        r += need !== null && need !== undefined && need <= 2 ? 6 : 2;
      }
      r += Math.min(coreCount(t, key, slot), 4) * 0.5;
    }
    return r;
  };
  const names = (s: Squad, exceptSlot?: string) => new Set(s.slots.filter((x) => x.card && x.slot !== exceptSlot).map((x) => norm(x.card!.name)));
  const moves: Move[] = [];
  let candidateCount = 0;
  for (const s of swappable) {
    const taken = names(squad, s.slot);
    const options_ = pool.cards
      .filter((c) => c.id !== s.card?.id && c.positions.some((p) => same(p, s.position)) && !taken.has(norm(c.name)))
      .map((c) => ({ c, cost: costOf(c) }))
      .filter((x): x is { c: WorkspaceCard; cost: number } => x.cost !== null && x.cost <= budget)
      .map((x) => ({ ...x, rel: relevance(x.c, s.slot) }))
      .filter((x) => x.rel > 0)
      .sort((a, b) => b.rel - a.rel || a.cost - b.cost)
      .slice(0, K);
    candidateCount += options_.length;
    for (const o of options_) moves.push({ kind: "card", slot: s.slot, card: o.c, cost: o.cost });
  }
  let managerCount = 0;
  if (allowMgr && pool.managers) {
    const ms = pool.managers
      .filter((m) => m.id !== squad.manager?.id)
      .map((m) => ({ m, cost: costOf(m) }))
      .filter((x): x is { m: Manager; cost: number } => x.cost !== null && x.cost <= budget)
      .map((x) => ({ ...x, rel: (norm(x.m.nation) && norm(x.m.nation) === wantKeys.get("nation") ? 3 : 0) + (norm(x.m.league) && norm(x.m.league) === wantKeys.get("league") ? 3 : 0) + coreCount("league", norm(x.m.league), "") * 0.3 + coreCount("nation", norm(x.m.nation), "") * 0.3 }))
      .filter((x) => x.rel > 0)
      .sort((a, b) => b.rel - a.rel || a.cost - b.cost)
      .slice(0, 4);
    managerCount = ms.length;
    for (const x of ms) moves.push({ kind: "manager", manager: x.m, cost: x.cost });
  }

  // Beam search over combinations. Every child squad is scored by the engine.
  const heuristic = (st: State) => {
    let h = st.ev.chemistry.total;
    if (target) {
      const p = st.ev.chemistry.players.find((x) => x.slot === target.slot)!;
      h += p.chemistry * 20;
      for (const t of LINK_TYPES) {
        const b = p.breakdown[t];
        if (b.next_threshold) h += (b.count / b.next_threshold) * 5;
      }
    }
    return h - st.cost / Math.max(budget, 1);
  };
  const apply = (st: State, m: Move): State | null => {
    if (st.cost + m.cost > budget) return null;
    if (m.kind === "manager") {
      if (st.moves.some((x) => x.kind === "manager")) return null;
      const sq = setManager(st.squad, m.manager);
      return { moves: [...st.moves, m], cost: st.cost + m.cost, squad: sq, ev: evaluateSquad(sq, rules) };
    }
    if (st.moves.filter((x) => x.kind === "card").length >= maxSwaps) return null;
    if (st.moves.some((x) => x.kind === "card" && (x.slot === m.slot || x.card.id === m.card.id))) return null;
    if (names(st.squad, m.slot).has(norm(m.card.name))) return null;
    const sq = assignCard(st.squad, m.slot, m.card);
    return { moves: [...st.moves, m], cost: st.cost + m.cost, squad: sq, ev: evaluateSquad(sq, rules) };
  };

  const found: State[] = [];
  const rejected: { st: State; reason: string }[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let beam: State[] = [{ moves: [], cost: 0, squad, ev: base }];
  const depth = maxSwaps + (managerCount ? 1 : 0);
  for (let d = 0; d < depth && beam.length; d++) {
    const next: State[] = [];
    for (const st of beam) {
      for (const m of moves) {
        const key = [...st.moves.map(moveKey), moveKey(m)].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const child = apply(st, m);
        if (!child) continue;
        checked++;
        if (met(child.ev)) {
          if (!allowLoss && child.ev.chemistry.total < base.chemistry.total) {
            const losers = diffSquadChemistry(base.chemistry, child.ev.chemistry).changes.filter((c) => c.delta < 0 && c.name_before === c.name_after);
            rejected.push({ st: child, reason: `Net loss: team chemistry ${base.chemistry.total} -> ${child.ev.chemistry.total}${losers.length ? `; ${losers.map((l) => `${l.name_after} ${l.before}->${l.after}`).join(", ")}` : ""}` });
          } else found.push(child);
          continue; // adding more swaps to a squad that already meets the goal only costs more
        }
        next.push(child);
      }
    }
    beam = next.sort((a, b) => heuristic(b) - heuristic(a)).slice(0, B);
  }

  // Rank: cheapest, then fewest changes, then best team chemistry, then fit.
  found.sort(
    (a, b) =>
      a.cost - b.cost ||
      a.moves.length - b.moves.length ||
      b.ev.chemistry.total - a.ev.chemistry.total ||
      (b.ev.fit.average ?? 0) - (a.ev.fit.average ?? 0),
  );
  const picked: State[] = [];
  for (const st of found) {
    const keys = new Set(st.moves.map(moveKey));
    // Skip a solution that contains a cheaper one already picked and adds no team chemistry.
    const dominated = picked.some((p) => p.moves.every((m) => keys.has(moveKey(m))) && st.ev.chemistry.total <= p.ev.chemistry.total);
    if (!dominated) picked.push(st);
    if (picked.length >= maxResults) break;
  }
  const stats = { candidates: candidateCount, managers: managerCount, squads_checked: checked };
  const rejectedOut = rejected
    .sort((a, b) => a.st.cost - b.st.cost)
    .slice(0, 5)
    .map((r) => ({
      swaps: r.st.moves.map((m) => (m.kind === "card" ? `${m.card.name} into ${m.slot}` : `manager ${m.manager.name}`)),
      cost: r.st.cost,
      total_before: base.chemistry.total,
      total_after: r.st.ev.chemistry.total,
      reason: r.reason,
    }));

  if (picked.length) {
    return result("solutions", { solutions: picked.map((st, i) => toSolution(st, i)), rejected: rejectedOut, stats });
  }

  const blockers: string[] = [];
  if (moves.length === 0) blockers.push(`No card or manager in the search pool shares a club, league or nation that would help, within ${budget.toLocaleString("en-US")} coins. Add cards to the pool or raise the budget.`);
  if (options.explain_infeasible !== false && moves.length >= 0) {
    const relaxed = (o: OptimizeOptions, sq: Squad = squad) => optimizeSquad(sq, goal, pool, rules, { ...options, ...o, explain_infeasible: false, max_results: 1 });
    const cheapest = (r: OptimizeResult) => r.solutions[0];
    const rb = relaxed({ budget: Number.MAX_SAFE_INTEGER });
    if (cheapest(rb)) blockers.push(`Budget: possible for ${cheapest(rb)!.cost.toLocaleString("en-US")} coins, ${(cheapest(rb)!.cost - budget).toLocaleString("en-US")} more than your budget.`);
    if (maxSwaps < 4 || !allowMgr) {
      const rs = relaxed({ max_swaps: 4, allow_manager_change: true });
      if (cheapest(rs)) blockers.push(`Swaps: possible with ${cheapest(rs)!.swaps.length} swaps${cheapest(rs)!.manager_change ? " and a manager change" : ""}; you allowed ${maxSwaps}${allowMgr ? "" : " and no manager change"}.`);
    }
    const locked = squad.slots.filter((s) => s.locked && s.slot !== target?.slot);
    if (locked.length) {
      const unlocked = { ...squad, slots: squad.slots.map((s) => (s.slot === target?.slot ? s : { ...s, locked: false })) };
      const rl = cheapest(relaxed({}, unlocked));
      if (rl) {
        const needs = rl.swaps.filter((w) => locked.some((l) => l.slot === w.slot)).map((w) => `${w.out?.name ?? "empty"} (${w.slot})`);
        if (needs.length) blockers.push(`Locked players: possible if you unlock ${needs.join(", ")}.`);
      }
    }
    if (!allowLoss && rejected.length) blockers.push(`Net loss: ${rejectedOut[0]!.swaps.join(" + ")} reaches the goal but drops team chemistry ${rejectedOut[0]!.total_before} -> ${rejectedOut[0]!.total_after}.`);
    if (!blockers.length) blockers.push("Not reachable even with each constraint relaxed on its own: the search pool lacks the right cards. Add club or market cards that share this player's nation, league or club.");
  }
  return result("infeasible", { rejected: rejectedOut, blockers, stats });

  function toSolution(st: State, i: number): Solution {
    const swaps: SwapStep[] = [];
    let mgr: Solution["manager_change"] = null;
    for (const m of st.moves) {
      if (m.kind === "manager") {
        mgr = { from: squad.manager?.name ?? null, to: m.manager.name, cost: m.cost };
        continue;
      }
      const old = getSlot(squad, m.slot);
      swaps.push({
        slot: m.slot,
        position: old.position,
        out: old.card ? { id: old.card.id, name: old.card.name } : null,
        in: { id: m.card.id, name: m.card.name, club: m.card.club, league: m.card.league, nation: m.card.nation, owned: !!m.card.owned },
        cost: m.cost,
      });
    }
    const diff = diffSquadChemistry(base.chemistry, st.ev.chemistry);
    const explanation: string[] = [];
    for (const w of swaps) {
      const shared = target?.card ? LINK_TYPES.filter((t) => norm(target.card![t]) && norm(target.card![t]) === norm(w.in[t])).map((t) => w.in[t]) : [];
      explanation.push(
        `${w.in.owned ? "Use" : `Buy (${w.cost.toLocaleString("en-US")})`} ${w.in.name} at ${w.slot}${w.out ? ` for ${w.out.name}` : ""}${shared.length ? `: shares ${shared.join(" + ")} with ${target!.card!.name}` : ""}.`,
      );
    }
    if (mgr) explanation.push(`Change manager to ${mgr.to}${mgr.cost ? ` (${mgr.cost.toLocaleString("en-US")})` : ""}.`);
    if (target) explanation.push(`${target.card!.name}: ${slotChem(base)} -> ${slotChem(st.ev)}.`);
    const gain = diff.changes.filter((c) => c.delta > 0 && c.name_before === c.name_after && c.slot !== target?.slot);
    const loss = diff.changes.filter((c) => c.delta < 0 && c.name_before === c.name_after);
    if (gain.length) explanation.push(`Also gain: ${gain.map((c) => `${c.name_after} ${c.before}->${c.after}`).join(", ")}.`);
    if (loss.length) explanation.push(`Lose: ${loss.map((c) => `${c.name_after} ${c.before}->${c.after}`).join(", ")}.`);
    explanation.push(`Team chemistry ${base.chemistry.total} -> ${st.ev.chemistry.total}/${st.ev.chemistry.max} (all ${st.ev.filled} starters recalculated).`);
    const named = { ...st.squad, name: `${squad.name} (option ${i + 1})` };
    return {
      ...prov,
      id: `opt_${i + 1}_${st.moves.map(moveKey).sort().join("_")}`,
      swaps,
      manager_change: mgr,
      cost: st.cost,
      new_starters: swaps.filter((w) => !w.in.owned).length,
      total_before: base.chemistry.total,
      total_after: st.ev.chemistry.total,
      slot_before: slotChem(base),
      slot_after: slotChem(st.ev),
      fit_before: base.fit.average,
      fit_after: st.ev.fit.average,
      diff,
      buy: costBetween(squad, st.squad).buy,
      explanation,
      squad: named,
    };
  }
}
