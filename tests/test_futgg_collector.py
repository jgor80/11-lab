import copy
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("futgg", Path(__file__).parents[1] / "scripts/sync-futgg-prices.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class FutggTests(unittest.TestCase):
    now = datetime(2026, 11, 8, 6, tzinfo=timezone.utc)
    published = int(now.timestamp()) - 3600
    index = {"v": 2, "id0": 100, "d": [10, 20, 30]}
    blob = {"v": 2, "p": [900, 0, 5000, 0], "s": [0, 0, 1, 2]}

    def fixture_fetch(self):
        calls = []
        manifest = {"_version": 1, "player-prices-index": "aa", "player-prices-ps5-dyn": "bb", "player-prices-pc-dyn": "cc",
                    "_published_at": {name: self.published for name in collector.PLATFORMS.values()}}
        def fetch(url):
            calls.append(url)
            if url.endswith("manifest.json"):
                return manifest
            return self.index if "index." in url else self.blob
        return fetch, calls

    def test_decodes_exact_card_ids_and_keeps_sbc_costs_out_of_market_prices(self):
        result = collector.decode(self.index, self.blob, self.published, "console", self.now)
        self.assertEqual([c["ea_item_id"] for c in result["cards"]], [100, 110, 130, 160])
        self.assertEqual([c["price"] for c in result["cards"]], [900, None, None, None])
        self.assertEqual(result["cards"][2]["provider_value"], 5000)
        self.assertEqual(result["market_price_count"], 1)

    def test_follows_manifest_for_both_platforms_with_only_four_public_requests(self):
        fetch, calls = self.fixture_fetch()
        bundle, raw = collector.collect(27, self.now, fetch)
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(u.startswith("https://r2.fut.gg/27/") for u in calls))
        self.assertTrue(calls[-1].endswith("player-prices-pc-dyn.v1.cc.json"))
        self.assertEqual(set(bundle["platforms"]), {"console", "pc"})
        self.assertEqual(len(raw), 4)

    def test_rejects_misaligned_indices_and_unsupported_versions(self):
        for key, value in [("v", 99), ("p", [900]), ("s", [0])]:
            blob = {**self.blob, key: value}
            with self.assertRaises(ValueError):
                collector.decode(self.index, blob, self.published, "pc", self.now)
        with self.assertRaises(ValueError):
            collector.decode({**self.index, "d": [10, 0, 30]}, self.blob, self.published, "pc", self.now)

    def test_stale_publication_is_not_disguised_as_a_fresh_card_observation(self):
        result = collector.decode(self.index, self.blob, self.published - 86400, "pc", self.now)
        self.assertTrue(result["stale"])
        self.assertNotIn("observed_at", result["cards"][0])

    def test_repeat_collection_is_idempotent_and_platform_histories_are_separate(self):
        fetch, _ = self.fixture_fetch()
        bundle, raw = collector.collect(27, self.now, fetch)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            self.assertEqual(collector.save(folder, bundle, raw), 8)
            self.assertEqual(collector.save(folder, bundle, raw), 0)
            with sqlite3.connect(folder / "prices.sqlite") as db:
                self.assertEqual(db.execute("SELECT platform, COUNT(*) FROM futgg_prices GROUP BY platform ORDER BY platform").fetchall(), [("console", 4), ("pc", 4)])
                self.assertEqual(db.execute("SELECT COUNT(*) FROM futgg_prices WHERE price IS NOT NULL").fetchone()[0], 2)

    def test_invalid_second_platform_cannot_overwrite_either_cached_platform(self):
        fetch, _ = self.fixture_fetch()
        bundle, raw = collector.collect(27, self.now, fetch)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            collector.save(folder, bundle, raw)
            before = (folder / "latest.json").read_bytes()
            changed = copy.deepcopy(bundle)
            changed["platforms"]["console"]["cards"][0]["price"] = 1000
            changed["platforms"]["pc"]["snapshot_published_at"] = "2026-11-07T05:00:00Z"
            with self.assertRaises(ValueError):
                collector.save(folder, changed, raw)
            self.assertEqual((folder / "latest.json").read_bytes(), before)

    def test_access_denial_stops_without_retries_or_alternate_routes(self):
        calls = []
        def denied(url):
            calls.append(url)
            raise OSError("403 access denied")
        with self.assertRaisesRegex(OSError, "403"):
            collector.collect(27, self.now, denied)
        self.assertEqual(calls, ["https://r2.fut.gg/27/manifest.json"])


if __name__ == "__main__":
    unittest.main()
