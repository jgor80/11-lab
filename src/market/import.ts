// Price-history import: CSV or JSON in, validated point-in-time observations out, every rejected row with a reason.
import { parseCsv } from "../shared/csv.js";
import { DEFAULT_MARKET_RULES, type MarketRules } from "./rules.js";
import { assertUsable } from "./sources.js";
import { captureDetailsFromRow, type CaptureDetails } from "./capture.js";
import { PLATFORMS, type Platform, type PriceObservation, type PriceSource } from "./types.js";

export interface ImportOptions {
  source: PriceSource;
  /** When XI Lab received the file. Defaults to now. Rows observed after this are rejected (no future data). */
  received_at?: string;
  season?: string;
  /** Canonical card ids that exist. Rows for other ids are rejected, never auto-created. */
  knownCardIds: Set<string>;
  rules?: MarketRules;
  /** For captured Web App rows that carry EA's item id instead of a card_id. */
  resolveEaItem?: (ea_item_id: number, asset_id: number | null, rating: number | null) => string | null;
}

/** A valid captured price whose EA item isn't in the card database yet. Kept (when a hold store exists) and linked later. */
export interface UnmatchedCapture {
  ea_item_id: number;
  asset_id: number | null;
  rating: number | null;
  details?: CaptureDetails;
  /** The observation, complete except for card_id (""), ready to store once the card exists. */
  observation: PriceObservation;
}

export interface ImportResult {
  rows: PriceObservation[];
  /** Captured rows that passed every check except matching a card. */
  unmatched: UnmatchedCapture[];
  rejected: { line: number; reason: string; raw: Record<string, unknown> }[];
  duplicates: number;
}

export const PRICE_CSV_HEADER = "card_id,platform,price,observed_at,kind,event_at";
/** Web App captures use ea_item_id (plus asset_id, rating, listings) instead of card_id. */

const PLATFORM_ALIASES: Record<string, Platform> = { console: "console", ps: "console", playstation: "console", xbox: "console", ps5: "console", xsx: "console", pc: "pc" };

export function parsePriceImport(text: string, opts: ImportOptions): ImportResult {
  const t = text.trim();
  let raw: Record<string, unknown>[];
  if (t.startsWith("[") || t.startsWith("{")) {
    const j = JSON.parse(t);
    raw = Array.isArray(j) ? j : Array.isArray(j.observations) ? j.observations : [];
  } else raw = parseCsv(t);
  return validatePriceRows(raw, opts);
}

export function validatePriceRows(raw: Record<string, unknown>[], opts: ImportOptions): ImportResult {
  assertUsable(opts.source, "storage");
  const rules = opts.rules ?? DEFAULT_MARKET_RULES;
  const received_at = opts.received_at ?? new Date().toISOString();
  const recv = Date.parse(received_at);
  const rows: PriceObservation[] = [];
  const unmatched: UnmatchedCapture[] = [];
  const rejected: ImportResult["rejected"] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  raw.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const reject = (reason: string) => rejected.push({ line, reason, raw: r });
    let card_id = String(r.card_id ?? "").trim();
    const eaId = Number(r.ea_item_id);
    const num = (v: unknown) => (v === undefined || v === "" || v === null || !Number.isInteger(Number(v)) ? null : Number(v));
    let pendingEa: number | null = null;
    if (!card_id && Number.isInteger(eaId) && eaId > 0) {
      card_id = opts.resolveEaItem?.(eaId, num(r.asset_id), num(r.rating)) ?? "";
      if (!card_id) pendingEa = eaId;
    }
    if (!card_id && pendingEa === null) return reject("card_id (or ea_item_id) is empty");
    if (pendingEa === null && !opts.knownCardIds.has(card_id)) return reject(`Unknown card_id "${card_id}" (import the card first; prices never create cards)`);
    const platform = PLATFORM_ALIASES[String(r.platform ?? "").trim().toLowerCase()];
    if (!platform || !PLATFORMS.includes(platform)) return reject(`platform must be console or pc, got "${r.platform}"`);
    const price = Number(r.price);
    if (!Number.isInteger(price) || price < rules.min_price || price > 15_000_000) return reject(`price must be a whole number of coins between ${rules.min_price} and 15,000,000`);
    const observed = Date.parse(String(r.observed_at ?? ""));
    if (!Number.isFinite(observed)) return reject("observed_at is not an ISO date-time");
    if (observed > recv) return reject("observed_at is after the import time (future data)");
    const kindRaw = String(r.kind ?? "").trim();
    const kind = kindRaw === "" ? "lowest_bin" : kindRaw;
    if (!["lowest_bin", "sale", "user_quote"].includes(kind)) return reject(`kind must be lowest_bin, sale or user_quote, got "${kindRaw}"`);
    const ev = String(r.event_at ?? "").trim();
    const event_at = ev ? Date.parse(ev) : null;
    if (event_at !== null && !Number.isFinite(event_at)) return reject("event_at is not an ISO date-time");
    const key = `${pendingEa === null ? card_id : `ea:${pendingEa}`}|${platform}|${observed}`;
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);
    const quality: string[] = [];
    if (kind === "sale") quality.push("Provider says this is a completed sale; XI Lab can't verify it.");
    const listings = Number(r.listings);
    if (opts.source.kind === "browser_capture")
      quality.push(`Lowest Buy Now among ${Number.isInteger(listings) && listings > 0 ? listings : "the"} listing(s) on a results page you viewed; not the whole market.`);
    const obs: PriceObservation = {
      card_id,
      platform,
      price,
      kind: kind as PriceObservation["kind"],
      observed_at: new Date(observed).toISOString(),
      received_at,
      event_at: event_at === null ? null : new Date(event_at).toISOString(),
      season: opts.season ?? "FC27",
      source_id: opts.source.id,
      evidence: opts.source.evidence,
      ...(quality.length ? { quality } : {}),
    };
    if (pendingEa === null) return void rows.push(obs);
    const details = captureDetailsFromRow(r);
    unmatched.push({ ea_item_id: pendingEa, asset_id: num(r.asset_id), rating: num(r.rating), ...(details ? { details } : {}), observation: obs });
  });
  return { rows, unmatched, rejected, duplicates };
}
