// Card art addresses (Jeff, 2026-11-10). EA's Web App loads promo, Icon and Hero card backgrounds from addresses that
// can't be guessed from outside. The helper notes the ADDRESSES of card-art images the Web App itself loads (never the
// images, never anything about the account), so Gaffer Bot can learn EA's naming and let browsers load the same files
// straight from EA. Faces, club badges, flags and league logos are already known and skipped. Since 0.11.0 pack
// pictures are kept too, so Pack Advisor can show each pack.

export interface ImageSeen { url: string; first_seen: string; last_seen: string; count: number }

const IMAGE = /\.(?:png|webp|jpe?g|svg|avif)$/i;
// Already known to Gaffer Bot, or not card art
const SKIP = /\/(?:portraits|playerheads|clubs|flags|leagueLogos|leagues|nations|crests|badges|avatars?|icons?|ui|fonts?)\//i;
const ART = /background|itemBG|cardbg|cards_bg|rarit|special|shell|card|item/i;
// Pack pictures (helper 0.11.0, for Pack Advisor): kept wherever they live, apart from faces and badges
const PACK = /pack/i;
const NEVER = /\/(?:portraits|playerheads|clubs|flags|leagueLogos|nations|crests|avatars?)\//i;

/** EA hosts only (the Web App and its asset servers). */
function eaHost(host: string): boolean {
  return host === "ea.com" || host.endsWith(".ea.com") || host.endsWith(".easports.com") || host.endsWith(".eamobile.com") || host.endsWith(".akamaized.net");
}

/** The address to keep for a loaded image, or null when it isn't EA card art: no query string, no hash. */
export function cardArtUrl(raw: string, base = "https://www.ea.com/"): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !eaHost(u.hostname)) return null;
  const path = u.pathname;
  if (!IMAGE.test(path) || NEVER.test(path)) return null;
  if (!PACK.test(path) && (SKIP.test(path) || !ART.test(path))) return null;
  if (path.length > 300) return null;
  return `${u.origin}${path}`;
}

export const MAX_IMAGES = 400;

/** Adds sightings (newest first by last_seen), keeping at most MAX_IMAGES addresses. */
export function mergeImages(have: ImageSeen[] | undefined, urls: string[], at = new Date().toISOString()): ImageSeen[] {
  const byUrl = new Map((have ?? []).map((x) => [x.url, { ...x }]));
  for (const url of urls) {
    const old = byUrl.get(url);
    byUrl.set(url, old ? { ...old, last_seen: at, count: old.count + 1 } : { url, first_seen: at, last_seen: at, count: 1 });
  }
  return [...byUrl.values()].sort((a, b) => b.last_seen.localeCompare(a.last_seen)).slice(0, MAX_IMAGES);
}

/** The file sent to Gaffer Bot (POST /helper/images). */
export function buildImagesExport(images: ImageSeen[], captured_at = new Date().toISOString()) {
  return { format: "xilab-image-addresses", version: 1, captured_at, images: images.map(({ url, first_seen, last_seen, count }) => ({ url, first_seen, last_seen, count })) };
}
