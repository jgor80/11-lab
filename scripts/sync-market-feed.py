#!/usr/bin/env python3
"""Cache fc27-market prices without EA credentials or third-party packages."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen

URL = "https://fc27-market.val.run/latest"
SOURCE = "fc27_market"
MAX_BYTES = 8 * 1024 * 1024


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Missing source update timestamp")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Source timestamp must include a timezone")
    return result.astimezone(timezone.utc)


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def normalize(payload, now):
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object")
    observed = timestamp(payload.get("updated"))
    if observed > now + timedelta(minutes=10):
        raise ValueError("Source update timestamp is in the future")
    groups = payload.get("groups")
    if not isinstance(groups, dict) or not groups:
        raise ValueError("No price groups returned")
    cards = {}
    counts = {}
    for group, entries in groups.items():
        if not isinstance(entries, list):
            raise ValueError("Invalid price group")
        counts[group] = len(entries)
        for row in entries:
            if not isinstance(row, dict):
                raise ValueError("Invalid card row")
            item, price = row.get("eaId"), row.get("price")
            if type(item) is not int or item <= 0 or type(price) is not int or price <= 0:
                raise ValueError("Card rows must have a positive integer EA item ID and price")
            if item in cards:
                if cards[item]["price"] != price:
                    raise ValueError("Conflicting prices for the same EA item ID")
                if group not in cards[item]["groups"]:
                    cards[item]["groups"].append(group)
                continue
            cards[item] = {
                "ea_item_id": item, "price": price, "name": row.get("name"),
                "rating": row.get("rating"), "rarity_id": row.get("rarityId"), "groups": [group],
            }
    if not cards:
        raise ValueError("No prices returned; keeping the previous snapshot")
    age = max(0, (now - observed).total_seconds() / 3600)
    return {
        "source": SOURCE, "source_url": URL, "observed_at": iso(observed), "received_at": iso(now),
        "platform": "unknown", "evidence": "estimate", "age_hours": round(age, 2), "stale": age > 12,
        "card_count": len(cards), "group_counts": counts,
        "coverage": "Only the cards returned by this source; not the full FUT catalogue",
        "cards": sorted(cards.values(), key=lambda row: row["ea_item_id"]),
    }


def atomic_json(path, value):
    temp = path.with_name(path.name + f".{os.getpid()}.tmp")
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def save_snapshot(folder, snapshot):
    folder.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(folder / "prices.sqlite") as db:
        db.execute("""CREATE TABLE IF NOT EXISTS feed_prices (
            source TEXT NOT NULL, ea_item_id INTEGER NOT NULL, observed_at TEXT NOT NULL,
            received_at TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0),
            platform TEXT NOT NULL, card_json TEXT NOT NULL,
            PRIMARY KEY(source, ea_item_id, observed_at))""")
        latest = db.execute("SELECT MAX(observed_at) FROM feed_prices WHERE source = ?", (SOURCE,)).fetchone()[0]
        if latest and timestamp(latest) > timestamp(snapshot["observed_at"]):
            raise ValueError("Source returned an older snapshot; keeping the newer cached prices")
        existing = dict(db.execute("SELECT ea_item_id, price FROM feed_prices WHERE source = ? AND observed_at = ?",
                                   (SOURCE, snapshot["observed_at"])))
        if any(row["ea_item_id"] in existing and existing[row["ea_item_id"]] != row["price"] for row in snapshot["cards"]):
            raise ValueError("Source changed a price without updating its timestamp; keeping the cached prices")
        before = db.total_changes
        db.executemany("INSERT OR IGNORE INTO feed_prices VALUES (?, ?, ?, ?, ?, ?, ?)", [
            (SOURCE, row["ea_item_id"], snapshot["observed_at"], snapshot["received_at"],
             row["price"], "unknown", json.dumps(row, ensure_ascii=False)) for row in snapshot["cards"]
        ])
        inserted = db.total_changes - before
    atomic_json(folder / "latest.json", snapshot)
    return inserted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/raw/fc27-market"))
    parser.add_argument("--input", type=Path, help="Import a previously downloaded JSON snapshot instead of making a request")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    try:
        if args.input:
            if args.input.stat().st_size > MAX_BYTES:
                raise ValueError("Snapshot is too large")
            body = args.input.read_bytes()
        else:
            request = Request(URL, headers={"Accept": "application/json", "User-Agent": "XI-Lab-Market-Collector/1.0"})
            # urllib honours the host's proxy settings and verifies TLS. Never retry a rejected request.
            with urlopen(request, timeout=30) as response:
                body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError("Snapshot is too large")
        snapshot = normalize(json.loads(body), now)
        inserted = save_snapshot(args.output, snapshot)
        report = {k: snapshot[k] for k in ("observed_at", "received_at", "card_count", "platform", "age_hours", "stale")}
        report.update(status="succeeded", inserted=inserted)
        atomic_json(args.output / "status.json", report)
        print(json.dumps(report))
        return 0
    except Exception as error:
        # Keep last successful data intact and make a failed attempt visible to monitoring/systemd.
        report = {"status": "failed", "attempted_at": iso(now), "error": str(error)}
        atomic_json(args.output / "status.json", report)
        print(json.dumps(report), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
