// XI Lab · Market Lab. Every number comes from src/market (the same service the API and MCP tools call);
// this file only draws them. Demo data is labelled DEMO everywhere it appears.
import { demoSquad } from "../src/workspace/demo.js";
import {
  PRICE_CSV_HEADER,
  roundToStep,
  WINDOWS,
  createMarketService,
  type Platform,
  type SignalStatus,
} from "../src/market/index.js";
import { demoMarketCards, demoMemberships, demoPriceHistory } from "../src/market/demo.js";
import type { Squad } from "../src/workspace/index.js";
import { BrowserCardSource, LocalCaptureHoldStore, LocalMembershipStore, LocalPriceStore, LocalWatchlistStore, marketPrefs, savedSquads, userMarketCards } from "./market-storage.js";

const OWNER = "local";
const app = document.getElementById("app")!;
const prefs = marketPrefs.load();
const P = { demo: prefs.demo ?? true, platform: (prefs.platform ?? "console") as Platform };

function build() {
  const anchor = new Date().toISOString();
  const demo = P.demo;
  const prices = new LocalPriceStore(OWNER, demo ? demoPriceHistory(anchor) : []);
  const holds = new LocalCaptureHoldStore(OWNER);
  return {
    prices,
    holds,
    svc: createMarketService({
      prices,
      memberships: new LocalMembershipStore(!demo, demo ? demoMemberships(anchor) : []),
      watchlists: new LocalWatchlistStore(OWNER),
      cards: new BrowserCardSource([...(demo ? demoMarketCards() : []), ...userMarketCards()]),
      holds,
    }),
  };
}
let { svc, prices, holds } = build();

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const coins = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US"));
const pct = (n: number | null | undefined, unit = "%") => (n === null || n === undefined || Number.isNaN(n) ? "–" : `${n > 0 ? "+" : ""}${Math.round(n * 100) / 100}${unit}`);
const cls = (n: number | null | undefined) => (n === null || n === undefined ? "" : n > 0 ? "up" : n < 0 ? "down" : "");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");

const STATUS: Record<SignalStatus, { label: string; c: string }> = {
  favorable_setup: { label: "Favourable setup", c: "s-good" },
  research_further: { label: "Research further", c: "s-info" },
  watch: { label: "Watch", c: "s-muted" },
  overheated: { label: "Overheated", c: "s-warn" },
  elevated_risk: { label: "Elevated risk", c: "s-bad" },
  insufficient_evidence: { label: "Insufficient evidence", c: "s-muted" },
};
const statusBadge = (s: SignalStatus) => `<span class="badge ${STATUS[s].c}">${STATUS[s].label}</span>`;
const words = (s: string) => s.replace(/_/g, " ");
const demoBanner = (demo: boolean) =>
  demo ? `<div class="banner demo"><b>DEMO DATA.</b> These cards and prices are made up so you can try Market Lab. They are not FC 27 market prices. Import your own history under <a href="#import">Import</a>, or switch the demo off.</div>` : "";

/** Single-series line chart: 2px line, recessive grid, crosshair + tooltip on hover. */
function lineChart(points: { t: string; v: number }[], opts: { h?: number; fmt?: (v: number) => string; base?: number } = {}) {
  if (points.length < 2) return `<div class="chart empty muted small">Not enough points to draw.</div>`;
  const W = 640;
  const H = opts.h ?? 200;
  const pad = { l: 52, r: 10, t: 10, b: 22 };
  const xs = points.map((p) => Date.parse(p.t));
  const vs = points.map((p) => p.v);
  let lo = Math.min(...vs, opts.base ?? Infinity);
  let hi = Math.max(...vs, opts.base ?? -Infinity);
  if (hi === lo) (hi += 1), (lo -= 1);
  const x = (t: number) => pad.l + ((t - xs[0]!) / (xs.at(-1)! - xs[0]! || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const fmt = opts.fmt ?? ((v: number) => coins(Math.round(v)));
  const ticks = [lo, (lo + hi) / 2, hi];
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(xs[i]!).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const data = esc(JSON.stringify(points.map((p, i) => [x(xs[i]!), y(p.v), p.t, fmt(p.v)])));
  return `<div class="chart" data-points="${data}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
      ${ticks.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`).join("")}
      ${opts.base !== undefined ? `<line class="base" x1="${pad.l}" x2="${W - pad.r}" y1="${y(opts.base)}" y2="${y(opts.base)}"/>` : ""}
      <text class="axis" x="${pad.l}" y="${H - 6}">${esc(when(points[0]!.t))}</text>
      <text class="axis" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${esc(when(points.at(-1)!.t))}</text>
      <path class="line" d="${d}"/>
      <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" style="display:none"/>
      <circle class="dot" r="4" style="display:none"/>
      <rect class="hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}"/>
    </svg>
    <div class="tip" style="display:none"></div>
  </div>`;
}

function spark(points: { t: string; value: number }[]) {
  if (points.length < 2) return "";
  const vs = points.map((p) => p.value);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs) || 1;
  const d = vs.map((v, i) => `${i ? "L" : "M"}${((i / (vs.length - 1)) * 100).toFixed(1)},${(hi === lo ? 10 : 20 - ((v - lo) / (hi - lo)) * 20).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ---------------------------------------------------------------- views

async function overview() {
  const o = await svc.getMarketOverview(OWNER, { platform: P.platform });
  const rows = o.indexes
    .map(
      (i) => `<tr>
      <td><b>${esc(i.label)}</b><div class="small muted">${esc(i.description)}</div></td>
      <td>${i.value ?? "–"}</td>
      ${WINDOWS.map((w) => `<td class="delta ${cls(i.changes[w])}">${pct(i.changes[w])}</td>`).join("")}
      <td>${i.volatility_24h === null ? "–" : `${i.volatility_24h}%`}</td>
      <td>${words(i.trend)}</td>
      <td>${i.constituents_now}</td>
      <td class="small">${i.distribution ? `${coins(i.distribution.p25)}–${coins(i.distribution.p75)}` : "–"}</td>
      <td class="sparkcell">${spark(o.index_history[i.basket_id] ?? [])}</td>
    </tr>`,
    )
    .join("");
  const mover = (m: (typeof o.relative_strength_leaders)[number]) => `<a class="item" href="#card/${encodeURIComponent(m.card_id)}"><div class="row"><b class="grow">${esc(m.name)}</b><span>${m.rating}</span></div><div class="small"><span class="delta ${cls(m.change_24h)}">${pct(m.change_24h)} 24h</span> · <span class="delta ${cls(m.vs_market_pp)}">${pct(m.vs_market_pp, "pp")} vs market</span></div></a>`;
  const r = o.regime;
  return `${demoBanner(o.provenance.demo)}
  <section class="panel">
    <h3>Market regime: ${esc(words(r.primary))} ${r.flags.map((f) => `<span class="badge s-warn">${esc(words(f.regime))}</span>`).join(" ")}</h3>
    <ul class="levers">${r.observations.map((x) => `<li>${esc(x)}</li>`).join("")}${r.flags.map((f) => `<li>${esc(f.because)}</li>`).join("")}</ul>
    <h4>What that means for Stage A signals</h4><ul class="levers">${r.strategy_notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="small muted">${r.not_evaluable.map((x) => `${esc(words(x.regime))}: ${esc(x.reason)}`).join(" ")} Rules ${esc(r.rules_version)}.</p>
  </section>
  <section class="panel">
    <h3>Market pulse · ${P.platform === "pc" ? "PC" : "Console"} <span class="badge b-est">estimate</span></h3>
    <div class="tablewrap"><table class="cmp mk">
      <thead><tr><th>Index (base 100)</th><th>Now</th>${WINDOWS.map((w) => `<th>${w}</th>`).join("")}<th>Vol/h</th><th>Trend</th><th>Cards</th><th>Middle 50%</th><th>7d</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <ul class="small muted">${o.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
  </section>
  <div class="grid2 wide">
    <section class="panel"><h3>Unusual relative strength</h3><div class="list">${o.relative_strength_leaders.map(mover).join("") || `<p class="muted">None beyond the threshold.</p>`}</div></section>
    <section class="panel"><h3>Unusually large declines</h3><div class="list">${o.largest_declines.map(mover).join("") || `<p class="muted">None beyond the threshold.</p>`}</div></section>
  </div>
  <section class="panel"><h3>Upcoming market events</h3><p class="muted">${esc(o.upcoming_events.note)}</p></section>
  <section class="panel small">Price coverage: ${o.coverage.fresh} fresh, ${o.coverage.stale} stale, ${o.coverage.missing} with no prices, of ${o.coverage.cards} cards. As of ${esc(when(o.provenance.as_of))}.</section>`;
}

const scan = { status: "" as "" | SignalStatus, max: "", category: "" };
async function scanner() {
  const r = await svc.findMarketOpportunities(OWNER, {
    platform: P.platform,
    status: scan.status ? [scan.status] : undefined,
    max_price: scan.max ? Number(scan.max) : undefined,
    category: (scan.category || undefined) as never,
    limit: 100,
  });
  const items = r.items
    .map(
      (i) => `<a class="item" href="#card/${encodeURIComponent(i.card_id)}">
      <div class="row"><b class="grow">${esc(i.name)}</b><span>${i.rating}</span>${statusBadge(i.status)}</div>
      <div class="small">${coins(i.latest_price)} coins · <span class="delta ${cls(i.change_24h)}">${pct(i.change_24h)} 24h</span> · <span class="delta ${cls(i.change_72h)}">${pct(i.change_72h)} 72h</span> · ${pct(i.vs_market_24h_pp, "pp")} vs market · ${esc(i.category)} ${i.categories.map((c) => `<span class="badge b-est">${esc(words(c))}</span>`).join(" ")}</div>
      <div class="small muted">${esc(i.reasons[0] ?? "")} · price seen ${esc(when(i.latest_observed_at))} (${esc(i.freshness)})</div>
    </a>`,
    )
    .join("");
  return `${demoBanner(r.provenance.demo)}
  <section class="panel">
    <h3>Opportunity radar <span class="badge b-est">estimate</span></h3>
    <p class="small muted">Relative strength, momentum and mean reversion from price history only. A favourable setup is not a guaranteed profitable trade. Regime: ${esc(words(r.regime))}.</p>
    <div class="grid2">
      <label>Status<select data-input="scan.status"><option value="">Any</option>${(Object.keys(STATUS) as SignalStatus[]).map((s) => `<option value="${s}" ${scan.status === s ? "selected" : ""}>${STATUS[s].label}</option>`).join("")}</select></label>
      <label>Max price<input data-input="scan.max" inputmode="numeric" value="${esc(scan.max)}"/></label>
      <label>Category<select data-input="scan.category"><option value="">Any</option>${["base", "promo", "icon", "hero", "evolution", "live"].map((c) => `<option ${scan.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    </div>
    <div class="list" style="margin-top:10px">${items || `<p class="muted">No cards with prices match.</p>`}</div>
    <p class="small muted">${r.total} cards scanned.</p>
  </section>`;
}

const thesisForm: Record<string, string> = {};
let thesisOut = "";
let squadOut = "";
async function cardPage(id: string) {
  const ci = await svc.getCardMarketIntelligence(OWNER, id, { platform: P.platform });
  const c = ci.card;
  const a = ci.assessment;
  const rs = ci.relative_strength
    .map((r) => `<tr><td>${esc(r.label)}<div class="small muted">${r.peers} ${r.benchmark === "market" ? "index cards" : "peers"}</div></td>${r.cells.map((x) => `<td class="delta ${cls(x.diff_pp)}" title="card ${pct(x.card)} vs ${pct(x.benchmark)}">${pct(x.diff_pp, "pp")}<div class="small muted">${x.verdict === "insufficient_data" ? "no data" : words(x.verdict)}</div></td>`).join("")}</tr>`)
    .join("");
  const m = ci.momentum;
  const mr = ci.mean_reversion;
  const latest = ci.price.latest;
  const f = (k: string, d: number | null) => thesisForm[`${id}:${k}`] ?? (d === null ? "" : String(d));
  const squads: Squad[] = [...savedSquads(), demoSquad(OWNER)];
  return `${demoBanner(ci.provenance.demo)}
  <section class="panel">
    <div class="small muted">${esc(c.positions.join("/"))} · ${esc(c.club ?? "?")} · ${esc(c.league ?? "?")} · ${esc(c.nation ?? "?")} · ${esc(c.category)}${c.version ? ` · ${esc(c.version)}` : ""} · ${P.platform === "pc" ? "PC" : "Console"}</div>
    <div class="row"><h3 class="grow" style="font-size:22px;margin:4px 0">${esc(c.name)} <span class="muted">${c.rating}</span></h3>${statusBadge(a.status)}</div>
    <div class="stats">
      <div class="stat"><div class="k">Latest observed price</div><div class="v">${coins(latest)}</div></div>
      <div class="stat"><div class="k">Observed</div><div class="v small">${esc(when(ci.price.freshness.latest_observed_at))}</div><div class="k">${esc(ci.price.freshness.status)}</div></div>
      <div class="stat"><div class="k">24h</div><div class="v delta ${cls(m.changes["24h"])}">${pct(m.changes["24h"])}</div></div>
      <div class="stat"><div class="k">7d</div><div class="v delta ${cls(m.changes["7d"])}">${pct(m.changes["7d"])}</div></div>
    </div>
    ${ci.price.freshness.status !== "fresh" ? `<p class="warn small">${esc(ci.price.freshness.message)}</p>` : ""}
    <div class="row" style="margin-top:8px">
      <button data-act="${ci.watch ? "unwatch" : "watch"}" data-id="${esc(id)}">${ci.watch ? "★ Watching" : "☆ Add to watchlist"}</button>
      <a class="btn" href="./index.html">Open Squad Builder</a>
    </div>
  </section>
  <section class="panel"><h3>Price history · 7 days</h3>${lineChart(ci.price.history.map((p) => ({ t: p.t, v: p.price })))}
    <p class="small muted">Sources: ${ci.price.sources.map(esc).join(", ") || "none"}. Lowest listed price as reported; no sales volume or listing depth is available.</p></section>
  <section class="panel">
    <h3>Signal: ${statusBadge(a.status)} <span class="badge b-est">estimate</span></h3>
    <ul class="levers">${a.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <p class="small"><b>Entry risk:</b> ${esc(a.entry_risk.note)}</p>
    <h4>Why this could be wrong</h4><ul class="levers small">${a.could_be_wrong.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
  </section>
  <section class="panel"><h3>Relative strength <span class="badge b-est">estimate</span></h3>
    <p class="small muted">Card change minus benchmark change, in percentage points. Peer benchmarks use the median peer.</p>
    <div class="tablewrap"><table class="cmp mk"><thead><tr><th>Benchmark</th>${WINDOWS.map((w) => `<th>${w}</th>`).join("")}</tr></thead><tbody>${rs}</tbody></table></div></section>
  <div class="grid2 wide">
    <section class="panel"><h3>Momentum</h3><table class="cmp">
      <tr><td>6h / 24h average</td><td>${coins(m.sma_6h)} / ${coins(m.sma_24h)} ${m.short_above_long === null ? "" : m.short_above_long ? "(short above long)" : "(short below long)"}</td></tr>
      <tr><td>Range</td><td>${esc(words(m.breakout ?? "not enough data"))}</td></tr>
      <tr><td>Structure</td><td>${esc(words(m.structure ?? "not enough data"))}</td></tr>
      <tr><td>Acceleration</td><td>${esc(m.acceleration ?? "–")}</td></tr>
      <tr><td>Volatility (hourly)</td><td>${m.volatility_24h === null ? "–" : `${m.volatility_24h}%`}</td></tr>
      <tr><td>Volatility-adjusted 24h</td><td>${m.vol_adjusted_24h ?? "–"}</td></tr>
      <tr><td>Max drawdown 7d</td><td>${pct(m.max_drawdown_7d)}</td></tr></table></section>
    <section class="panel"><h3>Mean reversion <span class="badge b-hyp">hypothesis</span></h3><table class="cmp">
      <tr><td>vs own 7d average</td><td>${mr.z_7d === null ? "–" : `${mr.z_7d} sd`}</td></tr>
      <tr><td>7d range</td><td>${coins(mr.low_7d)} – ${coins(mr.high_7d)}${mr.range_position_7d === null ? "" : ` (at ${Math.round(mr.range_position_7d * 100)}%)`}</td></tr>
      <tr><td>vs peers (same rating & position)</td><td>${mr.peer_price_ratio === null ? "–" : `${Math.round(mr.peer_price_ratio * 100)}% of median (${mr.peer_count})`}</td></tr>
      <tr><td>Pattern</td><td>${esc(words(mr.pattern ?? "not enough data"))}</td></tr></table>
      <p class="small muted">A low price is not a bargain by itself: a persistent decline is treated as risk.</p></section>
  </div>
  <section class="panel"><h3>Card utility <span class="badge b-est">estimate</span></h3>
    <div class="row">${ci.utility.gameplay.by_position.map((p) => `<div class="stat"><div class="k">${esc(p.position)} · ${esc(p.profile)}</div><div class="v">${p.score ?? "–"}</div></div>`).join("")}</div>
    <p class="small muted">${esc(ci.utility.gameplay.basis)} Not yet modelled: ${ci.utility.unavailable.map((u) => esc(u.model)).join(", ")}.</p></section>
  <section class="panel"><h3>Comparable cards</h3><div class="tablewrap"><table class="cmp"><thead><tr><th>Card</th><th>OVR</th><th>Best fit</th><th>Price</th><th>24h</th><th>vs this</th></tr></thead><tbody>
    ${ci.comparables.map((x) => `<tr><td><a href="#card/${encodeURIComponent(x.card_id)}">${esc(x.name)}</a></td><td>${x.rating}</td><td>${x.best_fit?.score ?? "–"} ${esc(x.best_fit?.position ?? "")}</td><td>${coins(x.latest_price)}</td><td class="delta ${cls(x.change_24h)}">${pct(x.change_24h)}</td><td>${x.price_vs_subject === null ? "–" : `${Math.round(x.price_vs_subject * 100)}%`}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No comparable cards with the same primary position and rating ±2.</td></tr>`}
  </tbody></table></div></section>
  <section class="panel"><h3>Trade thesis simulator</h3>
    <form data-form="thesis" data-id="${esc(id)}" class="grid2">
      <label>Quantity<input name="quantity" inputmode="numeric" value="${esc(f("quantity", 1))}"/></label>
      <label>Buy price<input name="buy_price" inputmode="numeric" value="${esc(f("buy_price", latest))}"/></label>
      <label>Target sale price<input name="target_price" inputmode="numeric" value="${esc(f("target_price", latest ? roundToStep(latest * 1.15) : null))}"/></label>
      <label>Downside exit price<input name="downside_price" inputmode="numeric" value="${esc(f("downside_price", latest ? roundToStep(latest * 0.9) : null))}"/></label>
      <label>Coin balance<input name="coin_balance" inputmode="numeric" value="${esc(f("coin_balance", null))}"/></label>
      <label>Copies already held<input name="held" inputmode="numeric" value="${esc(f("held", 0))}"/></label>
      <label>Their cost basis (total)<input name="basis" inputmode="numeric" value="${esc(f("basis", 0))}"/></label>
      <label>Your chance of hitting target (optional, 0-100)<input name="prob" inputmode="numeric" value="${esc(f("prob", null))}"/></label>
      <div><button class="primary" type="submit">Analyse trade</button></div>
    </form>
    <div id="thesis">${thesisOut}</div></section>
  <section class="panel"><h3>Compare in My Squad</h3>
    <form data-form="squad" data-id="${esc(id)}" class="row"><select name="squad" style="width:auto">${squads.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select><button type="submit">Compare</button></form>
    <div id="sq">${squadOut}</div></section>
  <section class="panel small muted">Catalysts: ${esc(ci.catalysts.note)} Community: ${esc(ci.community.note)}</section>`;
}

async function thesis(id: string, form: FormData) {
  const n = (k: string) => {
    const v = String(form.get(k) ?? "").replace(/[, ]/g, "");
    thesisForm[`${id}:${k}`] = v;
    return v === "" ? null : Number(v);
  };
  const r = await svc.analyzeTradeThesis(OWNER, {
    card_id: id,
    platform: P.platform,
    quantity: n("quantity") ?? 1,
    buy_price: n("buy_price") ?? 0,
    target_price: n("target_price") ?? 0,
    downside_price: n("downside_price") ?? 0,
    coin_balance: n("coin_balance"),
    existing: { quantity: n("held") ?? 0, cost_basis: n("basis") ?? 0 },
    assumed_target_probability: n("prob") === null ? null : Math.min(100, Math.max(0, n("prob")!)) / 100,
  });
  thesisOut = `<table class="cmp">
    <tr><td>Total investment</td><td><b>${coins(r.investment)}</b></td></tr>
    <tr><td>EA tax at target / downside (each)</td><td>${coins(r.tax_at_target)} / ${coins(r.tax_at_downside)}</td></tr>
    <tr><td>Break-even listing price</td><td><b>${coins(r.break_even_price)}</b></td></tr>
    <tr><td>Profit at target</td><td class="delta ${cls(r.profit_at_target)}"><b>${coins(r.profit_at_target)}</b> (${pct(r.return_at_target_pct)})</td></tr>
    <tr><td>Result at downside</td><td class="delta ${cls(r.loss_at_downside)}">${coins(r.loss_at_downside)} (${pct(r.return_at_downside_pct)})</td></tr>
    <tr><td>Risk / reward</td><td>${r.risk_reward ?? "–"}</td></tr>
    <tr><td>Win rate needed to break even</td><td>${r.break_even_win_rate === null ? "–" : `${Math.round(r.break_even_win_rate * 1000) / 10}%`}</td></tr>
    ${r.user_scenario_ev ? `<tr><td>Expected result at your ${Math.round(r.user_scenario_ev.probability * 100)}%</td><td>${coins(r.user_scenario_ev.expected_profit)} <span class="small muted">${esc(r.user_scenario_ev.label)}</span></td></tr>` : ""}
    <tr><td>Share of your coins</td><td>${r.exposure.of_coins_pct === null ? "enter a coin balance" : `${r.exposure.of_coins_pct}%`}</td></tr>
    <tr><td>Position after</td><td>${r.exposure.position_after.quantity} copies, cost basis ${coins(r.exposure.position_after.cost_basis)}</td></tr>
  </table>
  ${r.warnings.length ? `<ul class="levers warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
  <ul class="levers small muted">${r.limitations.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
}

async function compareSquad(id: string, squadId: string) {
  const sq = [...savedSquads(), demoSquad(OWNER)].find((s) => s.id === squadId);
  if (!sq) return;
  const r = await svc.compareInMySquad(OWNER, id, sq, { platform: P.platform });
  squadOut = `<p><b>${esc(r.summary)}</b></p>
  ${r.options.length ? `<table class="cmp"><thead><tr><th>Slot</th><th>Replaces</th><th>Team chem</th><th>Fit</th></tr></thead><tbody>${r.options.map((o) => `<tr><td>${esc(o.slot)}</td><td>${esc(o.replaces ?? "empty")}</td><td class="delta ${cls(o.chemistry_delta)}">${o.chemistry_before} → ${o.chemistry_after}</td><td class="delta ${cls(o.fit_delta)}">${o.fit_before ?? "–"} → ${o.fit_after ?? "–"}</td></tr>`).join("")}</tbody></table>` : ""}
  ${r.skipped_locked.length ? `<p class="small muted">Locked, not considered: ${r.skipped_locked.map((x) => `${esc(x.slot)} (${esc(x.player ?? "empty")})`).join(", ")}.</p>` : ""}
  <p class="small muted">Cost: ${r.owned ? "owned" : r.cost === null ? "no current price" : `${coins(r.cost)} coins`}. Chemistry from rule version ${esc(r.rule_version)} (${esc(r.evidence.chemistry)}); fit is an estimate.</p>`;
}

async function watchlist() {
  const w = await svc.getWatchlist(OWNER);
  return `<section class="panel"><h3>Watchlist</h3>
    <div class="list">${w.items.map((i) => `<div class="item"><div class="row"><a class="grow" href="#card/${encodeURIComponent(i.card_id)}"><b>${esc(i.name)}</b></a><span>${i.platform}</span>${statusBadge(i.status)}<button data-act="unwatch" data-id="${esc(i.card_id)}" data-platform="${i.platform}">Remove</button></div>
      <div class="small">${coins(i.latest_price)} now (${esc(i.freshness)}) · ${coins(i.price_at_add)} when added ${esc(when(i.added_at))} · <span class="delta ${cls(i.since_added_pct)}">${pct(i.since_added_pct)}</span>${i.at_target_buy ? ` · <b>at your buy target</b>` : ""}${i.at_target_sell ? ` · <b>at your sell target</b>` : ""}</div></div>`).join("") || `<p class="muted">Nothing yet. Add cards from their Card Intelligence page.</p>`}</div>
    <p class="small muted">${esc(w.note)}</p></section>`;
}

let importOut = "";
function linkSelect(ea: number, rating: number | null) {
  const options = userMarketCards().filter((c) => rating === null || c.rating === rating);
  if (!options.length) return `<span class="small muted">No card rated ${rating ?? "?"} yet</span>`;
  return `<select data-input="linkheld" data-ea="${ea}" style="width:auto"><option value="">Choose…</option>${options.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${c.rating})</option>`).join("")}</select>`;
}

async function importView() {
  const held = await svc.getHeldCaptures(OWNER);
  const heldPanel = held.items.length
    ? `<section class="panel"><h3>Captured items not in your cards yet</h3>
    <p class="small">${esc(held.note)} ${held.total_observations} price${held.total_observations === 1 ? "" : "s"} across ${held.items.length} item${held.items.length === 1 ? "" : "s"}.</p>
    <div class="tablewrap"><table class="cmp"><thead><tr><th>EA item</th><th>Rating</th><th>Version</th><th>Position</th><th>Latest</th><th>Seen</th><th>Link to a card</th></tr></thead><tbody>
    ${held.items.slice(0, 50).map((i) => `<tr><td><code>${i.ea_item_id}</code></td><td>${i.rating ?? "–"}</td><td>${i.special_version === null ? "unknown" : i.special_version ? "special" : "base"}</td><td>${esc(i.details?.position ?? "–")}</td><td>${coins(i.latest_price)} <span class="small muted">${esc(i.latest_platform)}</span></td><td class="small">${i.observations}× · ${esc(when(i.latest_observed_at))}</td><td>${linkSelect(i.ea_item_id, i.rating)}</td></tr>`).join("")}
    </tbody></table></div><p class="small muted">Labelled game data: lowest Buy Now on results pages you viewed. Add the card in the Squad Builder, then link it here. Only cards with the same rating are offered.</p></section>`
    : "";
  return `<section class="panel"><h3>Import price history</h3>
    <p class="small"><b>From the XI Lab Price Capture extension:</b> download its CSV and import it here. Rows are matched to your cards by EA item id and tagged "Your Web App captures". Items you don't have as cards yet are kept and linked later.</p>
    <p class="small">Or paste CSV or JSON. Header: <code>${PRICE_CSV_HEADER}</code>. <code>card_id</code> must be a card XI Lab already knows (from the squad builder or the card database); <code>platform</code> is console or pc; <code>observed_at</code> is an ISO time. Rows are stored privately in this browser, tagged "Your imported price history".</p>
    <form data-form="import"><textarea name="text" rows="8" placeholder="${PRICE_CSV_HEADER}"></textarea>
      <div class="row" style="margin-top:8px"><input type="file" name="file" accept=".csv,.json,text/csv,application/json" style="width:auto"/><button class="primary" type="submit">Import</button><button type="button" data-act="clearimports">Delete my imported prices</button></div></form>
    <div>${importOut}</div></section>${heldPanel}`;
}

function sourcesView() {
  return `<section class="panel"><h3>Data sources</h3><div class="tablewrap"><table class="cmp"><thead><tr><th>Source</th><th>Status</th><th>Storage</th><th>Analytics</th><th>Training</th><th>Redistribution</th></tr></thead><tbody>
  ${svc.getDataSourceStatus().map((s) => `<tr><td><b>${esc(s.name)}</b>${s.is_demo ? ` <span class="badge b-demo">demo</span>` : ""}<div class="small muted">${esc(s.status_note)}</div></td><td><span class="badge ${s.status === "enabled" ? "s-good" : "s-muted"}">${esc(words(s.status))}</span></td>${(["storage", "derived_analytics", "model_training", "redistribution"] as const).map((k) => `<td>${s.permissions[k] ? "yes" : "no"}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div>
  <p class="small muted">No live price feed is connected: none is authorised. Real prices come only from your own imports and from the XI Lab Price Capture extension, which reads transfer-market results the EA Web App already loaded when you searched. Nothing searches, clicks, bids, buys or sells for you.</p></section>`;
}

// ---------------------------------------------------------------- shell

const route = () => location.hash.replace(/^#/, "") || "overview";
async function render() {
  const r = route();
  let body = "";
  try {
    if (r.startsWith("card/")) body = await cardPage(decodeURIComponent(r.slice(5)));
    else if (r === "scanner") body = await scanner();
    else if (r === "watchlist") body = await watchlist();
    else if (r === "import") body = await importView();
    else if (r === "sources") body = sourcesView();
    else body = await overview();
  } catch (e) {
    body = `<section class="panel"><p class="warn">${esc((e as Error).message)}</p></section>`;
  }
  const tab = (h: string, label: string) => `<a class="btn ${r === h || (h === "overview" && r === "") ? "on" : ""}" href="#${h}">${label}</a>`;
  app.innerHTML = `<header class="top"><div class="brand">XI LAB</div><div class="muted small">Market Lab · research and decision support, not a trading bot</div>
    <div class="row" style="margin-top:6px"><select data-input="platform" style="width:auto"><option value="console" ${P.platform === "console" ? "selected" : ""}>Console</option><option value="pc" ${P.platform === "pc" ? "selected" : ""}>PC</option></select>
    <label class="check"><input type="checkbox" data-input="demo" ${P.demo ? "checked" : ""}/> Show demo data</label></div></header>
  <nav class="toolbar">${tab("overview", "Market overview")}${tab("scanner", "Opportunity radar")}${tab("watchlist", "Watchlist")}${tab("import", "Import prices")}${tab("sources", "Data sources")}<a class="btn" href="./index.html">Squad Builder</a></nav>
  <main class="mlayout">${body}</main>`;
}

app.addEventListener("click", async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el) return;
  const id = el.dataset.id!;
  if (el.dataset.act === "watch") await svc.addToWatchlist(OWNER, { card_id: id, platform: P.platform });
  if (el.dataset.act === "unwatch") await svc.removeFromWatchlist(OWNER, id, (el.dataset.platform as Platform) ?? P.platform);
  if (el.dataset.act === "clearimports") {
    prices.clearImported();
    holds.clear();
    ({ svc, prices, holds } = build());
    importOut = `<p>Imported prices deleted.</p>`;
  }
  render();
});
app.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.input;
  if (k === "linkheld") {
    if (!el.value) return;
    svc.linkHeldCapture(OWNER, Number(el.dataset.ea), el.value).then(
      (r) => ((importOut = `<p>${r.linked} captured price${r.linked === 1 ? "" : "s"} linked.</p>`), render()),
      (err) => ((importOut = `<p class="warn">${esc((err as Error).message)}</p>`), render()),
    );
    return;
  }
  if (k === "platform") P.platform = el.value as Platform;
  else if (k === "demo") {
    P.demo = el.checked;
    ({ svc, prices, holds } = build());
  } else if (k?.startsWith("scan.")) (scan as Record<string, string>)[k.slice(5)] = el.value;
  else return;
  marketPrefs.save(P);
  render();
});
app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const fd = new FormData(form);
  try {
    if (form.dataset.form === "thesis") await thesis(form.dataset.id!, fd);
    if (form.dataset.form === "squad") await compareSquad(form.dataset.id!, String(fd.get("squad")));
    if (form.dataset.form === "import") {
      const file = fd.get("file") as File | null;
      const text = file && file.size ? await file.text() : String(fd.get("text") ?? "");
      const r = await svc.importPriceHistory(OWNER, text);
      importOut = `<p><b>${r.accepted}</b> rows accepted (${r.inserted} new, ${r.skipped} already stored), ${r.duplicates} duplicate rows, ${r.rejected.length} rejected.${r.held ? ` <b>${r.held}</b> captured prices kept for items not in your cards yet.` : ""}${r.linked_from_held ? ` ${r.linked_from_held} earlier captures linked to cards you've added.` : ""}</p>${r.rejected.length ? `<ul class="levers small">${r.rejected.slice(0, 30).map((x) => `<li>Line ${x.line}: ${esc(x.reason)}</li>`).join("")}</ul>` : ""}`;
    }
  } catch (err) {
    const msg = `<p class="warn">${esc((err as Error).message)}</p>`;
    if (form.dataset.form === "thesis") thesisOut = msg;
    else if (form.dataset.form === "squad") squadOut = msg;
    else importOut = msg;
  }
  render();
});
// Chart hover: crosshair + tooltip at the nearest point.
app.addEventListener("pointermove", (e) => {
  const hit = (e.target as Element).closest?.(".chart .hit");
  if (!hit) return;
  const chart = hit.closest<HTMLElement>(".chart")!;
  const pts = JSON.parse(chart.dataset.points!) as [number, number, string, string][];
  const svg = chart.querySelector("svg")!;
  const box = svg.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
  let best = pts[0]!;
  for (const p of pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
  const cross = chart.querySelector<SVGLineElement>(".cross")!;
  const dot = chart.querySelector<SVGCircleElement>(".dot")!;
  const tip = chart.querySelector<HTMLElement>(".tip")!;
  cross.setAttribute("x1", String(best[0]));
  cross.setAttribute("x2", String(best[0]));
  cross.style.display = dot.style.display = tip.style.display = "";
  dot.setAttribute("cx", String(best[0]));
  dot.setAttribute("cy", String(best[1]));
  tip.textContent = `${when(best[2])} · ${best[3]}`;
  tip.style.left = `${(best[0] / svg.viewBox.baseVal.width) * 100}%`;
});
app.addEventListener("pointerleave", () => app.querySelectorAll<HTMLElement>(".chart .cross, .chart .dot, .chart .tip").forEach((x) => (x.style.display = "none")), true);
window.addEventListener("hashchange", () => {
  thesisOut = squadOut = "";
  render();
  window.scrollTo(0, 0);
});
render();
