#!/usr/bin/env python3
"""WorldView Pre-processor — crunches capture SQLite → playback JSON + PNG frames.

Usage:
  python capture/preprocess.py data/captures/event.db --slug iran-strike-2026-03-01
  python capture/preprocess.py data/captures/event.db --slug test --title "Test Capture"
"""

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone

try:
    from PIL import Image
except ImportError:
    Image = None
    print("[preprocess] WARNING: Pillow not installed — jamming PNGs will be skipped")


# ── Config ──────────────────────────────────────────────────────────────────

FRAME_INTERVAL_S = 60      # 1 frame per minute
JAMMING_W = 360            # longitude pixels
JAMMING_H = 180            # latitude pixels
REPLAY_DIR = "data/replays"

# Military identification: db_flags bit 0 = military, or squawk 7x00 patterns
MIL_SQUAWKS = {"7501", "7502", "7600", "7700"}


def is_military(hex_code, db_flags, squawk, category):
    """Heuristic: is this aircraft military?"""
    if db_flags and (db_flags & 1):
        return True
    if squawk in MIL_SQUAWKS:
        return True
    if category and category.startswith("A") and category >= "A5":
        return True  # Heavy aircraft categories
    return False


# ── Jamming Heatmap ─────────────────────────────────────────────────────────

def build_jamming_png(aircraft_rows, out_path):
    """Build a 360x180 PNG heatmap from NIC values.

    Pixel (x, y) maps to lon = x - 180, lat = 90 - y.
    Colors: green (NIC>=7), yellow (4-6), orange (1-3), red (0).
    """
    if Image is None:
        return

    # Accumulate NIC values per cell
    grid_count = [[0] * JAMMING_W for _ in range(JAMMING_H)]
    grid_nic_sum = [[0] * JAMMING_W for _ in range(JAMMING_H)]

    for row in aircraft_rows:
        lat, lon, nic = row
        if nic is None:
            continue
        x = int((lon + 180) % 360)
        y = int(90 - lat)
        x = max(0, min(JAMMING_W - 1, x))
        y = max(0, min(JAMMING_H - 1, y))
        grid_count[y][x] += 1
        grid_nic_sum[y][x] += nic

    # Convert to RGBA image
    img = Image.new("RGBA", (JAMMING_W, JAMMING_H), (0, 0, 0, 0))
    pixels = img.load()

    for y in range(JAMMING_H):
        for x in range(JAMMING_W):
            count = grid_count[y][x]
            if count == 0:
                continue
            avg_nic = grid_nic_sum[y][x] / count
            # Alpha scales with count (more aircraft = more confident)
            alpha = min(200, 40 + count * 20)

            if avg_nic >= 7:
                continue  # Good GPS — no heatmap needed
            elif avg_nic >= 4:
                pixels[x, y] = (255, 200, 0, alpha)      # Yellow
            elif avg_nic >= 1:
                pixels[x, y] = (255, 120, 0, alpha)      # Orange
            else:
                pixels[x, y] = (255, 30, 0, alpha)        # Red

    img.save(out_path, "PNG")


# ── Frame Generation ────────────────────────────────────────────────────────

def generate_frames(db, slug, start_ts, end_ts, out_dir):
    """Generate per-minute frame JSON + jamming PNGs."""
    frames_dir = os.path.join(out_dir, "frames")
    jamming_dir = os.path.join(out_dir, "jamming")
    os.makedirs(frames_dir, exist_ok=True)
    os.makedirs(jamming_dir, exist_ok=True)

    frame_count = 0
    ts = start_ts

    while ts <= end_ts:
        # Window: ts - 30s to ts + 30s (snap to nearest snapshot)
        window_start = ts - 30
        window_end = ts + 30

        # Aircraft for this frame
        ac_rows = db.execute(
            """SELECT hex, flight, lat, lon, alt_baro, gs, track, nic, nac_p, sil, category, db_flags, squawk
               FROM aircraft_snapshots
               WHERE ts BETWEEN ? AND ?
               GROUP BY hex
               HAVING ts = MAX(ts)""",
            (window_start, window_end),
        ).fetchall()

        # Vessels for this frame
        vessel_rows = db.execute(
            """SELECT mmsi, name, lat, lon, speed, course, heading, ship_type, status
               FROM ais_snapshots
               WHERE ts BETWEEN ? AND ?
               GROUP BY mmsi
               HAVING ts = MAX(ts)""",
            (window_start, window_end),
        ).fetchall()

        # Build frame JSON (compact array-of-arrays)
        ac_list = []
        for r in ac_rows:
            hex_code, flight, lat, lon, alt, gs, track, nic, nac_p, sil, cat, db_flags, squawk = r
            mil = 1 if is_military(hex_code, db_flags, squawk, cat) else 0
            ac_list.append([
                round(lon, 4),
                round(lat, 4),
                alt or 0,
                mil,
                nic if nic is not None else -1,
            ])

        vessel_list = []
        for r in vessel_rows:
            mmsi, name, lat, lon, speed, course, heading, ship_type, status = r
            vessel_list.append([
                round(lon, 4),
                round(lat, 4),
                ship_type or 0,
                round(speed, 1) if speed else 0,
                mmsi[:4] if mmsi else "",
            ])

        frame = {
            "t": ts * 1000,  # epoch ms
            "ac": ac_list,
            "vessels": vessel_list,
        }

        frame_file = os.path.join(frames_dir, f"{frame_count:06d}.json")
        with open(frame_file, "w") as f:
            json.dump(frame, f, separators=(",", ":"))

        # Build jamming PNG
        nic_rows = [(r[2], r[3], r[7]) for r in ac_rows]  # lat, lon, nic
        jamming_file = os.path.join(jamming_dir, f"{frame_count:06d}.png")
        build_jamming_png(nic_rows, jamming_file)

        frame_count += 1
        ts += FRAME_INTERVAL_S

        if frame_count % 60 == 0:
            print(f"  frame {frame_count}...")

    return frame_count


# ── TFR Export ──────────────────────────────────────────────────────────────

def export_tfr(db, start_ts, end_ts, out_dir):
    """Export the most recent TFR snapshot within the capture window."""
    airspace_dir = os.path.join(out_dir, "airspace")
    os.makedirs(airspace_dir, exist_ok=True)

    row = db.execute(
        "SELECT raw_geojson FROM tfr_snapshots WHERE ts BETWEEN ? AND ? ORDER BY ts DESC LIMIT 1",
        (start_ts, end_ts),
    ).fetchone()

    if row:
        with open(os.path.join(airspace_dir, "tfr.json"), "w") as f:
            f.write(row[0])
        print(f"  TFR exported ({len(row[0])} bytes)")
        return "airspace/tfr.json"
    else:
        print("  No TFR data found in capture window")
        return None


# ── Manifest ────────────────────────────────────────────────────────────────

def build_manifest(slug, title, start_ts, end_ts, frame_count, tfr_file):
    """Build the replay manifest."""
    return {
        "slug": slug,
        "title": title or slug.replace("-", " ").title(),
        "start_ms": start_ts * 1000,
        "end_ms": end_ts * 1000,
        "frame_count": frame_count,
        "frame_interval_min": FRAME_INTERVAL_S // 60,
        "correlation_passes": [],  # Populated manually or by sat correlation tool
        "tfr_file": tfr_file,
    }


def update_index(replay_dir, slug, manifest):
    """Update data/replays/index.json with this replay."""
    index_path = os.path.join(replay_dir, "index.json")
    if os.path.exists(index_path):
        with open(index_path) as f:
            index = json.load(f)
    else:
        index = {"replays": []}

    # Remove existing entry for this slug
    index["replays"] = [r for r in index["replays"] if r["slug"] != slug]

    # Add new entry
    index["replays"].append({
        "slug": slug,
        "title": manifest["title"],
        "start_ms": manifest["start_ms"],
        "end_ms": manifest["end_ms"],
        "frame_count": manifest["frame_count"],
    })

    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)

    print(f"  Updated {index_path}")


# ── Main ────────────────────────────────────────────────────────────────────

def main(db_path, slug, title):
    if not os.path.exists(db_path):
        print(f"[preprocess] Database not found: {db_path}")
        return

    db = sqlite3.connect(db_path)
    db.row_factory = None

    # Determine time range from data
    row = db.execute("SELECT MIN(ts), MAX(ts) FROM aircraft_snapshots").fetchone()
    if not row or row[0] is None:
        print("[preprocess] No aircraft data found in database")
        db.close()
        return

    start_ts, end_ts = row
    duration_min = (end_ts - start_ts) / 60
    print(f"[preprocess] Time range: {datetime.fromtimestamp(start_ts, tz=timezone.utc)} → "
          f"{datetime.fromtimestamp(end_ts, tz=timezone.utc)} ({duration_min:.0f} min)")

    # Count data
    ac_count = db.execute("SELECT COUNT(*) FROM aircraft_snapshots").fetchone()[0]
    ais_count = db.execute("SELECT COUNT(*) FROM ais_snapshots").fetchone()[0]
    tfr_count = db.execute("SELECT COUNT(*) FROM tfr_snapshots").fetchone()[0]
    print(f"[preprocess] Data: {ac_count} aircraft rows, {ais_count} vessel rows, {tfr_count} TFR snapshots")

    # Create output directory
    out_dir = os.path.join(REPLAY_DIR, slug)
    os.makedirs(out_dir, exist_ok=True)

    # Generate frames
    print(f"[preprocess] Generating frames...")
    frame_count = generate_frames(db, slug, start_ts, end_ts, out_dir)
    print(f"[preprocess] Generated {frame_count} frames")

    # Export TFR
    print(f"[preprocess] Exporting TFR data...")
    tfr_file = export_tfr(db, start_ts, end_ts, out_dir)

    # Build manifest
    manifest = build_manifest(slug, title, start_ts, end_ts, frame_count, tfr_file)
    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[preprocess] Manifest: {manifest_path}")

    # Update index
    update_index(REPLAY_DIR, slug, manifest)

    db.close()
    print(f"\n[preprocess] Done! Replay at: {out_dir}/")
    print(f"  {frame_count} frames, {frame_count} jamming PNGs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WorldView Pre-processor")
    parser.add_argument("db", help="SQLite database path")
    parser.add_argument("--slug", required=True, help="Event slug (URL-safe)")
    parser.add_argument("--title", default="", help="Human-readable title")
    args = parser.parse_args()
    main(args.db, args.slug, args.title)
