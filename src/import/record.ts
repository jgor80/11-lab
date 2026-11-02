// The normalized card record every adapter produces. The writer only ever sees this shape,
// so adding a source means writing an adapter, never touching the database code.
import { z } from "zod";

export const EVIDENCE = ["verified", "game_data", "estimate", "hypothesis"] as const;

const rating = z.number().int().min(1).max(99);
const named = z.object({ name: z.string().trim().min(1), ea_id: z.number().int().optional() });

export const CardRecord = z.object({
  /** Stable key for this card within its source (an EA item id, a dataset row id...). */
  card_key: z.string().min(1),
  ea_item_id: z.number().int().optional(),
  person: z.object({
    /** Stable key for the footballer within the source. Different versions share it. */
    key: z.string().min(1),
    ea_person_id: z.number().int().optional(),
    common_name: z.string().trim().min(1),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    gender: z.enum(["men", "women"]).optional(),
    height_cm: z.number().int().min(120).max(230).optional(),
    weight_kg: z.number().int().min(40).max(130).optional(),
    preferred_foot: z.enum(["left", "right"]).optional(),
  }),
  season: z.string().default("FC27"),
  version: z.string().min(1).default("base"),
  rarity: z.string().optional(),
  overall: rating,
  nation: named,
  league: named.extend({ gender: z.enum(["men", "women"]).optional() }).optional(),
  club: named.optional(),
  /** First entry is the primary position. */
  positions: z.array(z.string().trim().toUpperCase()).min(1),
  is_icon: z.boolean().default(false),
  is_hero: z.boolean().default(false),
  skill_moves: z.number().int().min(1).max(5).optional(),
  weak_foot: z.number().int().min(1).max(5).optional(),
  attacking_work_rate: z.enum(["low", "medium", "high"]).optional(),
  defensive_work_rate: z.enum(["low", "medium", "high"]).optional(),
  /** Keys must exist in attribute_defs. */
  attributes: z.record(z.string(), rating).default({}),
  playstyles: z.array(z.object({ name: z.string().trim().min(1), plus: z.boolean() })).default([]),
  roles: z
    .array(z.object({ position: z.string().trim().toUpperCase(), role: z.string().trim().min(1), level: z.enum(["plus", "plusplus"]) }))
    .default([]),
  image_url: z.string().url().optional(),
  availability: z.string().optional(),
  source_updated_at: z.string().optional(),
  evidence: z.enum(EVIDENCE),
});

export type CardRecord = z.infer<typeof CardRecord>;
export type CardRecordInput = z.input<typeof CardRecord>;

/** Result of reading a source: valid records plus the ones that couldn't be mapped. */
export interface AdapterOutput {
  records: CardRecordInput[];
  rejected: { ref: string; reason: string }[];
  /** When the source says its data was taken, if it says. */
  snapshotAt?: string;
}
