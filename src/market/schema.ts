// Validation for Market Lab requests arriving from outside (HTTP API, MCP tools, forms).
import { z } from "zod";

export const platformSchema = z.enum(["console", "pc"]);
const coins = z.number().int().min(0).max(15_000_000);

export const thesisInputSchema = z.object({
  card_id: z.string().min(1).max(200),
  platform: platformSchema,
  quantity: z.number().int().min(1).max(100),
  buy_price: coins.min(1),
  target_price: coins.min(1),
  downside_price: coins.min(0),
  holding_hours: z.number().min(0).max(24 * 60).optional(),
  coin_balance: coins.nullable().optional(),
  existing: z.object({ quantity: z.number().int().min(0).max(100), cost_basis: coins }).nullable().optional(),
  assumed_target_probability: z.number().min(0).max(1).nullable().optional(),
});

export const watchItemInputSchema = z.object({
  card_id: z.string().min(1).max(200),
  platform: platformSchema,
  note: z.string().max(280).nullable().optional(),
  target_buy: coins.nullable().optional(),
  target_sell: coins.nullable().optional(),
});

export const scanRequestSchema = z.object({
  platform: platformSchema.optional(),
  status: z.array(z.enum(["watch", "research_further", "favorable_setup", "overheated", "elevated_risk", "insufficient_evidence"])).optional(),
  max_price: coins.optional(),
  category: z.enum(["base", "promo", "icon", "hero", "evolution", "live", "sbc_reward", "objective"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
