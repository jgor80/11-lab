# FC 27 Web App: transfer-market endpoints (captured)

Captured on **2026-11-08, 00:49 to 00:57 UTC** by watching the real FC 27 Web App in a signed-in browser tab (Xbox
account, console market). The Web App sent every request itself, after normal clicks on its own screens:
4 transfer-market searches, at least 15 seconds apart. Nothing was replayed, scripted or sent from outside the tab.
No bids, buys or listings. Every answer was `200`, with no captcha and no "too many actions" message.

Labels used below:

- **Verified**: seen in this capture.
- **Hypothesis**: inferred or carried over from earlier seasons. Not seen here.

Personal values (session token, persona and Nucleus ids, seller names and ids) are left out on purpose. Header
**values** were never recorded. Only header names were.

## Hosts

| Host | Role | Status |
| --- | --- | --- |
| `www.ea.com/ea-sports-fc/ultimate-team/web-app/` | The app, plus static content under `content/<guid>/2027/fut/...` | Verified |
| `utas.mob.v1.prd.futc-ext.gcp.ea.com` | Ultimate Team API (market, club, squads, piles). Requests carry an explicit `:443` port in the URL | Verified |
| `fcas.mob.v1.prd.futc-ext.gcp.ea.com` | FC auth/settings (`/fc/auth`, `/fc/user`, `/fc/settings`, `/fc/user/season/lite`) | Verified |
| `accounts.ea.com`, `gateway.ea.com` | EA account (Nucleus) sign-in and identity | Verified |
| `pin-river.data.ea.com/pinEvents` | Telemetry | Verified |

Source: the Web App's public `config/config.json` (changelist `11414`) has `eadpClientId: FC27_JS_WEB_APP`,
`utasAuthHost: utas.mob.v1.prd.futc-ext.gcp.ea.com:443`, `fcasAuthHost: fcas.mob.v1.prd.futc-ext.gcp.ea.com:443`,
`requestTimeout: 30000`, a FunCaptcha public key and `settingsRefreshInterval: 600000`. **Verified.**

Older helper tests used hosts like `utas.mob.v4/v5...`. On FC 27 the Web App used **v1** for everything. Matching on
the path (as `isTransferMarketSearch` does) rather than the host is still the right call. (Verified)

## Sign-in sequence (order seen, all XHR, all 200)

1. `GET gateway.ea.com/proxy/identity/pids/me`
2. `GET accounts.ea.com/connect/auth?client_id=FUTWEB_BK_OL_SERVER&redirect_uri=nucleus:rest&response_type=code&access_token=…&release_type=prod&client_sequence=shard5`
3. `GET utas…/ut/game/fc27/v2/user/accountinfo?filterConsoleLogin=true&sku=FUT27WEB&clientVersion=1`
4. `fcas…/fc/auth`, then `fcas…/fc/user`
5. `accounts.ea.com/connect/auth?…&client_sequence=ut-auth`
6. `utas…/ut/auth` (issues the session that `X-UT-SID` carries: hypothesis based on earlier seasons, since bodies weren't read)
7. `gateway.ea.com/proxy/identity/pids/<pid>/entitlements?groupName=FC24XBSX&groupName=FC27XBSX` (Xbox account)
8. `utas…/ut/game/fc27/`: `chemistry/teamlinks`, `chemistry/profiles`, `usermassinfo`, `playStats`, `appstats`,
   `eventtoken/definitions`, `livemessage/template?screen=futweblivemsg`, `purchased/items`, `companion/hub/light`,
   `tradepile`, `message/list/template?nucPersId=…&screen=webfuthub`, `scmp/data/lite`,
   `livemessage?screen=futweblivemsg`, `watchlist`
9. `fcas…/fc/settings`, `fcas…/fc/user/season/lite`

SKU is **`FUT27WEB`**. (Verified)

## Transfer-market search

```
GET https://utas.mob.v1.prd.futc-ext.gcp.ea.com:443/ut/game/fc27/transfermarket?num=21&start=0&type=player[&filters]
```

The Web App sends this as an **XMLHttpRequest** (not `fetch`). (Verified)

**Request headers it sets:** `Content-Type`, `X-UT-SID`, `Cache-Control`. (Verified, names only) The browser adds
its usual `Origin`, `Referer` and `User-Agent`.
**Response headers readable from the page:** `cache-control`, `content-length`, `content-type`. (Verified)

### Query parameters

| Param | Screen control | Example | Status |
| --- | --- | --- | --- |
| `num` | page size + 1 lookahead | `21` | Verified: 20 rows show, and the 21st row decides whether "Next" appears |
| `start` | paging | `0`, then `20` after Next | Verified |
| `type` | tab | `player` (Players tab) | Verified |
| `maskedDefId` | player picked from the name list | `256079` (Moisés Caicedo, base asset id) | Verified: matches any version of that footballer, so filter by `lev`/`rare` to narrow it |
| `lev` | Quality | `gold` | Verified (`bronze`/`silver`/`special` are hypotheses from the same menu) |
| `zone` | Position: group | `midfield` (Midfielders) | Verified (`defense`/`attacker` hypothesis) |
| `maxb` | Buy Now max | `7000` | Verified: every row came back with BIN ≤ 7000 |
| `minb` | Buy Now min | | Hypothesis (helper's `PRICE_FILTERS`) |
| `micr` / `macr` | Bid min / max | | Hypothesis |
| `pos` | single position (e.g. CM) | | Hypothesis |
| `rare`, `nat`, `leag`, `team`, `playStyle` | Rarity, Country, League, Club, Chem style | | Hypothesis (from earlier seasons) |
| `definitionId` | a specific card version | | Hypothesis (picking from the name list sent `maskedDefId`) |

**Name search makes no request.** The suggestion list comes from the static `content/…/fut/items/web/players.json`
already loaded with the app. (Verified)

### Response

```jsonc
{
  "auctionInfo": [            // up to num (21) listings, sorted by `expires` ascending (ending soonest first)
    {
      "tradeId": 621470383242, "tradeIdStr": "621470383242",
      "tradeState": "active",  "bidState": "none",
      "buyNowPrice": 10000,    "startingBid": 6300, "currentBid": 0, "offers": 0,
      "expires": 41,           // seconds left
      "watched": false,        "tradeOwner": false, "confidenceValue": 100,
      "sellerName": "…",       "sellerId": 0, "sellerEstablished": 0,   // personal: never store
      "itemData": { … }
    }
  ],
  "bidTokens": {}
}
```

`itemData` keys seen (union across the 21 listings of the first, unfiltered search):
`id` (this physical item), `resourceId` (card version, = `assetId` for base cards), `assetId`, `rating`, `itemType`
(`player`), `rareflag`, `preferredPosition`, `possiblePositions[]`, `teamid`, `leagueId`, `nation`, `gender`,
`resourceGameYear` (`2027`), `cardsubtypeid`, `itemState` (`forSale`), `untradeable`, `owners`, `contract`,
`discardValue`, `untradableDiscardValue`, **`marketAverage`**, **`lastSalePrice`**, `timestamp`, `formation`,
`playStyle`, `injuryType`, `injuryGames`, `assists`, `lifetimeAssists`, `loyaltyBonus`, `pile`, `attributeArray[]`,
`statsArray[]`, `lifetimeStatsArray[]`, `skillmoves`, `weakfootabilitytypecode`, `preferredfoot`, `plusRoles[]`,
`plusPlusRoles[]`, `gradingScore`, `isCollected`, `baseTraits`, `iconTraits`, `guidAssetId`, `rankId`. (Verified)

`marketDataMinPrice` / `marketDataMaxPrice` (the price range) were **not** in search results. (Verified absent) They
may appear on club/tradepile items (hypothesis).

#### Two new price fields

- **`itemData.marketAverage`**: one number per card version. It was the **same on all 42 Caicedo listings checked (4,945)**,
  while Buy Now prices ran from 5,300 to 9,400, and it looks like a smoothed average sale price. Verified that it
  exists and stays constant per card. **What it means is a hypothesis.** EA doesn't document it.
- **`itemData.lastSalePrice`**: different on each listing (1,200 to 16,000 for the same card), and `0` when the
  item has never sold. It is that physical item's previous sale price. (Hypothesis on meaning, verified behaviour)

These matter for XI Lab. One search gives an EA-side reference price for the card, plus a small sample of real past
sale prices, on top of the lowest Buy Now that the helper captures today.

## Results-screen polling: `trade/status/lite`

While a results page is on screen, the Web App re-checks those listings by itself:

```
GET …/ut/game/fc27/trade/status/lite?tradeIds=<comma-separated tradeIds of the rows on screen>
```

- About **once every 1.2 seconds** (1.2 to 2.2 s gaps). That was 22 calls in about 25 s on one page and 14 in about
  17 s on another. (Verified)
- Same headers as the search. (Verified)
- Response `{ "auctionInfo": [...] }` with live `expires`, `buyNowPrice`, `startingBid` and `currentBid`. The
  `itemData` is stripped (`resourceId: 0`, no rating, no `marketAverage`), so these rows **can't be matched to a
  card**. (Verified)
- It stops when you leave the results screen. (Verified)

What this means: most of a session's request volume comes from results pages left open, not from searches. A
helper rate limit that counts only searches undercounts what EA sees.

## What this means for the 11-lab helper

| Helper assumption | Capture says |
| --- | --- |
| `isTransferMarketSearch` matches `/ut/game/fcNN/transfermarket` by path | ✅ Works with the real URL, including the `:443` port. It correctly ignores `trade/status/lite` |
| `summarizeSearch`: `auctionInfo[].itemData.resourceId`, `buyNowPrice`, `tradeState: "active"`, `rareflag`, `teamid`, `leagueId`, `nation`, `preferredPosition` | ✅ All present with the expected types. Was "UNVERIFIED for FC 27", now verified |
| `learnTemplate` keys on `maskedDefId` / `definitionId` and drops price filters | ✅ The real name search sends `maskedDefId`. The template keeps `lev`/`zone`, so the template comes from the user's own last search |
| Price check sends with `fetch(..., credentials: "include")` | ⚠️ The Web App uses XHR. Whether it sets `withCredentials` wasn't checked. If EA's CORS answer doesn't allow credentials, a `credentials: "include"` fetch fails and the run stops with "Network problem" (it fails safe). Match the Web App's mode when this is next tested |
| Lowest BIN per page | ✅ Still right. `marketAverage` (per card) and `lastSalePrice` (per listing, non-zero only) are now captured as the `market_average` and `last_sales` CSV columns (helper v0.4.2) |
| Search pacing 10 to 20 s, daily cap | Fine for searches. Results pages left open poll about once a second, so the helper's own searches (which don't open a results screen) add far less load than browsing by hand |

## Not captured (next time, if wanted)

Rarity, nation, league, club and chem-style params; `definitionId` searches; managers, club items and consumables
tabs; `minb`/`micr`/`macr`; error statuses (only 200s were seen, so the helper's stop codes 458/459/460/461/494/512/521
are still from earlier seasons, which makes them hypotheses); response bodies of the sign-in calls.

## Pack store (helper v0.5.0+, not captured yet)

**Hypothesis** throughout: carried over from FC 26 community clients, not seen on FC 27 yet. The helper keeps the
field names it sees (never values) in each upload's `shape`, and Gaffer Bot's Pack Advisor shows them, so the first
real capture confirms or corrects this.

- `GET …/ut/game/fc27/store/purchaseGroup/all?ppInfo=true&categoryInfo=true`: loaded when the Store opens. Answer
  `{ purchase: [...] }` (older seasons: `purchaseGroup[].packs`). Each pack: `id`, `type`, `nameLoc` / `descriptionLoc`
  (localisation keys), `coins`, `points`, `untradeable`, `packContentInfo { itemQuantity, goldQuantity, silverQuantity,
  bronzeQuantity, rareQuantity }`, `start` / `end` / `secondsUntilEnd`, `purchaseLimit` / `purchaseCount`, `unopened`, and
  `packOdds[] { oddsFormatted, packOddsCategory { description, qualityId, rarityAssetId, packOddsRules[] { ruleType, ruleValue } } }`.
- `POST …/store/purchaseGroup/cardpack` with `{ "packId": … }`: the user opening a store pack. The helper reads the
  pack id from the body and the items in the answer. `POST …/purchased/items/<id>` opens an owned pack.
- `GET …/purchased/items`: the unassigned pile. Also loaded at sign-in, so the helper only counts it as pulls within
  two minutes of an open it saw.

`src/store/capture.ts` reads all of this; anything that doesn't fit is skipped. The helper never buys, opens or claims.

Since v0.7.0 (first live try found no packs): any answer under a `store`, `pack` or `odds` address is read the same
way, packs are also found nested a few levels down (`id` or `packId` plus a price, contents or odds; odds under
`packOdds`, `odds`, `packOddsList` or `probabilities`), odds that come in their own answer are attached by pack id, and
every such answer is logged by address (ids as `N`) with its top-level field names and how many packs and odds lines
were read. That log (`shape.seen`) is uploaded even when no pack was read, and Pack Advisor shows it.

Since v0.11.0 (packs showed as id numbers only): names come from display text on the item, else the Web App's own
strings for its key, else EA's usual store keys `FUT_STORE_PACK_<id>_NAME` / `_DESC` (also tried with the art id).
Names that load after the store are filled in and re-uploaded. Each pack also keeps `asset_id` (assetId / packAssetId /
imageAssetId / artId) and `image_url` when the item carries an EA picture address, and the image-address log keeps
any EA picture with "pack" in its path, so Pack Advisor can match a picture to each pack. All hypotheses on FC 27.

Since v0.12.0: FC 27's store data didn't carry readable names (Jeff saw only ids), but the Store screen shows them.
The helper reads the visible text of each store tile (one line per text node: name, "Includes ..." description,
"User limit: N", "Ending: 2 Days 14 Hours", coin and FC Points prices, item count) and the tile's picture address, a
couple of seconds after the page changes (`src/store/tiles.ts`). Tiles are matched to captured packs by coin price, FC
Points and item count; a tile with no captured pack becomes a pack of its own (id 900000000000 + name hash, no odds).
Read-only: no clicks, no requests.

Since v0.12.1: the store data lists more packs than the Store screen shows. Packs matched to a visible tile carry
`shown_at`; once any pack has it, Pack Advisor only lists packs shown within 2 hours of the newest tile read. The popup's
"Clear stored packs" empties the helper's packs, odds and seen log and the next upload sends `reset: true`, which
deletes that platform's stored packs on Gaffer Bot (pulls are kept).

## Your account (helper v0.6.0, bodies not captured yet)

The **addresses** are verified (they load at sign-in, see the sign-in sequence above); the **bodies** are hypotheses
from earlier seasons. Every upload keeps the field names it saw (`shape`, never values) and Gaffer Bot's My Account page
shows them, so the first real capture confirms or corrects this. Personal ids (persona id, Nucleus id, seller names)
are never kept.

| Answer | When it loads | What the helper keeps |
| --- | --- | --- |
| `GET …/usermassinfo` | Sign-in | `userInfo`: club name and abbreviation, persona name, established, won / loss / draw, trophies, divisions, unopened packs, unassigned count, `credits` + `currencies[] { name, funds, finalFunds }`; pile capacities from `pileSizeClientData.entries[] { key, value }` (2 = transfer list, 4 = watchlist in earlier seasons) |
| `GET …/user/credits` | After the balance changes | `credits` and `currencies[]`: coins, FC Points, draft tokens and any other currency by EA's own name |
| `GET …/tradepile` | Sign-in, Transfer List | `auctionInfo[]`: `tradeId`, `tradeState` (active / closed = sold / expired / null = unlisted), `buyNowPrice`, `startingBid`, `currentBid`, `expires` (seconds left), item ids, rating, untradeable; `credits` |
| `GET …/watchlist` | Sign-in, Transfer Targets | Same, plus `bidState` (highest / outbid) for winning, outbid, won and lost |
| `GET …/purchased/items` | Sign-in, after packs | `itemData[]` and `duplicateItemIdList[] { itemId }` |
| `GET …/sbs/sets` | Opening SBCs | `categories[] { name, sets[] { setId, name, challengesCount, challengesCompletedCount, timesCompleted, repeatabilityMode, repeats, endTime, hidden, awards[] { type, value, count, untradeable } } }` |
| `GET …/sbs/setId/<id>/challenges` | Opening one SBC set | `challenges[] { challengeId, name, description, formation, status, elgOperation, elgReq[] { type, eligibilityValue(s), eligibilitySlot, count, scope }, awards[] }` (UNVERIFIED on FC 27; the helper keeps the field names it sees as `shape.sbc_challenge` / `shape.sbc_requirement`) |
| `GET …/academy/…` (hub, slot pages) | Opening Evolutions | Evolutions as earlier seasons named them (academy). FC 27 body UNVERIFIED: the helper reads any object with an id, a name and requirement-like (`eligibility…`/`requirements`) or level-like (`levels`/`stages`) lists, keeping entries as EA named them; field names kept as `shape.evolution*` |
| `GET …/scmp/campaign…` | Opening Objectives | Layout unknown: any object with a name and a progress / target pair (`progress`/`target`, `currentValue`/`targetValue`, …) counts as one objective, grouped under its nearest named parent, with `xp` and end time when present |
| `GET …/scmp/data/lite`, `fcas…/fc/user/season/lite` | Sign-in | Numeric fields named like level / XP / tier / points / rank from the top two levels |

`src/account/capture.ts` reads all of this. The helper never lists, bids, buys, claims or submits anything.
