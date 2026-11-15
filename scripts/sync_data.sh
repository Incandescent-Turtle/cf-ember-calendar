#!/usr/bin/env bash
# Upload processed data to the data host: a public Hugging Face dataset repo.
#
#   HF_DATASET_REPO=<user>/ember-calendar-data scripts/sync_data.sh [DATA_DIR] [--no-points] [--points-from YEAR]
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
while [ $# -gt 0 ]; do
  case "$1" in
    --no-points) POINTS=0 ;;
    --points-from) FROM_YEAR="$2"; shift ;;
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

hf repos create "$REPO" --repo-type dataset --public --exist-ok >/dev/null

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
  --include "manifest.json" --include "calibration.json" --include "validation.json" \
  --include "cube/**" --commit-message "cubes and json $(date -u +%Y-%m-%dT%H:%MZ)" --format quiet

BASE="https://huggingface.co/datasets/$REPO/resolve/main"
echo "VITE_DATA_BASE_URL=$BASE"

# smoke test: CORS + Range on a cube and the manifest
scripts/check_host.sh "$BASE"
