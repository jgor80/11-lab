// XI Lab squad workspace. The squad builder is the workspace; Chemistry Surgeon and the Squad Optimizer
// are actions on the squad that is already loaded. All numbers come from src/workspace (the same service
// the API and MCP tools use); this file only draws them.
import {
  DEFAULT_RULES,
  FORMATIONS,
  PRESET_PROFILES,
  DEFAULT_PROFILES,
  assignCard,
  compareSquads,
  createSquad,
  diagnoseSlot,
  diagnoseSquad,
  evaluateSquad,
  filterCards,
  fitScore,
  formationSlots,
  getSlot,
  optimizeSquad,
  previewAssign,
  saveSquadAs,
  setFormation,
  setLocked,
  setManager,
  swapSlots,
  type FitProfile,
  type Manager,
  type OptimizeResult,
  type Solution,
  type Squad,
  type WorkspaceCard,
} from "../src/workspace/index.js";
import { DEMO_MANAGERS, DEMO_POOL, demoSquad } from "../src/workspace/demo.js";
import { importSquad } from "./import.js";
import { LocalSquadStore, prefs, userCards, userManagers } from "./storage.js";

const OWNER = "local";
const rules = DEFAULT_RULES;
const store = new LocalSquadStore();

type Mode = "slot" | "search" | "optimize" | "compare" | "squads" | "analyze" | "add";
interface State {
  squad: Squad;
  saved: boolean;
  sel: string | null;
  mode: Mode | null;
  preview: Solution | null;
  opt: OptimizeResult | null;
  optSlot: string | null;
  picked: string[];
  cards: WorkspaceCard[];
  managers: Manager[];
  search: { text: string; position: string; owned: boolean; maxPrice: string };
  optForm: { budget: number; maxSwaps: number; mgr: boolean; netLoss: boolean };
  profiles: Record<string, string>;
  squads: Squad[];
  toast: string | null;
}

const p0 = prefs.load();
const S: State = {
  squad: demoSquad(OWNER),
  saved: false,
  sel: null,
  mode: null,
  preview: null,
  opt: null,
  optSlot: null,
  picked: [],
  cards: [...DEMO_POOL, ...userCards.load()],
  managers: [...DEMO_MANAGERS, ...userManagers.load()],
  search: { text: "", position: "", owned: false, maxPrice: "" },
  optForm: { budget: 200_000, maxSwaps: 3, mgr: true, netLoss: false },
  profiles: p0.profiles ?? {},
  squads: [],
  toast: null,
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const coins = (n: number) => n.toLocaleString("en-US");
const app = document.getElementById("app")!;
const isDesktop = () => window.matchMedia("(min-width: 1000px)").matches;

/** Every card the workspace knows: pool, plus cards sitting in the squad (they're owned). */
const allCards = () => {
  const ids = new Set(S.cards.map((c) => c.id));
  return [...S.cards, ...S.squad.slots.flatMap((s) => (s.card && !ids.has(s.card.id) ? [{ ...s.card, owned: true }] : []))];
};
const profileFor = (slot: string): FitProfile | undefined => PRESET_PROFILES.find((p) => p.id === S.profiles[`${S.squad.id}:${slot}`]);
const profilesMap = () => Object.fromEntries(S.squad.slots.flatMap((s) => (profileFor(s.slot) ? [[s.slot, profileFor(s.slot)!]] : [])));
const shown = () => S.preview?.squad ?? S.squad;

function update(fn: () => void) {
  try {
    fn();
  } catch (e) {
    flash((e as Error).message);
  }
  render();
}
function flash(msg: string) {
  S.toast = msg;
  render();
  setTimeout(() => {
    if (S.toast === msg) {
      S.toast = null;
      render();
    }
  }, 2600);
}
function edit(next: Squad) {
  S.squad = next;
  S.saved = false;
  S.opt = null;
  S.picked = [];
}

function evidenceBadge(ev: string) {
  return ev === "verified" ? `<span class="badge b-ver">verified</span>` : `<span class="badge b-hyp" title="Rule version ${esc(rules.id)} is ${esc(rules.status)}: not yet confirmed against the game">hypothesis</span>`;
}
function pips(chem: number, max = 3) {
  return `<div class="pips c${chem}">${Array.from({ length: max }, (_, i) => `<i class="pip ${i < chem ? "on" : ""}"></i>`).join("")}</div>`;
}

function renderHeader() {
  const sq = shown();
  const ev = evaluateSquad(sq, rules, profilesMap());
  const mgrOpts = [`<option value="">No manager</option>`, ...S.managers.map((m) => `<option value="${esc(m.id)}" ${sq.manager?.id === m.id ? "selected" : ""}>${esc(m.name)} · ${esc(m.nation ?? "?")} · ${esc(m.league ?? "?")}</option>`)].join("");
  return `
  <header class="top">
    <div class="brand">XI LAB</div>
    <div class="muted small">Squad Intelligence / My Starting XI</div>
    <input class="squadname" data-input="name" value="${esc(sq.name)}" aria-label="Squad name" ${S.preview ? "disabled" : ""}/>
    <div class="row small muted">
      <select data-input="formation" style="width:auto" ${S.preview ? "disabled" : ""}>${Object.keys(FORMATIONS).map((f) => `<option ${f === sq.formation ? "selected" : ""}>${f}</option>`).join("")}</select>
      <span>FC 27 · ${esc(sq.platform ?? "Any platform")}</span>
      <select data-input="manager" style="width:auto;max-width:100%" ${S.preview ? "disabled" : ""}>${mgrOpts}</select>
      ${S.saved ? `<span>Saved</span>` : `<span class="warn">Unsaved changes</span>`}
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Chemistry ${evidenceBadge(ev.evidence)}</div><div class="v">${ev.chemistry.total}/${ev.chemistry.max}</div></div>
      <div class="stat"><div class="k">Available budget</div><div class="v">${coins(sq.budget)}</div></div>
      <div class="stat"><div class="k">Starting XI</div><div class="v">${ev.filled}/${ev.size}</div></div>
      <div class="stat"><div class="k">Tactical fit <span class="badge b-est">estimate</span></div><div class="v">${ev.fit.average ?? "–"}</div></div>
    </div>
  </header>
  <nav class="toolbar">
    <button class="primary" data-act="save" ${S.preview ? "disabled" : ""}>Save</button>
    <button data-act="saveas" ${S.preview ? "disabled" : ""}>Save as new</button>
    <button data-act="mode" data-mode="analyze">Analyze my squad</button>
    <button data-act="mode" data-mode="optimize">Optimize</button>
    <button data-act="mode" data-mode="squads">My squads</button>
    <button data-act="mode" data-mode="add">Add card</button>
    <a class="btn" href="./market.html">Market Lab</a>
  </nav>`;
}

function renderPitch() {
  const sq = shown();
  const ev = evaluateSquad(sq, rules);
  const changed = new Set(S.preview?.swaps.map((w) => w.slot) ?? []);
  const rows = new Map<number, string[]>();
  for (const f of formationSlots(sq.formation)) rows.set(f.row, [...(rows.get(f.row) ?? []), f.slot]);
  const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, slots]) => {
    return `<div class="line">${slots
      .map((name) => {
        const s = getSlot(sq, name);
        const p = ev.chemistry.players.find((x) => x.slot === s.slot);
        const cls = ["slot", S.sel === s.slot ? "sel" : "", changed.has(s.slot) ? "changed" : "", p && !p.in_position ? "oop" : ""].join(" ");
        return `<div class="${cls}" data-act="slot" data-slot="${esc(s.slot)}" role="button" tabindex="0">
          ${s.locked ? `<span class="lock" title="Locked">🔒</span>` : ""}
          <div class="pos">${esc(s.slot)}</div>
          ${s.card ? `<div class="nm">${esc(s.card.name)}</div>${pips(p?.chemistry ?? 0)}` : `<div class="empty">+</div>`}
        </div>`;
      })
      .join("")}</div>`;
  });
  const banner = S.preview
    ? `<div class="banner"><b>Previewing:</b> ${esc(S.preview.squad.name)} · ${S.preview.total_before} → ${S.preview.total_after} chemistry · ${coins(S.preview.cost)} coins. Blue slots change.
       <div class="row" style="margin-top:6px"><button class="primary" data-act="apply" data-id="${esc(S.preview.id)}">Save as new squad</button><button data-act="endpreview">Back to my squad</button></div></div>`
    : "";
  return `<section>${banner}<div class="pitch">${lines.join("")}</div>
    <p class="muted small">Chemistry uses rule version <b>${esc(rules.id)}</b> (${esc(rules.status)}), so every number is labelled a hypothesis until it's checked against the game. Demo cards are made up.</p></section>`;
}

function renderSlotPanel() {
  const sq = shown();
  if (!S.sel) return `<h3>Pick a player</h3><p class="muted">Tap any slot on the pitch to see why their chemistry is what it is, lock them, or change them.</p>`;
  const s = getSlot(sq, S.sel);
  if (!s.card) return `<h3>${esc(s.slot)} · ${esc(s.position)}</h3><p class="muted">Empty slot.</p><button class="primary" data-act="mode" data-mode="search">Find a ${esc(s.position)}</button>`;
  const d = diagnoseSlot(sq, s.slot, rules);
  const fit = fitScore(s.card, s.position, profileFor(s.slot));
  const links = d.links
    .map((l) => {
      const pct = l.next_threshold ? Math.round((l.count / l.next_threshold) * 100) : 100;
      return `<div class="linkrow"><div class="row"><b class="grow">${esc(l.label)} · ${esc(l.key ?? "not entered")}</b><span>${l.points}/${l.max_points} pts</span></div>
        <div class="small muted">${esc(l.progress)}${l.contributors.length ? ` · ${esc(l.contributors.join(", "))}` : ""}</div>
        ${l.key ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ""}</div>`;
    })
    .join("");
  const profOpts = [`<option value="">${esc(DEFAULT_PROFILES[s.position]?.label ?? "Default")}</option>`, ...PRESET_PROFILES.map((p) => `<option value="${p.id}" ${S.profiles[`${sq.id}:${s.slot}`] === p.id ? "selected" : ""}>${esc(p.label)}</option>`)].join("");
  return `
    <div class="small muted">${esc(s.slot)} · ${esc(s.card.positions.join("/"))} · ${esc(s.card.club ?? "?")} · ${esc(s.card.nation ?? "?")} · ${esc(s.card.league ?? "?")} ${s.card.source === "fixture" ? `<span class="badge b-demo">demo</span>` : ""}</div>
    <h3 style="font-size:20px">${esc(s.card.name)}</h3>
    <div class="small"><a href="./market.html#card/${encodeURIComponent(s.card.id)}">View Market Intelligence →</a></div>
    <div class="row"><div class="bigchem">${d.chemistry}/${d.max}</div><div class="grow small">${evidenceBadge(d.evidence)}<div>${esc(d.summary)}</div></div></div>
    <h4>Chemistry diagnosis</h4>${links}
    ${d.manager_bonus ? `<div class="small">Manager bonus +${d.manager_bonus}</div>` : ""}
    ${d.levers.length ? `<h4>Potential fixes</h4><ul class="levers">${d.levers.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="small muted">${esc(d.caveat)}</p>` : ""}
    ${!S.preview && d.chemistry < d.max ? `<button class="primary" data-act="fix" data-slot="${esc(s.slot)}">Find the cheapest way to get ${esc(s.card.name)} to ${d.max}/${d.max}</button>` : ""}
    <h4>Tactical fit <span class="badge b-est">estimate</span></h4>
    <div class="row"><div class="bigchem" style="font-size:28px">${fit.score ?? "–"}</div><label class="grow">What this position should do<select data-input="profile">${profOpts}</select></label></div>
    <p class="small muted">Fit is a configurable estimate from face stats, kept apart from chemistry (which comes from game rules).</p>
    ${S.preview ? "" : `<div class="row" style="margin-top:10px">
      <button data-act="lock">${s.locked ? "🔓 Unlock" : "🔒 Lock"}</button>
      <button data-act="mode" data-mode="search">Change player</button>
      <button data-act="remove" ${s.locked ? "disabled" : ""}>Remove</button>
      <select data-input="moveto" style="width:auto"><option value="">Swap with…</option>${sq.slots.filter((x) => x.slot !== s.slot).map((x) => `<option value="${esc(x.slot)}">${esc(x.slot)}${x.card ? ` · ${esc(x.card.name)}` : ""}</option>`).join("")}</select>
    </div>`}`;
}

function renderSearch() {
  const target = S.sel ? getSlot(S.squad, S.sel) : null;
  const pos = S.search.position || target?.position || "";
  const max = S.search.maxPrice ? Number(S.search.maxPrice) : undefined;
  const inSquad = new Set(S.squad.slots.flatMap((s) => (s.card ? [s.card.id] : [])));
  const found = filterCards(allCards(), { text: S.search.text, position: pos || undefined, owned_only: S.search.owned, max_price: max, limit: 40 }).filter((c) => !inSquad.has(c.id));
  const items = found
    .map((c) => {
      let delta = "";
      if (target && !target.locked) {
        try {
          const p = previewAssign(S.squad, target.slot, c, rules);
          const d = p.total_after - p.total_before;
          delta = `<span class="delta ${d > 0 ? "up" : d < 0 ? "down" : ""}">team ${d > 0 ? "+" : ""}${d}</span>`;
        } catch (e) {
          delta = `<span class="muted small">${esc((e as Error).message)}</span>`;
        }
      }
      return `<div class="item" data-act="assign" data-id="${esc(c.id)}">
        <div class="row"><b class="grow">${esc(c.name)}</b>${c.rating ? `<span>${c.rating}</span>` : ""}${delta}</div>
        <div class="small muted">${esc(c.positions.join("/"))} · ${esc(c.club ?? "?")} · ${esc(c.nation ?? "?")} · ${esc(c.league ?? "?")} · ${c.owned ? "in club" : typeof c.price === "number" ? `${coins(c.price)} coins` : "no price"} ${c.source === "fixture" ? `<span class="badge b-demo">demo</span>` : ""}</div>
      </div>`;
    })
    .join("");
  return `<h3>Club & card search</h3>
    <p class="small muted">${target ? `Assigning to <b>${esc(target.slot)}</b>${target.locked ? " (locked: unlock to change)" : ""}. "team ±n" is the full-squad chemistry change.` : "Pick a slot on the pitch to assign a card."}</p>
    <div class="grid2">
      <label>Search<input data-input="s.text" value="${esc(S.search.text)}" placeholder="Name, club, league, nation"/></label>
      <label>Position<select data-input="s.position"><option value="">${target ? `Slot (${esc(target.position)})` : "Any"}</option>${["GK", "CB", "LB", "RB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST"].map((p) => `<option ${S.search.position === p ? "selected" : ""}>${p}</option>`).join("")}</select></label>
      <label>Max price<input data-input="s.maxPrice" inputmode="numeric" value="${esc(S.search.maxPrice)}"/></label>
      <label class="check" style="margin-top:22px"><input type="checkbox" data-input="s.owned" ${S.search.owned ? "checked" : ""}/> Club cards only</label>
    </div>
    <div class="list" style="margin-top:10px">${items || `<p class="muted">No cards match. Add your own with "Add card".</p>`}</div>`;
}

function renderOptimize() {
  const f = S.optForm;
  const r = S.opt;
  const form = `<h3>Optimize my XI</h3>
    <p class="small muted">Searches 1–4 swaps plus an optional manager change. Locked players are never replaced. Every option is re-checked across all 11 starters by the chemistry engine.</p>
    <div class="grid2">
      <label>Goal<select data-input="o.slot"><option value="">Full team chemistry (33/33)</option>${S.squad.slots.filter((s) => s.card).map((s) => `<option value="${esc(s.slot)}" ${S.optSlot === s.slot ? "selected" : ""}>Get ${esc(s.card!.name)} to 3/3</option>`).join("")}</select></label>
      <label>Transfer budget<input data-input="o.budget" inputmode="numeric" value="${f.budget}"/></label>
      <label>Max swaps<select data-input="o.maxSwaps">${[1, 2, 3, 4].map((n) => `<option ${n === f.maxSwaps ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <div><label class="check"><input type="checkbox" data-input="o.mgr" ${f.mgr ? "checked" : ""}/> Allow manager change</label>
      <label class="check"><input type="checkbox" data-input="o.netLoss" ${f.netLoss ? "checked" : ""}/> Allow net chemistry loss</label></div>
    </div>
    <p class="small">Protected: ${S.squad.slots.filter((s) => s.locked && s.card).map((s) => esc(s.card!.name)).join(", ") || "nobody"}</p>
    <button class="primary" data-act="run">Explore solutions</button>`;
  if (!r) return form;
  let out = `<h4>Result ${evidenceBadge(r.evidence)}</h4><p>${esc(r.goal.description[0]?.toUpperCase() + r.goal.description.slice(1))}: `;
  if (r.status === "already_met") out += `already there.</p>`;
  else if (r.status === "infeasible") out += `<b class="warn">not possible within your constraints.</b></p><ul class="levers">${r.blockers.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  else out += `${r.solutions.length} option${r.solutions.length === 1 ? "" : "s"}, cheapest first. Pick two to compare.</p>`;
  out += r.solutions
    .map(
      (sol, i) => `<div class="sol ${S.picked.includes(sol.id) ? "picked" : ""}">
      <div class="head"><b>Option ${i + 1}</b><span>${sol.cost ? `${coins(sol.cost)} coins` : "Free (club cards)"}</span></div>
      <div class="small">Chemistry ${sol.total_before} → <b>${sol.total_after}</b>/33${sol.slot_after !== null ? ` · target ${sol.slot_before} → ${sol.slot_after}` : ""} · new starters ${sol.new_starters}${sol.fit_after !== null ? ` · fit ${sol.fit_before} → ${sol.fit_after}` : ""}</div>
      <ul>${sol.explanation.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${sol.buy.length ? `<div class="small muted">Buy list: ${sol.buy.map((b) => `${esc(b.name)} (${coins(b.price)})`).join(", ")}</div>` : ""}
      <div class="row" style="margin-top:6px">
        <button data-act="preview" data-id="${esc(sol.id)}">View on pitch</button>
        <button data-act="pick" data-id="${esc(sol.id)}">${S.picked.includes(sol.id) ? "✓ Comparing" : "Compare"}</button>
        <button data-act="apply" data-id="${esc(sol.id)}">Save as new squad</button>
      </div></div>`,
    )
    .join("");
  if (S.picked.length === 2) out += `<button class="primary" data-act="mode" data-mode="compare" style="margin-top:8px">Compare the two picked options</button>`;
  if (r.rejected.length)
    out += `<h4>Rejected</h4><ul class="levers small">${r.rejected.map((x) => `<li>${esc(x.swaps.join(" + "))} (${coins(x.cost)}): ${esc(x.reason)}</li>`).join("")}</ul>`;
  out += `<p class="small muted">Checked ${r.stats.squads_checked} squads from ${r.stats.candidates} candidate cards and ${r.stats.managers} managers.</p>`;
  return form + out;
}

function renderCompare() {
  const sols = S.opt?.solutions.filter((s) => S.picked.includes(s.id)) ?? [];
  if (sols.length !== 2) return `<h3>Compare</h3><p class="muted">Pick two options in Optimize first.</p>`;
  const [a, b] = sols as [Solution, Solution];
  const c = compareSquads(a.squad, b.squad, rules, S.squad);
  return `<h3>Compare ${evidenceBadge(c.evidence)}</h3>
    <table class="cmp"><tr><th></th><th>${esc(`Option ${S.opt!.solutions.indexOf(a) + 1}`)}</th><th>${esc(`Option ${S.opt!.solutions.indexOf(b) + 1}`)}</th></tr>
    <tr><td>Chemistry</td><td><b>${c.a.total}</b>/${c.max}</td><td><b>${c.b.total}</b>/${c.max}</td></tr>
    <tr><td>Coins</td><td>${coins(c.a.cost ?? 0)}</td><td>${coins(c.b.cost ?? 0)}</td></tr>
    <tr><td>Fit (est.)</td><td>${c.a.fit ?? "–"}</td><td>${c.b.fit ?? "–"}</td></tr>
    <tr><td>Manager</td><td>${esc(c.a.manager ?? "–")}</td><td>${esc(c.b.manager ?? "–")}</td></tr>
    ${c.rows.map((r) => `<tr class="${r.same_player ? "" : "diff"}"><td>${esc(r.slot)}</td><td>${esc(r.a.name ?? "–")} (${r.a.chemistry})</td><td>${esc(r.b.name ?? "–")} (${r.b.chemistry})</td></tr>`).join("")}
    </table>
    <ul class="levers small">${c.verdict.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>
    <div class="row"><button class="primary" data-act="apply" data-id="${esc(a.id)}">Save option ${S.opt!.solutions.indexOf(a) + 1}</button><button class="primary" data-act="apply" data-id="${esc(b.id)}">Save option ${S.opt!.solutions.indexOf(b) + 1}</button><button data-act="mode" data-mode="optimize">Back</button></div>`;
}

function renderAnalyze() {
  const d = diagnoseSquad(S.squad, rules);
  return `<h3>Squad analysis ${evidenceBadge(d.evidence)}</h3>
    <p>${d.total}/${d.max} chemistry. ${d.below_max.length ? `${d.below_max.length} player${d.below_max.length === 1 ? " is" : "s are"} below max:` : "Everyone is at full chemistry."}</p>
    <div class="list">${d.below_max.map((x) => `<div class="item" data-act="slot" data-slot="${esc(x.slot)}"><div class="row"><b class="grow">${esc(x.name)}</b>${pips(x.chemistry)}</div><div class="small muted">${esc(x.summary)}</div></div>`).join("")}</div>
    ${d.warnings.length ? `<h4>Notes</h4><ul class="levers small">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`;
}

function renderSquads() {
  return `<h3>My squads</h3>
    <div class="list">${S.squads.length ? S.squads.map((q) => `<div class="item" data-act="open" data-id="${esc(q.id)}"><div class="row"><b class="grow">${esc(q.name)}</b><span>${evaluateSquad(q, rules).chemistry.total}/33</span><button class="ghost" data-act="del" data-id="${esc(q.id)}">Delete</button></div><div class="small muted">${esc(q.formation)} · ${q.parent_id ? "saved from another squad · " : ""}${esc(q.updated_at.slice(0, 16).replace("T", " "))}</div></div>`).join("") : `<p class="muted">Nothing saved yet.</p>`}</div>
    <div class="row" style="margin-top:10px"><button data-act="new">New empty 3-5-2</button><button data-act="demo">Load demo squad</button></div>
    <h4>Import</h4>
    <p class="small muted">Paste a saved squad, or your filled-in <code>data/manual/seed-352.json</code>.</p>
    <textarea id="importText" rows="5" placeholder="{ ... }"></textarea>
    <button data-act="import" style="margin-top:6px">Import</button>`;
}

function renderAdd() {
  return `<h3>Add a card or manager</h3>
    <p class="small muted">Cards you add stay in this browser. Mark it "in my club" if you own it; otherwise give a price so the optimizer can cost it.</p>
    <form id="addForm" class="grid2">
      <label>Type<select name="kind"><option value="card">Player card</option><option value="manager">Manager</option></select></label>
      <label>Name<input name="name" required/></label>
      <label>Club<input name="club"/></label>
      <label>League<input name="league"/></label>
      <label>Nation<input name="nation"/></label>
      <label>Positions<input name="positions" placeholder="ST, CAM"/></label>
      <label>Rating<input name="rating" inputmode="numeric"/></label>
      <label>Price<input name="price" inputmode="numeric"/></label>
      <label class="check"><input type="checkbox" name="owned"/> In my club</label>
      <label class="check"><input type="checkbox" name="is_icon"/> Icon</label>
      <label>PAC / SHO / PAS<input name="s1" placeholder="90 85 80"/></label>
      <label>DRI / DEF / PHY<input name="s2" placeholder="88 40 75"/></label>
      <button class="primary" type="submit" style="grid-column:1/-1">Add</button>
    </form>`;
}

function renderPanel() {
  const m = S.mode ?? (isDesktop() ? "slot" : null);
  if (!m) return "";
  const body = { slot: renderSlotPanel, search: renderSearch, optimize: renderOptimize, compare: renderCompare, squads: renderSquads, analyze: renderAnalyze, add: renderAdd }[m]();
  return `<aside class="panel sheet"><button class="close ghost" data-act="close" aria-label="Close">✕</button>${body}</aside>`;
}

function render() {
  const focus = document.activeElement as HTMLInputElement | null;
  const key = focus?.dataset?.input;
  const pos = focus?.selectionStart ?? null;
  app.innerHTML = `${renderHeader()}<main class="layout"><div class="left panel">${renderSearch()}</div>${renderPitch()}${renderPanel()}</main>${S.toast ? `<div class="toast">${esc(S.toast)}</div>` : ""}`;
  if (key) {
    const el = app.querySelector<HTMLInputElement>(`[data-input="${key}"]`);
    if (el) {
      el.focus();
      if (pos !== null && "setSelectionRange" in el) try { el.setSelectionRange(pos, pos); } catch { /* not a text input */ }
    }
  }
}

async function refreshSquads() {
  S.squads = await store.list(OWNER);
}

async function saveCurrent() {
  await store.save({ ...S.squad, updated_at: new Date().toISOString() });
  S.saved = true;
  prefs.save({ ...prefs.load(), lastSquad: S.squad.id, profiles: S.profiles });
  await refreshSquads();
  flash("Saved");
}

async function applySolution(id: string) {
  const sol = S.opt?.solutions.find((s) => s.id === id) ?? (S.preview?.id === id ? S.preview : null);
  if (!sol) return;
  if (!(await store.get(OWNER, S.squad.id))) await store.save(S.squad); // keep the original too
  const saved = await saveSquadAs(store, sol.squad, sol.squad.name);
  S.squad = saved;
  S.saved = true;
  S.preview = null;
  S.opt = null;
  S.picked = [];
  S.mode = "slot";
  prefs.save({ ...prefs.load(), lastSquad: saved.id, profiles: S.profiles });
  await refreshSquads();
  flash(`Saved as "${saved.name}". Your original squad is unchanged.`);
}

app.addEventListener("click", async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el) return;
  const act = el.dataset.act!;
  const id = el.dataset.id ?? "";
  if (act === "del") e.stopPropagation();
  switch (act) {
    case "slot":
      S.sel = el.dataset.slot!;
      S.mode = "slot";
      return render();
    case "mode":
      S.mode = el.dataset.mode as Mode;
      if (S.mode === "squads") await refreshSquads();
      return render();
    case "close":
      S.mode = null;
      return render();
    case "lock":
      return update(() => S.sel && edit(setLocked(S.squad, S.sel, !getSlot(S.squad, S.sel).locked)));
    case "remove":
      return update(() => S.sel && edit(assignCard(S.squad, S.sel, null)));
    case "assign": {
      if (!S.sel) return flash("Pick a slot on the pitch first");
      if (getSlot(S.squad, S.sel).locked) return flash("That slot is locked. Unlock it to change the player.");
      const c = allCards().find((x) => x.id === id);
      return update(() => {
        edit(assignCard(S.squad, S.sel!, c ?? null));
        S.mode = "slot";
      });
    }
    case "fix":
      S.optSlot = el.dataset.slot!;
      S.mode = "optimize";
      S.optForm.budget = S.squad.budget;
      return update(runOptimizer);
    case "run":
      return update(runOptimizer);
    case "preview":
      S.preview = S.opt?.solutions.find((s) => s.id === id) ?? null;
      S.mode = isDesktop() ? "optimize" : null;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return render();
    case "endpreview":
      S.preview = null;
      S.mode = "optimize";
      return render();
    case "pick":
      S.picked = S.picked.includes(id) ? S.picked.filter((x) => x !== id) : [...S.picked, id].slice(-2);
      return render();
    case "apply":
      return applySolution(id).then(render);
    case "save":
      return saveCurrent().then(render);
    case "saveas": {
      const name = prompt("Name for the new squad", `${S.squad.name} (copy)`);
      if (!name) return;
      const saved = await saveSquadAs(store, S.squad, name);
      S.squad = saved;
      S.saved = true;
      await refreshSquads();
      return flash(`Saved as "${name}"`);
    }
    case "open": {
      const q = await store.get(OWNER, id);
      if (q) {
        S.squad = q;
        S.saved = true;
        S.opt = null;
        S.preview = null;
        S.sel = null;
        S.mode = isDesktop() ? "slot" : null;
        prefs.save({ ...prefs.load(), lastSquad: q.id });
      }
      return render();
    }
    case "del":
      if (!confirm("Delete this saved squad?")) return;
      await store.delete(OWNER, id);
      await refreshSquads();
      return render();
    case "new":
      edit(createSquad({ formation: "3-5-2", owner_id: OWNER, budget: 200_000 }));
      S.sel = null;
      return render();
    case "demo":
      edit(demoSquad(OWNER));
      return render();
    case "import": {
      const t = (document.getElementById("importText") as HTMLTextAreaElement).value;
      return update(() => {
        edit(importSquad(t, OWNER));
        S.mode = "analyze";
      });
    }
  }
});

function runOptimizer() {
  S.preview = null;
  S.picked = [];
  S.opt = optimizeSquad(
    S.squad,
    S.optSlot ? { slot: S.optSlot } : { total_target: rules.modifiers["player.max_chemistry"]! * 11 },
    { cards: allCards(), managers: S.managers },
    rules,
    { budget: S.optForm.budget, max_swaps: S.optForm.maxSwaps, allow_manager_change: S.optForm.mgr, allow_net_loss: S.optForm.netLoss },
  );
}

app.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.input;
  if (!k) return;
  const val = el.type === "checkbox" ? el.checked : el.value;
  update(() => {
    if (k === "formation") edit(setFormation(S.squad, String(val)));
    else if (k === "manager") edit(setManager(S.squad, S.managers.find((m) => m.id === val) ?? null));
    else if (k === "profile" && S.sel) {
      S.profiles[`${S.squad.id}:${S.sel}`] = String(val);
      prefs.save({ ...prefs.load(), profiles: S.profiles });
    } else if (k === "moveto" && S.sel && val) edit(swapSlots(S.squad, S.sel, String(val)));
    else if (k === "s.position") S.search.position = String(val);
    else if (k === "s.owned") S.search.owned = !!val;
    else if (k === "o.slot") S.optSlot = String(val) || null;
    else if (k === "o.budget") S.optForm.budget = Math.max(0, Number(val) || 0);
    else if (k === "o.maxSwaps") S.optForm.maxSwaps = Number(val);
    else if (k === "o.mgr") S.optForm.mgr = !!val;
    else if (k === "o.netLoss") S.optForm.netLoss = !!val;
  });
});

app.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.input;
  if (k === "name") {
    S.squad = { ...S.squad, name: el.value };
    S.saved = false;
  } else if (k === "s.text") {
    S.search.text = el.value;
    render();
  } else if (k === "s.maxPrice") {
    S.search.maxPrice = el.value.replace(/\D/g, "");
    render();
  }
});

app.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target as HTMLFormElement);
  const g = (k: string) => String(f.get(k) ?? "").trim();
  const num = (k: string) => (g(k) ? Number(g(k).replace(/\D/g, "")) : undefined);
  const name = g("name");
  if (!name) return flash("Name is required");
  const id = `user-${Date.now()}`;
  if (g("kind") === "manager") {
    const m: Manager = { id, name, nation: g("nation") || null, league: g("league") || null, price: num("price") ?? null, owned: f.get("owned") === "on", source: "user" };
    S.managers = [...S.managers, m];
    userManagers.save(S.managers.filter((x) => x.source === "user"));
  } else {
    const [pac, sho, pas] = g("s1").split(/[\s,/]+/).map(Number);
    const [dri, def, phy] = g("s2").split(/[\s,/]+/).map(Number);
    const stats = Object.fromEntries(Object.entries({ pac, sho, pas, dri, def, phy }).filter(([, v]) => Number.isFinite(v) && v! > 0));
    const c: WorkspaceCard = {
      id,
      name,
      club: g("club") || null,
      league: g("league") || null,
      nation: g("nation") || null,
      positions: g("positions").toUpperCase().split(/[\s,/]+/).filter(Boolean),
      rating: num("rating"),
      price: num("price") ?? null,
      owned: f.get("owned") === "on",
      is_icon: f.get("is_icon") === "on",
      stats: Object.keys(stats).length ? stats : undefined,
      source: "user",
    };
    S.cards = [...S.cards, c];
    userCards.save(S.cards.filter((x) => x.source === "user"));
  }
  flash(`Added ${name}`);
});

(async () => {
  await refreshSquads();
  const last = p0.lastSquad ? await store.get(OWNER, p0.lastSquad) : null;
  if (last) {
    S.squad = last;
    S.saved = true;
  }
  render();
  window.matchMedia("(min-width: 1000px)").addEventListener("change", render);
})();
