#!/bin/bash
# Rekindle scenario grid as a Slurm job array (Alliance clusters, e.g. Fir / Nibi).
#
#   cd $REPO && sbatch --account=def-XXXX --array=0-61 scripts/slurm/rekindle_grid.sh chilecito-2026
#
# Each array task runs shard K/N of the grid (N = array size) on one core; finished runs are
# skipped, so a resubmit resumes. Inputs: data/rekindle/<fire>/{domain.npz,meta.json,
# calibration.json,baseline.npy} copied from the desktop; outputs data/rekindle/<fire>/runs/*.npy
# (copy back to the desktop and run `rekindle.export` there). No internet needed on the nodes.
# Env: REKINDLE_VENV = venv built on the login node (numpy, scipy, scikit-fmm, pyyaml).
# Extra grid options (e.g. --moisture-axis 4,6,10,14) go in GRID_ARGS.
#SBATCH --job-name=rk-grid
#SBATCH --cpus-per-task=1
#SBATCH --mem=2G
#SBATCH --time=01:30:00
#SBATCH --output=logs/rk-grid-%A_%a.out
set -euo pipefail
FIRE=${1:?fire id}
N=${SLURM_ARRAY_TASK_COUNT:?run as an array job}
K=${SLURM_ARRAY_TASK_ID}
module load StdEnv/2023 python/3.12 >/dev/null 2>&1 || true
source "${REKINDLE_VENV:?set REKINDLE_VENV}/bin/activate"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
python -m rekindle.scenario_grid --fire "$FIRE" --workers 1 --shard "$K/$N" ${GRID_ARGS:-}
