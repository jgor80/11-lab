// Validation for squads arriving from outside (HTTP API, MCP tools, pasted JSON).
import { z } from "zod";

const name = z.string().trim().min(1).max(120);
const opt = z.string().trim().max(120).nullable().optional().transform((v) => (v ? v : null));

export const cardSchema = z.object({
  id: z.string().min(1).max(200),
  name,
  club: opt,
  league: opt,
  nation: opt,
  positions: z.array(z.string().trim().toUpperCase().min(1).max(4)).max(6),
  is_icon: z.boolean().optional(),
  is_hero: z.boolean().optional(),
  rating: z.number().int().min(1).max(99).optional(),
  price: z.number().int().min(0).nullable().optional(),
  owned: z.boolean().optional(),
  stats: z.record(z.enum(["pac", "sho", "pas", "dri", "def", "phy"]), z.number().int().min(1).max(99)).optional(),
  source: z.enum(["fixture", "user", "database"]).optional(),
});

export const managerSchema = z.object({
  id: z.string().min(1).max(200),
  name,
  nation: opt,
  league: opt,
  price: z.number().int().min(0).nullable().optional(),
  owned: z.boolean().optional(),
  source: z.enum(["fixture", "user", "database"]).optional(),
});

export const squadSchema = z.object({
  id: z.string().min(1).max(200),
  owner_id: z.string().min(1).max(200),
  name,
  formation: z.string().min(1).max(20),
  platform: z.string().max(40).optional(),
  manager: managerSchema.nullable(),
  slots: z
    .array(z.object({ slot: z.string().min(1).max(8), position: z.string().min(1).max(4), card: cardSchema.nullable(), locked: z.boolean() }))
    .max(11),
  budget: z.number().int().min(0),
  parent_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const optimizeRequestSchema = z.object({
  goal: z.object({ slot: z.string().optional(), slot_target: z.number().int().min(0).max(3).optional(), total_target: z.number().int().min(0).max(33).optional() }),
  options: z
    .object({
      budget: z.number().int().min(0).optional(),
      max_swaps: z.number().int().min(1).max(4).optional(),
      allow_manager_change: z.boolean().optional(),
      allow_net_loss: z.boolean().optional(),
      max_results: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
});
