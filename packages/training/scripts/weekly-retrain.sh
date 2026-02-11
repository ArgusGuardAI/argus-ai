#!/bin/bash
#
# Weekly Retraining Script
#
# Run this weekly (via cron or manually) to:
# 1. Collect new tokens from DexScreener
# 2. Label outcomes for tokens > 48h old
# 3. Find rugged tokens to balance the dataset
# 4. Retrain the BitNet model
# 5. Copy weights to production packages
#
# Usage:
#   ./weekly-retrain.sh
#
# Cron example (every Sunday at 3am):
#   0 3 * * 0 cd /path/to/training && ./weekly-retrain.sh >> /var/log/argus-retrain.log 2>&1
#

set -e

echo "=============================================="
echo "  ARGUS AI - Weekly Model Retraining"
echo "  $(date)"
echo "=============================================="
echo ""

cd "$(dirname "$0")/.."

echo "Step 1: Collect new tokens..."
npx tsx scripts/mass-collect.ts --mode=fetch
echo ""

echo "Step 2: Label outcomes (tokens > 48h old)..."
npx tsx scripts/mass-collect.ts --mode=outcomes
echo ""

echo "Step 3: Find rugged tokens..."
npx tsx scripts/find-rugs.ts
echo ""

echo "Step 4: Build training data..."
npx tsx scripts/mass-collect.ts --mode=build
echo ""

echo "Step 5: Show dataset statistics..."
npx tsx scripts/mass-collect.ts --mode=stats
echo ""

echo "Step 6: Retrain model..."
npx tsx scripts/train.ts --data ./data/training-large.jsonl --epochs 500 --lr 0.008
echo ""

echo "Step 7: Copy weights to packages..."
cp ../agents/src/reasoning/bitnet-weights.json ../workers/src/models/ 2>/dev/null || true
echo ""

echo "Step 8: Deploy updated Workers..."
cd ../workers
npx wrangler deploy
cd ../training
echo ""

echo "=============================================="
echo "  Retraining Complete!"
echo "  $(date)"
echo "=============================================="
