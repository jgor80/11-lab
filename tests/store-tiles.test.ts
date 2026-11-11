import { describe, expect, it } from "vitest";
import { applyTiles, parseCountdown, parseStoreTile, tileId } from "../src/store/tiles.js";
import { summarizeStore } from "../src/store/capture.js";

const NOW = Date.UTC(2026, 10, 11, 3, 0);
// innerText of a Store tile as the FC 27 Web App shows it (from Jeff's screenshot, 2026-11-11)
const EUROPEAN = `European Dreams Pack
Mixed
20
Items
20
Min. Players
Includes 2 Gold Player Picks (1 of 5), rated 83 or higher. Also includes 18 Gold Player Items, rated 80 or higher, with 8 guaranteed to be rated 81 or higher, and 2 guaranteed to be rated 84 or higher. All items untradeable.
User limit: 3
Ending: 2 Days 14 Hours
110,000
1,500`;
const JUMBO = `Jumbo Gold Players Pack
Players
24
Items
24
Min. Players
Includes 24 Gold Player Items, with 2 guaranteed to be rated 83 or higher.
User limit: 3
Ending: 2 Days 14 Hours
100,000
2,000`;

describe("store tiles", () => {
  it("reads countdowns", () => {
    expect(parseCountdown("Ending: 2 Days 14 Hours")).toBe(2 * 86_400 + 14 * 3600);
    expect(parseCountdown("Ends in 5h 3m")).toBe(5 * 3600 + 180);
    expect(parseCountdown("Ending soon")).toBeNull();
  });

  it("reads a tile's name, description, limit, end, items and prices", () => {
    expect(parseStoreTile(EUROPEAN, "https://www.ea.com/x/pack.png")).toEqual({
      name: "European Dreams Pack", description: expect.stringMatching(/^Includes 2 Gold Player Picks/), coins: 110_000, points: 1500,
      items: 20, user_limit: 3, ends_in: 2 * 86_400 + 14 * 3600, untradeable: true, image_url: "https://www.ea.com/x/pack.png",
    });
    expect(parseStoreTile(JUMBO)).toMatchObject({ name: "Jumbo Gold Players Pack", coins: 100_000, points: 2000, items: 24, untradeable: false });
    expect(parseStoreTile("Transfer Market\nSearch\n500")).toBeNull();
    expect(parseStoreTile(`NEW\n${JUMBO}`)!.name).toBe("Jumbo Gold Players Pack");
  });

  it("names captured packs by price and item count, and keeps tiles with no captured pack", () => {
    const packs = summarizeStore({ purchase: [{ id: 501, coins: 110_000, points: 1500, packContentInfo: { itemQuantity: 20 } }, { id: 502, coins: 100_000, points: 2000 }] }, {}, NOW)
      .map((p) => ({ ...p, seen_at: "2026-11-10T00:00:00.000Z" }));
    const tiles = [parseStoreTile(EUROPEAN)!, parseStoreTile(JUMBO)!, { ...parseStoreTile(JUMBO)!, name: "Starlit Nights Pack", coins: 40_000, points: null }];
    const out = applyTiles(packs, tiles, NOW);
    expect(out.map((p) => [p.pack_id, p.name])).toEqual([[501, "European Dreams Pack"], [502, "Jumbo Gold Players Pack"], [tileId("Starlit Nights Pack"), "Starlit Nights Pack"]]);
    expect(out[0]).toMatchObject({ end_at: new Date(NOW + (2 * 86_400 + 14 * 3600) * 1000).toISOString(), purchase_limit: 3, untradeable: true, seen_at: new Date(NOW).toISOString() });
    // Once the store data has that pack too, the tile-only copy goes
    const later = applyTiles([...out.map((p) => ({ ...p, seen_at: "x" })), { ...packs[1]!, pack_id: 503, coins: 40_000, points: null, name: null }], [tiles[2]!], NOW);
    expect(later.filter((p) => p.name === "Starlit Nights Pack").map((p) => p.pack_id)).toEqual([503]);
  });
});
