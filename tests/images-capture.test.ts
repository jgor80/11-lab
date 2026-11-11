import { describe, expect, it } from "vitest";
import { buildImagesExport, cardArtUrl, MAX_IMAGES, mergeImages } from "../src/images/capture.js";
import { imagesDue } from "../src/market/upload.js";

const C = "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/27A3C9F1/2027/fut/items/images";

describe("card art addresses", () => {
  it("keeps EA card backgrounds and drops the query string", () => {
    expect(cardArtUrl(`${C}/backgrounds/itemBGs/large/cards_bg_e_1_3_0.png?v=2`)).toBe(`${C}/backgrounds/itemBGs/large/cards_bg_e_1_3_0.png`);
    expect(cardArtUrl("/ea-sports-fc/ultimate-team/web-app/images/specialItems/totw_bg.webp")).toBe("https://www.ea.com/ea-sports-fc/ultimate-team/web-app/images/specialItems/totw_bg.webp");
  });
  it("skips faces, badges, flags, other sites and non-images", () => {
    expect(cardArtUrl(`${C}/mobile/portraits/231747.png`)).toBeNull();
    expect(cardArtUrl(`${C}/mobile/clubs/dark/73.png`)).toBeNull();
    expect(cardArtUrl(`${C}/mobile/flags/dark/18.png`)).toBeNull();
    expect(cardArtUrl("https://game-assets.fut.gg/2027/rarities/3.png")).toBeNull();
    expect(cardArtUrl(`${C}/backgrounds/itemBGs/large/data.json`)).toBeNull();
    expect(cardArtUrl("data:image/png;base64,xyz")).toBeNull();
    expect(cardArtUrl("http://www.ea.com/x/card_bg.png")).toBeNull();
  });
  it("merges sightings and caps the list", () => {
    const a = mergeImages([], ["u1", "u2"], "2026-11-10T00:00:00Z");
    const b = mergeImages(a, ["u1"], "2026-11-10T01:00:00Z");
    expect(b[0]).toEqual({ url: "u1", first_seen: "2026-11-10T00:00:00Z", last_seen: "2026-11-10T01:00:00Z", count: 2 });
    expect(mergeImages([], Array.from({ length: MAX_IMAGES + 10 }, (_, i) => `u${i}`)).length).toBe(MAX_IMAGES);
    expect(buildImagesExport(b, "t").images).toHaveLength(2);
  });
  it("uploads only when new addresses were seen", () => {
    expect(imagesDue({ last_images: "t1", images_sent: "t1" })).toBe(false);
    expect(imagesDue({ last_images: "t2", images_sent: "t1" })).toBe(true);
    expect(imagesDue({})).toBe(false);
  });

  it("keeps pack pictures (Pack Advisor) but still never faces", () => {
    expect(cardArtUrl("https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/x/2027/fut/ui/packs/pack_3021.png")).toBe("https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/x/2027/fut/ui/packs/pack_3021.png");
    expect(cardArtUrl("https://www.ea.com/x/portraits/pack1.png")).toBeNull();
  });
});
