#!/bin/bash
# RubriQ Analytics — Hostinger Deployment Script
# Usage: bash deploy.sh
# Run from: ~/domains/rubriq.swapnilgorde.com/nodejs

set -e

export PATH="/opt/alt/alt-nodejs18/root/usr/bin:$PATH"
export DATABASE_URL='mysql://u377360944_gordeswapnil:RubriqApp2026@srv2206.hstgr.io:3306/u377360944_Rubriqapp'

BRANCH="claude/rubriQ-analytics-phase-1-e2Zi6"
BASE="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$BASE/rubriq-analytics/server"
CLIENT="$BASE/rubriq-analytics/client"

echo "==> Restoring git working tree..."
cd "$BASE"
git fetch origin "$BRANCH"
git checkout -f "$BRANCH" 2>/dev/null || true
git reset --hard "origin/$BRANCH"

echo "==> Installing server dependencies..."
cd "$SERVER"
npm install
chmod +x node_modules/.bin/prisma 2>/dev/null || true
chmod +x node_modules/@prisma/engines/* 2>/dev/null || true
chmod +x node_modules/.bin/node-pre-gyp 2>/dev/null || true

echo "==> Generating Prisma client..."
npx prisma generate || echo "⚠ Prisma generate failed"

echo "==> Running database migration..."
npx prisma db push || echo "⚠ DB migration failed (skipping — run manually if schema changed)"

echo "==> Installing client dependencies..."
cd "$CLIENT"
npm install
chmod +x node_modules/.bin/vite 2>/dev/null || true
chmod +x node_modules/@esbuild/linux-x64/bin/esbuild 2>/dev/null || true

echo "==> Building frontend..."
npm run build

echo ""
echo "✔ Deploy complete. Restart the Node.js app from hPanel."
