// Price providers. Each is an adapter that can be added, disabled or replaced on its own, with its licence
// terms as data. A provider that isn't authorised stays listed, disabled, with the reason.
import type { PriceObservation, PriceSource, SourcePermissions } from "./types.js";

const NONE: SourcePermissions = {
  commercial_use: false,
  storage: false,
  retention_days: null,
  display: false,
  derived_analytics: false,
  model_training: false,
  redistribution: false,
  attribution: null,
};

export const DEFAULT_PRICE_SOURCES: PriceSource[] = [
  {
    id: "xilab_demo",
    name: "XI Lab demo dataset",
    kind: "demo",
    status: "enabled",
    is_demo: true,
    status_note: "Made-up prices for made-up cards, generated so Market Lab can be tried. Not market data. Every screen using it says DEMO.",
    permissions: { ...NONE, storage: true, display: true, derived_analytics: true },
    evidence: "hypothesis",
  },
  {
    id: "user_import",
    name: "Your imported price history",
    kind: "user_import",
    status: "enabled",
    is_demo: false,
    status_note: "Prices you import (CSV/JSON) or note down yourself. Private to you. XI Lab doesn't check where they came from.",
    permissions: { ...NONE, storage: true, display: true, derived_analytics: true },
    evidence: "estimate",
  },
  {
    id: "web_app_capture",
    name: "Your Web App captures (XI Lab browser helper)",
    kind: "browser_capture",
    status: "enabled",
    is_demo: false,
    status_note:
      "Lowest Buy Now prices from transfer-market searches YOU ran in the EA Web App, read from results the Web App already loaded. The helper never searches, clicks or bids. Only the listings you viewed, not the whole market. Private to you. Third-party software on EA's site carries some account risk (Jeff accepted it on 2026-11-02).",
    permissions: { ...NONE, storage: true, display: true, derived_analytics: true },
    evidence: "game_data",
  },
  {
    id: "ea_fc_community_api",
    name: "EA FC Community API",
    kind: "official_api",
    status: "not_authorized",
    is_demo: false,
    status_note: "Closed to new partners as of 2026-11-02. Not connected.",
    permissions: NONE,
    evidence: "verified",
  },
  ...(["FUTBIN", "FUT.GG", "FUTWIZ"] as const).map(
    (name): PriceSource => ({
      id: name.toLowerCase().replace(/\W/g, ""),
      name,
      kind: "licensed_feed",
      status: "not_authorized",
      is_demo: false,
      status_note: `No licence or API agreement. ${name} blocks automated access and isn't scraped. Enable only after a data agreement.`,
      permissions: NONE,
      evidence: "game_data",
    }),
  ),
];

/** A live feed adapter. None is implemented: no authorised feed exists yet. A licensed feed implements this. */
export interface PriceProvider {
  source: PriceSource;
  /** Observations the provider saw since `since`. The adapter sets received_at when it stores them. */
  fetchSince(since: string): Promise<Omit<PriceObservation, "received_at">[]>;
}

export class SourceNotAllowedError extends Error {}

/** Refuse to store or analyse rows from a source whose terms don't allow it. */
export function assertUsable(source: PriceSource | undefined, use: "storage" | "derived_analytics" | "display"): asserts source is PriceSource {
  if (!source) throw new SourceNotAllowedError("Unknown price source");
  if (source.status !== "enabled") throw new SourceNotAllowedError(`${source.name} is ${source.status.replace("_", " ")}: ${source.status_note}`);
  if (!source.permissions[use]) throw new SourceNotAllowedError(`${source.name}'s terms don't allow ${use.replace("_", " ")}.`);
}
