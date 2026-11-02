// Market Lab types. Plain JSON, no DB or Node imports: bundled for Workers and Deno (Gaffer Bot fut-api) too.
import type { Evidence } from "../chemistry/index.js";
import type { WorkspaceCard } from "../workspace/index.js";

/** FUT runs one shared console market (PlayStation + Xbox) and a separate PC market. */
export type Platform = "console" | "pc";
export const PLATFORMS: readonly Platform[] = ["console", "pc"];

/**
 * One observed price, point-in-time. Three clocks, so a backtest can never see what wasn't known yet:
 * - observed_at: when the provider saw this price on the market
 * - received_at: when XI Lab stored it (a backtest at time T may only use rows with received_at <= T)
 * - event_at: optional, when the underlying thing happened if different (e.g. a sale completed)
 */
export interface PriceObservation {
  card_id: string;
  platform: Platform;
  /** Coins. Lowest listed BIN unless `kind` says otherwise. */
  price: number;
  kind?: "lowest_bin" | "sale" | "user_quote";
  observed_at: string;
  received_at: string;
  event_at?: string | null;
  season: string;
  source_id: string;
  evidence: Evidence;
  /** Fields the provider did not supply, or anything odd about this row. */
  quality?: string[];
}

export type SourceStatus = "enabled" | "disabled" | "not_authorized";

/** What a provider's terms let us do with its data. Unknown = not allowed. */
export interface SourcePermissions {
  commercial_use: boolean;
  storage: boolean;
  /** How long rows may be kept, in days. null = no limit stated. */
  retention_days: number | null;
  display: boolean;
  derived_analytics: boolean;
  model_training: boolean;
  redistribution: boolean;
  attribution: string | null;
}

export interface PriceSource {
  id: string;
  name: string;
  kind: "demo" | "user_import" | "licensed_feed" | "official_api";
  status: SourceStatus;
  /** Demo data is made up. Anything built on it says so. */
  is_demo: boolean;
  /** Plain-language status for the Data sources panel. */
  status_note: string;
  permissions: SourcePermissions;
  /** Lowest evidence label rows from this source can carry. */
  evidence: Evidence;
}

export type CardCategory = "base" | "promo" | "icon" | "hero" | "evolution" | "live" | "sbc_reward" | "objective";

/** A card as Market Lab sees it: the workspace card (canonical id, positions, stats) plus market metadata. */
export interface MarketCard extends WorkspaceCard {
  rating: number;
  category: CardCategory;
  /** Free-text card version, e.g. "Rare Gold", "TOTW". */
  version?: string;
  /** Flags that put a card into the evolution / live-upgrade baskets. Stage B fills these from event data. */
  evolution_candidate?: boolean;
  live_upgrade?: boolean;
  tradeable?: boolean;
}

export type Freshness = "fresh" | "stale" | "missing";

export interface FreshnessCheck {
  status: Freshness;
  latest_observed_at: string | null;
  age_hours: number | null;
  stale_after_hours: number;
  message: string;
}

/** Windows used across Market Lab. */
export type Window = "1h" | "6h" | "24h" | "72h" | "7d";
export const WINDOWS: readonly Window[] = ["1h", "6h", "24h", "72h", "7d"];
export const WINDOW_HOURS: Record<Window, number> = { "1h": 1, "6h": 6, "24h": 24, "72h": 72, "7d": 168 };

/** Every Market Lab result says what it is built on. */
export interface MarketProvenance {
  rules_version: string;
  engine_version: string;
  as_of: string;
  /** True when any input came from the demo dataset. */
  demo: boolean;
  sources: string[];
  evidence: Evidence;
}
