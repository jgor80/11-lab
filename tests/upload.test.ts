import { describe, expect, it } from "vitest";
import { looksLikeHelperKey, UPLOAD_BATCH, uploadOutcome, uploadPlan } from "../src/market/upload.js";
import type { CaptureRow } from "../src/market/capture.js";

const row = (min: number): CaptureRow => ({ ea_item_id: 1, asset_id: null, rating: 80, platform: "console", price: 1000, listings: 1, observed_at: new Date(Date.UTC(2026, 10, 2, 12, min)).toISOString() });

describe("auto-upload", () => {
  it("accepts only helper keys", () => {
    expect(looksLikeHelperKey("xlh_" + "a".repeat(32))).toBe(true);
    expect(looksLikeHelperKey("gb_" + "a".repeat(32))).toBe(false);
    expect(looksLikeHelperKey("xlh_short")).toBe(false);
    expect(looksLikeHelperKey("xlh_" + "a".repeat(30) + " x")).toBe(false);
  });

  it("uploads only rows newer than the last upload, oldest first, in batches", () => {
    const rows = [row(3), row(1), row(2)];
    expect(uploadPlan({ rows }).rows.map((r) => r.observed_at)).toEqual([row(1), row(2), row(3)].map((r) => r.observed_at));
    expect(uploadPlan({ rows, sent_until: row(2).observed_at }).rows).toEqual([row(3)]);
    const many = Array.from({ length: UPLOAD_BATCH + 10 }, (_, i) => ({ ...row(0), observed_at: new Date(Date.UTC(2026, 10, 2) + i * 60_000).toISOString() }));
    expect(uploadPlan({ rows: many }).rows).toHaveLength(UPLOAD_BATCH);
  });

  it("uploads the club when it changed since the last upload", () => {
    expect(uploadPlan({}).club).toBe(false);
    expect(uploadPlan({ last_club: "a" }).club).toBe(true);
    expect(uploadPlan({ last_club: "a", club_sent: "a" }).club).toBe(false);
  });

  it("drops the key when Gaffer Bot refuses it, and retries other failures", () => {
    expect(uploadOutcome(200, {})).toEqual({ ok: true, note: "", key_dead: false });
    expect(uploadOutcome(401, { error: "off" })).toMatchObject({ ok: false, key_dead: true, note: "off" });
    expect(uploadOutcome(429, null).key_dead).toBe(false);
    expect(uploadOutcome(500, null).note).toMatch(/500/);
  });
});
