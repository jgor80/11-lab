import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("collector", Path(__file__).parents[1] / "scripts/sync-market-feed.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class MarketFeedTests(unittest.TestCase):
    now = datetime(2026, 11, 8, 6, tzinfo=timezone.utc)

    def payload(self):
        return {"updated": "2026-11-08T05:00:00Z", "groups": {
            "gold": [{"eaId": i, "price": 1000 + i, "forecast": [900], "signal": "buy"} for i in range(1, 151)]
        }}

    def test_retains_all_cards_without_guessing_platform_or_using_forecasts(self):
        snap = collector.normalize(self.payload(), self.now)
        self.assertEqual(snap["card_count"], 150)
        self.assertEqual(snap["platform"], "unknown")
        self.assertFalse(snap["stale"])
        self.assertNotIn("forecast", snap["cards"][0])
        self.assertEqual(snap["cards"][0]["price"], 1001)

    def test_repeat_fetch_does_not_duplicate_history_or_refresh_source_timestamp(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            snap = collector.normalize(self.payload(), self.now)
            self.assertEqual(collector.save_snapshot(folder, snap), 150)
            late = datetime(2026, 11, 9, 6, tzinfo=timezone.utc)
            same = collector.normalize(self.payload(), late)
            self.assertTrue(same["stale"])
            self.assertEqual(collector.save_snapshot(folder, same), 0)
            self.assertEqual(json.loads((folder / "latest.json").read_text())["observed_at"], snap["observed_at"])
            with sqlite3.connect(folder / "prices.sqlite") as db:
                self.assertEqual(db.execute("SELECT count(*) FROM feed_prices").fetchone()[0], 150)

    def test_rejects_regressing_snapshot_without_overwriting_latest(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            collector.save_snapshot(folder, collector.normalize(self.payload(), self.now))
            before = (folder / "latest.json").read_bytes()
            old = self.payload()
            old["updated"] = "2026-11-07T05:00:00Z"
            with self.assertRaisesRegex(ValueError, "older snapshot"):
                collector.save_snapshot(folder, collector.normalize(old, self.now))
            self.assertEqual((folder / "latest.json").read_bytes(), before)

    def test_empty_invalid_and_conflicting_rows_are_not_silently_imported(self):
        for value in ({}, {"updated": "2026-11-08T05:00:00Z", "groups": {"gold": []}},
                      {"updated": "2026-11-08T05:00:00Z", "groups": {"gold": [{"eaId": 1, "price": -1}]}}):
            with self.assertRaises(ValueError):
                collector.normalize(value, self.now)
        value = self.payload()
        value["groups"]["special"] = [{"eaId": 1, "price": 9999}]
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            collector.normalize(value, self.now)

    def test_changed_price_requires_a_new_provider_timestamp(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            collector.save_snapshot(folder, collector.normalize(self.payload(), self.now))
            before = (folder / "latest.json").read_bytes()
            changed = self.payload()
            changed["groups"]["gold"][0]["price"] = 5000
            with self.assertRaisesRegex(ValueError, "without updating"):
                collector.save_snapshot(folder, collector.normalize(changed, self.now))
            self.assertEqual((folder / "latest.json").read_bytes(), before)

    def test_failed_request_preserves_last_success_and_reports_failure_without_retries(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            collector.save_snapshot(folder, collector.normalize(self.payload(), self.now))
            before = (folder / "latest.json").read_bytes()
            with patch.object(collector, "urlopen", side_effect=OSError("network unavailable")) as request, \
                 patch("sys.argv", ["sync-market-feed.py", "--output", temp]):
                self.assertEqual(collector.main(), 1)
            self.assertEqual(request.call_count, 1)
            self.assertEqual((folder / "latest.json").read_bytes(), before)
            self.assertEqual(json.loads((folder / "status.json").read_text())["status"], "failed")


if __name__ == "__main__":
    unittest.main()
