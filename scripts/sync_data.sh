#!/usr/bin/env bash
# Upload processed data to the data host: a public Hugging Face dataset repo.
#
#   HF_DATASET_REPO=<user>/ember-calendar-data scripts/sync_data.sh [DATA_DIR] [--no-points] [--points-from YEAR]
#                                                                    [--exports DIR] [--exports-only]
#
# --exports DIR    also upload DIR (pipeline.export_global output) to exports/ and list it in
#                  manifest.exports.global_table (the Methodology page shows the download link then).
# --exports-only   with --exports: skip points, cubes and JSON; upload only exports/ and the manifest
#                  (manifest.points is kept as the build has it, so the build's points must be hosted).
#
# Needs `hf auth login` (or HF_TOKEN in the environment) first; the token never goes in the repo.
# Uploads manifest.json, calibration.json, validation.json and cube/** in one commit,
# then points/<tile>/<year>.parquet one commit per year (HF advises < 10k files per commit).
# The web reads from  https://huggingface.co/datasets/$HF_DATASET_REPO/resolve/main
# (set that as VITE_DATA_BASE_URL in the Pages project).
#
# Points go first and the manifest last, so the live manifest never lists missing files.
# If you skip points (or some years), manifest.points must say what is hosted (the map reads it).
set -euo pipefail

DATA_DIR="./data"
POINTS=1
FROM_YEAR=0
EXPORTS=""
EXPORTS_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-points) POINTS=0 ;;
    --points-from) FROM_YEAR="$2"; shift ;;
    --exports) EXPORTS="$2"; shift ;;
    --exports-only) EXPORTS_ONLY=1 ;;
    *) DATA_DIR="$1" ;;
  esac
  shift
done
REPO="${HF_DATASET_REPO:?set HF_DATASET_REPO=<user>/<dataset-name>}"
PROC="$DATA_DIR/processed"
[ -f "$PROC/manifest.json" ] || { echo "no $PROC/manifest.json" >&2; exit 1; }
for f in calibration.json validation.json; do
  [ -f "$PROC/$f" ] || { echo "missing $PROC/$f (run --steps calibrate,validate)" >&2; exit 1; }
done

if [ -n "$EXPORTS" ]; then
  [ -f "$EXPORTS/global_harmonized_monthly_1deg.parquet" ] || { echo "no global table in $EXPORTS (run pipeline.export_global)" >&2; exit 1; }
fi
if [ "$EXPORTS_ONLY" = 1 ]; then
  [ -n "$EXPORTS" ] || { echo "--exports-only needs --exports DIR" >&2; exit 1; }
  POINTS=2  # skip the points upload, keep manifest.points as built
fi

hf repos create "$REPO" --repo-type dataset --public --exist-ok >/dev/null

if [ -n "$EXPORTS" ]; then
  echo "exports"
  hf upload "$REPO" "$EXPORTS" exports --repo-type dataset     --include "global_harmonized_monthly_1deg.*" --include "README.md"     --commit-message "global harmonized table $(date -u +%Y-%m-%dT%H:%MZ)" --format quiet
fi

if [ "$POINTS" = 1 ] && [ -d "$PROC/points" ]; then
  years=$(find "$PROC/points" -name '*.parquet' | sed -E 's#.*/([0-9]{4})\.parquet#\1#' | sort -u)
  for y in $years; do
    [ "$y" -ge "$FROM_YEAR" ] || continue
    echo "points $y"
    hf upload "$REPO" "$PROC/points" points --repo-type dataset \
      --include "*/$y.parquet" --commit-message "points $y" --format quiet
  done
fi

echo "cubes + json"
hf upload "$REPO" "$PROC" . --repo-type dataset \
  --include "calibration.json" --include "validation.json" \
  --include "cube/**" --commit-message "cubes and json $(date -u +%Y-%m-%dT%H:%MZ)" --format quiet

# manifest last, with manifest.points describing what was actually uploaded
TMP=$(mktemp -d)
python - "$PROC/manifest.json" "$TMP/manifest.json" "$POINTS" "$FROM_YEAR" "$EXPORTS" <<'PY'
import json, os, sys
src, dst, points, from_year, exports = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
m = json.load(open(src, encoding="utf-8"))
p = m.get("points") or {}
if points == "2":
    pass  # --exports-only: points untouched, as built
elif points != "1" or not p.get("years"):
    m["points"] = {"years": [], "tiles": []}
elif from_year:
    m["points"]["years"] = [max(p["years"][0], from_year), p["years"][1]]
if exports:
    base = "global_harmonized_monthly_1deg"
    st = json.load(open(os.path.join(exports, base + ".stats.json"), encoding="utf-8"))
    m["exports"] = {"global_table": {
        "parquet": f"exports/{base}.parquet", "csv_gz": f"exports/{base}.csv.gz", "readme": "exports/README.md",
        "rows": st["rows"], "cells": st["cells"], "bytes": st["bytes"]}}
    print("manifest.exports.global_table =", m["exports"]["global_table"]["rows"], "rows")
json.dump(m, open(dst, "w", encoding="utf-8"), indent=2)
print("manifest.points =", m["points"]["years"], len(m["points"]["tiles"]), "tiles")
PY
echo "manifest"
hf upload "$REPO" "$TMP/manifest.json" manifest.json --repo-type dataset \
  --commit-message "manifest" --format quiet
rm -rf "$TMP"

BASE="https://huggingface.co/datasets/$REPO/resolve/main"
echo "VITE_DATA_BASE_URL=$BASE"

# smoke test: CORS + Range on a cube and the manifest
scripts/check_host.sh "$BASE"
