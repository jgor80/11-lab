# FC 27 data sources: what we can use

Checked 2026-11-02. The rule from the brief: no scraping of protected data and no made-up data.
Each source below is a row in `data_sources`, and the importer enforces its `terms_status`.

| Source | What it has | Terms | Status |
| --- | --- | --- | --- |
| Manual entry from your own game | Anything you can see in-game: every card version, PlayStyles+, Role+/++ | None | **approved** |
| [Kaggle: EA SPORTS FC 27 Player Ratings (MikeDPad)](https://www.kaggle.com/datasets/mikedpad/ea-sports-fc27-player-ratings) | 19,789 launch base items (17,849 men, 1,940 women), 60 columns: positions, club/league/nation, all face stats and sub-attributes, PlayStyles, SM/WF, height, foot. Snapshot 2026-09-12, v4 updated 2026-09-14 | Licence "Other". Says the data is from EA's public ratings feed, belongs to EA, unofficial and non-commercial | **pending_review** (your call) |
| [ea.com FC 27 Ratings](https://www.ea.com/games/ea-sports-fc/ratings) | Same launch gold/silver/bronze items. Excludes Icons, Heroes, promos; not updated for live changes | No reuse licence. EA User Agreement s.2: non-commercial use only, no copying or extracting data unless authorised | **blocked** (pulling its feed is scraping) |
| [EA FC Community API](https://help.ea.com/en/articles/ea-sports-fc/community-api/) | Official: your club's players, formations, tactics, via EA login | Only FUTBIN, FUT.GG and FUTWIZ are partners; EA is "not accepting requests at this time" | **blocked** until EA opens it |
| FUTBIN / FUT.GG / FUTWIZ | Everything incl. promos and prices | No public API or data licence | **blocked** (scraping) |

## What no legitimate source gives us yet

- **Promo / special cards** (TOTW, Icons, Heroes, Evos): only from manual entry.
- **Role+ and Role++ familiarity**: only from manual entry.
- **Market prices**: no source. `market_prices` stays empty.
- **Chemistry rules**: community numbers, stored as the `fc27-community-v0` rule version marked `unverified`.

## The Kaggle decision

The dataset is EA's own launch data, so the numbers are real. The risk is permission, not accuracy: EA owns
the data and hasn't licensed it, and the uploader calls it non-commercial. Using it for a private build
that we test against is low risk. Shipping it in a public or paid app is where EA's terms bite.
If you accept, download the CSV from Kaggle (needs a free login) into `data/raw/` and run the import with
`--accept-terms "<your name>"`; the decision is stored on the import run.
