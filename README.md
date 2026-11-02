# XI Lab

A chemistry-aware FUT squad optimizer. This repo holds the **data layer** (schema for FC 27 Ultimate Team cards and an import pipeline that
tracks where every row came from) and the **chemistry engine**.

## What's here

- `migrations/`: SQLite schema, D1-compatible. Players vs. card versions, positions, attributes,
  PlayStyles/PlayStyles+, Role+/Role++ familiarity, clubs/leagues/nations, market prices (empty),
  versioned chemistry rules, and provenance (`data_sources`, `import_runs`, `import_rejections`).
- `src/import/`: one normalized `CardRecord` shape, adapters that produce it, and a writer that
  upserts it idempotently. Unknown positions or attributes reject the row with a reason; nothing is
  dropped silently.
- `docs/data-sources.md`: which FC 27 sources are legitimately usable and why.

Every card carries an evidence label (`verified`, `game_data`, `estimate`, `hypothesis`), its source,
the import run, and timestamps.

The chemistry thresholds are seeded as rule version `fc27-community-v0`, **unverified**. They are rows,
not code, so they can be corrected without a release.

## Chemistry engine

`src/chemistry/` is the deterministic, versioned chemistry engine: per-player club/league/nation
breakdown, links needed for the next point, manager and Icon/Hero rules, and swap previews showing who
gains or loses. Pure TypeScript, no DB. See `docs/chemistry-engine.md`.

## Use it

```sh
npm install
npm test
npm run import -- --list                                   # adapters + each source's terms status

# EA's FC 27 ratings feed: download a snapshot (~200 polite requests), then import it
npm run fetch:ea                                           # -> data/raw/ea-ratings/<date>/
npm run import -- --adapter ea-ratings --file data/raw/ea-ratings/<date>

# Cards you enter yourself
npm run import -- --adapter manual --file data/manual/my-club.csv
```

`data/raw/` is git-ignored: this repo is public and the card data belongs to EA, so snapshots and the
database stay on the machine that runs the import. See `docs/data-sources.md` before adding a source.

Data lands in `xi-lab.sqlite`. For Cloudflare D1:

```sh
npx wrangler d1 create xi-lab
npx wrangler d1 migrations apply xi-lab --remote
npm run export:d1 && npx wrangler d1 execute xi-lab --remote --file out/d1-data.sql
```

Manual entry: copy `data/manual/cards.template.csv`. Multi-value cells use `|`. A trailing `+` marks
PlayStyle+ (`Intercept+|Anticipate`). Roles are `POS:Role+` or `POS:Role++` (`CDM:Holding++`).
Any extra column named after an `attribute_defs.key` (e.g. `sliding_tackle`) is read as that attribute.

Requires Node 22.13+ (uses the built-in `node:sqlite`).
