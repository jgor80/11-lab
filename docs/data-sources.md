# FC 27 data sources: what we can use

Checked 2026-11-02. Each source below is a row in `data_sources`, and the importer enforces its `terms_status`.

| Source | What it has | Terms | Status |
| --- | --- | --- | --- |
| Manual entry from your own game | Anything you can see in-game: every card version, PlayStyles+, Role+/++ | None | **approved** |
| [ea.com FC 27 Ratings](https://www.ea.com/games/ea-sports-fc/ratings) feed (`drop-api.ea.com`) | Launch gold/silver/bronze base items for men and women: positions, club/league/nation with EA ids, all 40 attributes, PlayStyles and PlayStyles+, SM/WF, foot, height, weight, birth date. No Icons, Heroes, promos, roles or prices | No reuse licence. EA User Agreement s.2: non-commercial use only. ea.com/robots.txt reserves rights against scraping and text/data mining | **approved** by Jeff on 2026-11-02 for the personal build. Snapshots stay out of this public repo |
| [Kaggle: EA SPORTS FC 27 Player Ratings (MikeDPad)](https://www.kaggle.com/datasets/mikedpad/ea-sports-fc27-player-ratings) | A 2026-09-14 snapshot of the same EA feed (19,789 items) | Licence "Other"; EA's data, non-commercial | pending_review (fallback only) |
| [EA FC Community API](https://help.ea.com/en/articles/ea-sports-fc/community-api/) | Official: your club's players, formations, tactics, via EA login | Only FUTBIN, FUT.GG and FUTWIZ are partners; EA is "not accepting requests at this time" | **blocked** until EA opens it |
| FUTBIN / FUT.GG / FUTWIZ | Everything incl. promos and prices | No public API or data licence | **blocked** |
| EA FUT Web App / Companion transfer market | Live prices | Needs your EA login; automating it risks a ban on your account | not used |

## What no source gives us yet

- **Promo / special cards** (TOTW, Icons, Heroes, Evos): only from manual entry.
- **Role+ and Role++ familiarity**: only from manual entry. The EA feed doesn't include roles.
- **Market prices**: no source. `market_prices` stays empty.
- **Chemistry rules**: community numbers, stored as the `fc27-community-v0` rule version marked `unverified`.

## EA ratings feed notes

These match what several public projects that use the feed report, and our own requests on 2026-11-02.

- Endpoint: `https://drop-api.ea.com/rating/ea-sports-fc?locale=en&limit=100&offset=N`. Response: `{ items: [...], totalItems }`.
- **Without the `drop-referrer: https://www.ea.com/games/ea-sports-fc/ratings` header the feed silently serves the
  previous season** (we got a list topped by Salah at 91 with `/FC25/` image paths, which doesn't match EA's FC 27
  top-27 article). The fetcher always sends it.
- EA's CDN caches by URL and ignores that header, so every request carries a random `cb` parameter.
- Page size is capped at 100, and `totalItems` is only reliable on the first page.
- `gender=1` filters to women; the unfiltered feed mixes men and women in rank order.
- PlayStyles are `playerAbilities` entries with `type.id` `playStyle` or `playStylePlus`.
- `preferredFoot`: 1 = right, 2 = left (inferred from known players; confirm on the first real pull).
- Stats are camelCase (`ballControl`) and map one to one onto `attribute_defs` (`ball_control`).

**How to check a pull is FC 27:** EA's [FC 27 top 27 article](https://www.ea.com/games/ea-sports-fc/fc-27/news/fc27-ratings-top-27)
says Mbappé and Haaland are the only men at 91, and Alexia Putellas tops the women at 91. The fetcher prints the
top 10 of the first page so this can be checked before anything is imported.
