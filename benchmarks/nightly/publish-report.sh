#!/bin/bash
set -Eeuo pipefail
export PATH=/opt/rank-bench-node/bin:/usr/local/bin:/usr/bin:/bin
BASE=${RANK_BENCH_BASE:-/srv/rank-bench}
timeout 30 node "$BASE/controller/render-latest.mjs" "$BASE/public"
timeout 45 rsync -az --no-owner --no-group --timeout=30 \
  -e 'ssh -o BatchMode=yes -o ControlPath=none -o ConnectTimeout=10' \
  "$BASE/public/dashboard.html" \
  root@viewflow.io:/srv/rank-bench/public/dashboard.html
