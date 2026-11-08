# Anonymous FUT.GG bulk price collector

`scripts/sync-futgg-prices.py` reads `https://r2.fut.gg/27/manifest.json` and resolves the current card index and
console/PC price files. Four public GETs per refresh: manifest, index, console prices and PC prices. It decodes
EA item IDs from the index rather than assuming array offsets are IDs. No EA account, browser, cookies,
residential proxy, challenge solver or npm packages are needed. Requires Python 3.8+ on Linux.

Live validation on November 8, 2026 returned 21,267 entries per platform, approximately 20,500 console market
prices and 20,200 PC market prices. Counts change. This is every entry in those files, not proof of coverage
of every FUT card. Anonymous access worked during validation; continued access, freshness and permission for
other uses are not guaranteed. This is third-party data, not a direct EA feed.

## Fetch once

Copy the standalone Python file onto your server and run:

```sh
python3 sync-futgg-prices.py --output ./market-prices
```

From this repository, run `python3 scripts/sync-futgg-prices.py` (defaults to git-ignored `data/raw/futgg`).
No Git checkout is needed on the server. The game year defaults to 27; use `--year` to select it explicitly.

- `latest.json`: both platforms, decoded IDs, nullable market prices, raw status codes and provider values,
  source URLs, receipt time, dataset publication time and coverage counts.
- `raw.json`: manifest, card index and both downloaded blobs for auditing/reprocessing.
- `prices.sqlite`: history in `futgg_prices`, keyed by game year, platform, EA item ID and publication time.
- `status.json`: latest attempt success/failure, per-platform counts and dataset freshness.

Dataset publication time is **not a last-update timestamp for each card**. Datasets over 12 hours old are marked
stale. Missing prices stay null. SBC costs and objective/reward values remain available as raw provider values
and status codes, but are excluded from market quotes and market-price counts. Repeated snapshots do not
duplicate history. Array/index mismatches, unsupported formats, invalid IDs/prices and empty responses stop
the run. Older datasets and changed prices under unchanged timestamps are rejected. Network/access failures
retain successful prices and exit nonzero, without retrying. A local lock prevents overlapping collectors.
TLS verification stays enabled; normal host proxy configuration is honoured.

## Twice-daily server installation

Copy **both** `scripts/sync-futgg-prices.py` and `scripts/install-market-timer.sh` into the same folder on your
Linux server. As root:

```sh
bash install-market-timer.sh
```

The installer puts the collector in `/opt/xilab-market`, installs a sandboxed systemd oneshot service and timer,
starts an initial fetch, and schedules **06:00 and 18:00 UTC**. Persistent timers catch up once after downtime;
there is no retry loop or parallel timer execution. Output goes to `/var/lib/xilab-market`.

```sh
systemctl list-timers xilab-market.timer --no-pager
systemctl status xilab-market.service --no-pager
journalctl -u xilab-market.service -n 20 --no-pager
cat /var/lib/xilab-market/status.json
```

Check both last-attempt success and dataset freshness: a successful download can still return stale data.
Stop scheduled collection with `systemctl disable --now xilab-market.timer`.

The installer does not connect this cache to the GafferBot website/database; that adapter needs the actual
deployment configuration. It has not been installed on the user's server by this PR. Live download validation
and service/timer syntax checks are separate from target-server installation and scheduled execution.

## Tests and offline replay

```sh
python3 -m unittest discover -s tests -p 'test_*collector.py'
```

Place `manifest.json` and its three referenced files in a directory, then replay with:
`python3 scripts/sync-futgg-prices.py --input-directory /path/to/files --output data/raw/futgg-replay`.

The separate `scripts/sync-market-feed.py` collector remains available for the older 589-card
`fc27-market.val.run` subset. Its `--input snapshot.json` option imports a downloaded response; it keeps platform
unknown and stores history in `feed_prices`. The systemd installer now uses the broader FUT.GG collector.
