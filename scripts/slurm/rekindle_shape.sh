#!/bin/bash
# S6i shape calibration (13 ROS multipliers in parallel) for one fire.
#   sbatch --account=def-XXXX scripts/slurm/rekindle_shape.sh bc-2024
#SBATCH --job-name=rk-shape
#SBATCH --cpus-per-task=13
#SBATCH --mem=16G
#SBATCH --time=01:30:00
#SBATCH --output=logs/rk-shape-%j.out
set -euo pipefail
FIRE=${1:?fire id}
module load StdEnv/2023 python/3.12 >/dev/null 2>&1 || true
source "${REKINDLE_VENV:?set REKINDLE_VENV}/bin/activate"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 PYTHONIOENCODING=utf-8
python -u -m rekindle.calibrate_shape --fire "$FIRE" --workers 13
