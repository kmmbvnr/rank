#!/bin/bash
set -Eeuo pipefail
export PATH=/opt/rank-bench-node/bin:/usr/local/bin:/usr/bin:/bin
export GIT_TERMINAL_PROMPT=0
BASE=${RANK_BENCH_BASE:-/srv/rank-bench}
mkdir -p "$BASE/logs" "$BASE/public"
exec 9>"$BASE/nightly.lock"
flock -n 9 || exit 0
cd "$BASE/repo"
LOG="$BASE/logs/$(date -u +%Y-%m-%dT%H-%M-%S).log"
exec >>"$LOG" 2>&1
publish() {
  timeout 90 rsync -az --delay-updates --timeout=60 -e 'ssh -o BatchMode=yes -o ControlPath=none -o ConnectTimeout=10' --exclude '*.tmp' --exclude /index.html "$BASE/public/" root@viewflow.io:/srv/rank-bench/public/
  [ -f "$BASE/public/index.html" ] || return 0
  timeout 30 rsync -az --timeout=20 -e 'ssh -o BatchMode=yes -o ControlPath=none -o ConnectTimeout=10' "$BASE/public/index.html" root@viewflow.io:/srv/rank-bench/public/index.html
}
heartbeat() {
  exec 9>&-
  while sleep 60; do publish || true; done
}
PUBLISH_PID=
finish() {
  local code=$?
  trap - EXIT
  flock -w 50 "$BASE/render.lock" timeout 30 node "$BASE/controller/render-latest.mjs" "$BASE/public" || true
  if [ -n "$PUBLISH_PID" ]; then kill "$PUBLISH_PID" 2>/dev/null || true; wait "$PUBLISH_PID" 2>/dev/null || true; fi
  python3 - "$BASE/public/job.json" "$code" <<'PY'
import json,sys,datetime,os
file,code=sys.argv[1:]; tmp=file+'.tmp'
with open(tmp,'w') as f: json.dump({'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':int(code)},f)
os.replace(tmp,file)
PY
  publish || true
  find "$BASE/logs" -name '*.log' -mtime +180 -delete
  exit "$code"
}
trap finish EXIT
phase() {
  python3 - "$BASE/public/job.json" "$1" <<'PYTHON'
import json,sys,datetime,os
file,phase=sys.argv[1:]; tmp=file+'.tmp'
with open(tmp,'w') as f: json.dump({'updated':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phase':phase},f)
os.replace(tmp,file)
PYTHON
  publish || true
}
phase updating
printf 'Nightly started %s\n' "$(date -Is)"
timeout 120 git pull --ff-only origin main
if [ -f deploy/nightly-bench.cron ]; then
  install -o root -g root -m 0644 deploy/nightly-bench.cron /etc/cron.d/rank-bench
fi
# Keep the deployed harness until its version is available in origin/main.
if [ -f benchmarks/nightly/run.mjs ]; then
  cp benchmarks/nightly/{run.mjs,report.mjs,worker.mjs,render-latest.mjs,publish-report.sh} "$BASE/controller/"
fi
phase dependencies
timeout 1200 npm ci --no-audit --no-fund
phase building
timeout 300 npm run langium:generate
timeout 1200 node node_modules/typescript/bin/tsc -b tsconfig.build.json
# CPU 2 is fixed for reproducible affinity; all subprocesses inherit it.
phase benchmarking
heartbeat & PUBLISH_PID=$!
taskset -c 2 node "$BASE/controller/run.mjs" --checkout="$BASE/repo" --output="$BASE/public"
printf 'Nightly finished %s\n' "$(date -Is)"
