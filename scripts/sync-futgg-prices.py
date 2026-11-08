#!/usr/bin/env python3
"""Download FUT.GG's public bulk price snapshots; no login or dependencies required."""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from urllib.request import Request, urlopen

BASE = "https://r2.fut.gg"
MAX_BYTES = 8 * 1024 * 1024
PLATFORMS = {"console": "player-prices-ps5-dyn", "pc": "player-prices-pc-dyn"}


def iso(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def file_name(manifest, name):
    version, digest = manifest.get("_version"), manifest.get(name)
    if type(version) is not int or version < 1 or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]+", digest):
        raise ValueError("Invalid manifest entry for " + name)
    return f"{name}.v{version}.{digest}.json"


def get_json(url):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "XI-Lab-Market-Collector/1.0"})
    # Honour the machine's normal proxy/TLS configuration. No credentials, challenge solving or retries.
    with urlopen(request, timeout=25) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("Price snapshot is too large")
    return json.loads(data)


def decode(index, blob, published, platform, now):
    if not isinstance(index, dict) or not isinstance(blob, dict) or index.get("v") != 2 or blob.get("v") != 2:
        raise ValueError("Unsupported price format; expected version 2")
    if type(published) is not int or published <= 0:
        raise ValueError("Missing dataset publication timestamp")
    published_at = datetime.fromtimestamp(published, timezone.utc)
    if published_at > now + timedelta(minutes=10):
        raise ValueError("Dataset publication timestamp is in the future")
    first, deltas, prices, statuses = index.get("id0"), index.get("d"), blob.get("p"), blob.get("s")
    if type(first) is not int or first <= 0 or not all(isinstance(v, list) for v in (deltas, prices, statuses)):
        raise ValueError("Invalid price index or arrays")
    if not prices or len(prices) != len(deltas) + 1 or len(statuses) != len(prices):
        raise ValueError("Price blob/index length mismatch")
    ids = [first]
    for delta in deltas:
        if type(delta) is not int or delta <= 0:
            raise ValueError("Card ID deltas must be positive integers")
        ids.append(ids[-1] + delta)
    cards = []
    for item, price, status in zip(ids, prices, statuses):
        if type(status) is not int or status not in (0, 1, 2, 3, 4):
            raise ValueError("Unsupported card price status")
        if price is not None and (type(price) is not int or price < 0):
            raise ValueError("Invalid price")
        # FUT.GG uses status 1 for SBC costs and 2 for objectives. Those are not market quotes.
        cards.append({"ea_item_id": item, "price": price if status == 0 and price else None,
                      "status_code": status, "provider_value": price})
    age = max(0, (now - published_at).total_seconds() / 3600)
    return {"platform": platform, "snapshot_published_at": iso(published_at),
            "age_hours": round(age, 2), "stale": age > 12,
            "card_count": len(cards), "market_price_count": sum(c["price"] is not None for c in cards),
            "cards": cards}


def atomic_json(path, value):
    temp = path.with_name(path.name + f".{os.getpid()}.tmp")
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def collect(year, now, fetch=get_json):
    if not 20 <= year <= 99:
        raise ValueError("Game year must be between 20 and 99")
    base = f"{BASE}/{year}"
    manifest = fetch(f"{base}/manifest.json")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("_published_at"), dict):
        raise ValueError("Invalid dataset manifest")
    index_name = file_name(manifest, "player-prices-index")
    index = fetch(f"{base}/{index_name}")
    raw = {"manifest": manifest, "player-prices-index": index}
    snapshots, urls = {}, {"manifest": f"{base}/manifest.json", "index": f"{base}/{index_name}"}
    for platform, name in PLATFORMS.items():
        url = f"{base}/{file_name(manifest, name)}"
        blob = fetch(url)
        raw[name] = blob
        snapshots[platform] = decode(index, blob, manifest["_published_at"].get(name), platform, now)
        urls[platform] = url
    bundle = {"source": "futgg", "game_year": year, "received_at": iso(now), "source_urls": urls,
              "evidence": "third_party_estimate", "platforms": snapshots,
              "note": "All entries in the downloaded files, not guaranteed all FUT cards. Dataset publication time is not a per-card quote timestamp."}
    return bundle, raw


def save(folder, bundle, raw):
    folder.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(folder / "prices.sqlite") as db:
        db.execute("""CREATE TABLE IF NOT EXISTS futgg_prices (
            game_year INTEGER NOT NULL, platform TEXT NOT NULL, ea_item_id INTEGER NOT NULL,
            snapshot_published_at TEXT NOT NULL, received_at TEXT NOT NULL, price INTEGER,
            status_code INTEGER NOT NULL, provider_value INTEGER,
            PRIMARY KEY (game_year, platform, ea_item_id, snapshot_published_at))""")
        for platform, snapshot in bundle["platforms"].items():
            latest = db.execute("SELECT MAX(snapshot_published_at) FROM futgg_prices WHERE game_year=? AND platform=?",
                                (bundle["game_year"], platform)).fetchone()[0]
            if latest and latest > snapshot["snapshot_published_at"]:
                raise ValueError("Received an older snapshot; keeping cached prices")
            existing = {r[0]: (r[1], r[2], r[3]) for r in db.execute(
                "SELECT ea_item_id, price, status_code, provider_value FROM futgg_prices WHERE game_year=? AND platform=? AND snapshot_published_at=?",
                (bundle["game_year"], platform, snapshot["snapshot_published_at"]))}
            if any(c["ea_item_id"] in existing and existing[c["ea_item_id"]] != (c["price"], c["status_code"], c["provider_value"]) for c in snapshot["cards"]):
                raise ValueError("Source changed prices without updating its publication timestamp")
        before = db.total_changes
        for platform, snapshot in bundle["platforms"].items():
            db.executemany("INSERT OR IGNORE INTO futgg_prices VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
                (bundle["game_year"], platform, c["ea_item_id"], snapshot["snapshot_published_at"],
                 bundle["received_at"], c["price"], c["status_code"], c["provider_value"]) for c in snapshot["cards"]
            ])
        inserted = db.total_changes - before
    atomic_json(folder / "raw.json", raw)
    atomic_json(folder / "latest.json", bundle)
    return inserted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/raw/futgg"))
    parser.add_argument("--year", type=int, default=27)
    parser.add_argument("--input-directory", type=Path, help="Offline test folder with manifest.json and its referenced files")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / ".collector.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("A price collector is already running.", file=sys.stderr)
            return 1
        try:
            fetch = get_json
            if args.input_directory:
                fetch = lambda url: json.loads((args.input_directory / url.rsplit("/", 1)[1]).read_text())
            bundle, raw = collect(args.year, datetime.now(timezone.utc), fetch)
            inserted = save(args.output, bundle, raw)
            report = {"status": "succeeded", "received_at": bundle["received_at"], "inserted": inserted,
                      "platforms": {k: {n: v[n] for n in ("snapshot_published_at", "card_count", "market_price_count", "age_hours", "stale")}
                                    for k, v in bundle["platforms"].items()}}
            atomic_json(args.output / "status.json", report)
            print(json.dumps(report))
            return 0
        except Exception as error:
            report = {"status": "failed", "attempted_at": iso(datetime.now(timezone.utc)), "error": str(error)}
            atomic_json(args.output / "status.json", report)
            print(json.dumps(report), file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(main())
