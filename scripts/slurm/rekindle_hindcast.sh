#!/bin/bash
# Rekindle baseline sweep (9 ROS multipliers in parallel) for one model variant on a cluster node.
#
#   sbatch --account=def-XXXX scripts/slurm/rekindle_hindcast.sh chilecito-2026 s6b_AB --nonveg-max 50 --diurnal
#
# Args: fire id, variant tag ("" = the fire's baseline), then any rekindle.hindcast options.
# Outputs: data/rekindle/<fire>/variants/<tag>/ and docs/report/rekindle/<fire>_<tag>_* (copy back).
# Env: REKINDLE_VENV = venv built on the login node (numpy, scipy, scikit-fmm, pyyaml, matplotlib).
#SBATCH --job-name=rk-hindcast
#SBATCH --cpus-per-task=9
#SBATCH --mem=8G
#SBATCH --time=01:00:00
#SBATCH --output=logs/rk-hindcast-%j.out
set -euo pipefail
FIRE=${1:?fire id}
TAG=${2-}
shift 2
module load StdEnv/2023 python/3.12 >/dev/null 2>&1 || true
source "${REKINDLE_VENV:?set REKINDLE_VENV}/bin/activate"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 PYTHONIOENCODING=utf-8
python -u -m rekindle.hindcast --fire "$FIRE" --workers 9 ${TAG:+--tag "$TAG"} "$@"
