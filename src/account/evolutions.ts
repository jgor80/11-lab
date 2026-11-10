// Evolutions (Jeff, 2026-11-10): while the user browses Evolutions in the EA Web App, the helper copies the evolutions
// the Web App already loaded: name, end time, cost, who can enter (requirements) and what each level gives (upgrades).
// It never starts, pays for or claims an evolution. GafferBot's Evolutions finder matches them to the user's club.
//
// UNVERIFIED on FC 27: EA calls evolutions "academy" in its addresses (`…/academy/hub`, `…/academy/slot/<id>`), as
// earlier seasons did; the field names inside are not known yet. So this reads any object below the answer that looks
// like an evolution (an id and a name, with requirement-like and level-like lists) and keeps requirement and upgrade
// entries as EA wrote them (type/attribute name, value, scope). The site maps the names it knows and shows the rest.

export interface EvoEntryRaw {
  /** EA's name for the stat or rule, e.g. OVR, PAC, POSITION, PLAYSTYLE (whatever key EA used). */
  type: string;
  values: (number | string)[];
  /** GREATER / LOWER / EXACT when sent. */
  scope: string | null;
}

export interface EvoLevelRaw { upgrades: EvoEntryRaw[] }

export interface EvolutionRaw {
  evo_id: number;
  name: string;
  description: string | null;
  end_at: string | null;
  coins: number | null;
  points: number | null;
  /** In progress / owned slot, when EA says so. */
  status: string | null;
  requirements: EvoEntryRaw[];
  levels: EvoLevelRaw[];
}

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,12}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const nonNeg = (v: unknown, max = 2_000_000_000): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

export function isEvolutions(url: string, method = "GET"): boolean {
  if (method.toUpperCase() !== "GET") return false;
  try {
    return /\/ut\/game\/fc\d+\/academy(\/|$)/i.test(new URL(url, "https://example.invalid").pathname);
  } catch {
    return false;
  }
}

const REQ_LIST = /eligib|requirement|criteria|restriction/i;
const LEVEL_LIST = /^(levels?|stages?|steps?|tiers?|upgrades?|rewards?)$/i;
const UPGRADE_LIST = /upgrade|boost|reward|award|attribute|bonus/i;
const TYPE_KEYS = ["type", "attribute", "attributeType", "stat", "key", "eligibilityKey", "name", "upgradeType", "boostType"] as const;
const VALUE_KEYS = ["value", "values", "eligibilityValue", "eligibilityValues", "amount", "boost", "boostValue", "delta", "max", "maxValue", "target"] as const;

function entry(raw: unknown): EvoEntryRaw | null {
  const r = rec(raw);
  if (!r) return null;
  const typeRaw = TYPE_KEYS.map((k) => r[k]).find((v) => typeof v === "string" || typeof v === "number");
  const type = typeof typeRaw === "number" ? String(typeRaw) : str(typeRaw, 60);
  if (!type) return null;
  const values: (number | string)[] = [];
  for (const k of VALUE_KEYS) {
    const v = r[k];
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === "number" && Number.isFinite(x) && Math.abs(x) < 2 ** 31) values.push(x);
      else if (typeof x === "string" && x.trim() && x.length <= 40) values.push(x.trim());
    }
    if (values.length) break;
  }
  const scopeRaw = r.scope ?? r.eligibilityScope ?? r.operation ?? r.comparison;
  const scope = typeof scopeRaw === "string" ? scopeRaw.toUpperCase().slice(0, 20) : typeof scopeRaw === "number" ? (["GREATER", "LOWER", "EXACT"][scopeRaw] ?? String(scopeRaw)) : null;
  return { type: type.toUpperCase().slice(0, 60), values: values.slice(0, 20), scope };
}

const listsIn = (o: Record<string, unknown>, re: RegExp) => Object.entries(o).filter(([k, v]) => re.test(k) && Array.isArray(v)).flatMap(([, v]) => v as unknown[]);

function levelsOf(o: Record<string, unknown>): EvoLevelRaw[] {
  const levels = listsIn(o, LEVEL_LIST);
  const out: EvoLevelRaw[] = [];
  for (const l of levels.slice(0, 12)) {
    const lr = rec(l);
    if (!lr) continue;
    // A level holds its own upgrade list; a bare upgrade entry counts as a one-upgrade level.
    const ups = listsIn(lr, UPGRADE_LIST);
    const list = (ups.length ? ups : [lr]).map(entry).filter((e): e is EvoEntryRaw => !!e).slice(0, 20);
    if (list.length) out.push({ upgrades: list });
  }
  return out;
}

/** Every evolution-looking object in an academy answer. */
export function readEvolutions(json: unknown, now = Date.now()): EvolutionRaw[] | null {
  if (!rec(json) && !Array.isArray(json)) return null;
  const out: EvolutionRaw[] = [];
  const seen = new Set<number>();
  const walk = (v: unknown, depth: number) => {
    if (out.length >= 150 || depth > 6) return;
    if (Array.isArray(v)) return void v.slice(0, 300).forEach((x) => walk(x, depth + 1));
    const o = rec(v);
    if (!o) return;
    const evo_id = int(o.academyId) ?? int(o.slotId) ?? int(o.evolutionId) ?? int(o.id);
    const name = str(o.name, 120) ?? str(o.title, 120);
    const requirements = listsIn(o, REQ_LIST).map(entry).filter((e): e is EvoEntryRaw => !!e).slice(0, 20);
    const levels = levelsOf(o);
    if (evo_id && name && (requirements.length || levels.length) && !seen.has(evo_id)) {
      seen.add(evo_id);
      const end = o.endTime ?? o.endTimeStamp ?? o.expiryTime;
      const endSeconds = typeof end === "number" && end > 0 && end < 400 * 86_400 ? new Date(now + end * 1000).toISOString() : null;
      const endEpoch = typeof end === "number" && end > 1e9 ? new Date(end > 1e12 ? end : end * 1000).toISOString() : null;
      const price = rec(o.price) ?? rec(o.cost) ?? o;
      out.push({
        evo_id, name, description: str(o.description, 300), end_at: endSeconds ?? endEpoch,
        coins: nonNeg(price.coins) ?? nonNeg(o.coinCost) ?? nonNeg(o.priceCoins), points: nonNeg(price.points) ?? nonNeg(o.pointCost) ?? nonNeg(o.pricePoints),
        status: str(o.status, 30) ?? str(o.state, 30), requirements, levels,
      });
      return;
    }
    for (const child of Object.values(o)) if (child && typeof child === "object") walk(child, depth + 1);
  };
  walk(json, 0);
  return out;
}

/** Field names of the first evolution-looking object, its first requirement and first upgrade (names only). */
export function evolutionShape(json: unknown): Record<string, string[]> {
  const shape: Record<string, string[]> = {};
  const keys = (o: unknown) => (rec(o) ? Object.keys(rec(o)!).sort().slice(0, 80) : []);
  const find = (v: unknown, test: (o: Record<string, unknown>) => boolean, depth = 0): Record<string, unknown> | null => {
    if (depth > 6) return null;
    if (Array.isArray(v)) { for (const x of v.slice(0, 50)) { const f = find(x, test, depth + 1); if (f) return f; } return null; }
    const o = rec(v);
    if (!o) return null;
    if (test(o)) return o;
    for (const c of Object.values(o)) if (c && typeof c === "object") { const f = find(c, test, depth + 1); if (f) return f; }
    return null;
  };
  const evo = find(json, (o) => !!(str(o.name) && (listsIn(o, REQ_LIST).length || listsIn(o, LEVEL_LIST).length)));
  if (evo) {
    shape.evolution = keys(evo);
    shape.evolution_requirement = keys(listsIn(evo, REQ_LIST)[0]);
    const level = rec(listsIn(evo, LEVEL_LIST)[0]);
    if (level) { shape.evolution_level = keys(level); shape.evolution_upgrade = keys(listsIn(level, UPGRADE_LIST)[0]); }
  } else shape.academy = keys(json);
  return shape;
}
