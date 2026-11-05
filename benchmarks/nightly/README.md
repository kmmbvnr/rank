# Nightly demo benchmarks

The nightly job pulls `origin/main` into a dedicated checkout, installs locked
dependencies, regenerates the grammar and builds TypeScript. It runs demo
workloads sequentially on CPU 2 of `root@jack.lan`. Node 24.15.0 is installed
separately at `/opt/rank-bench-node`; the host's system Node stays unchanged.

Self-contained programs run with default arguments and closed stdin.
Programs with required arguments or stdin use companion tests with fixtures.
Files that declare
functions without top-level expression/control-flow statements use their
companion `_test.ra` file. Libraries without companion tests are reported as
`no-workload`. The report records the selected workload for every file.
This classification is structural; inspect it before treating an unfamiliar
library or program as a meaningful performance measurement.

Each workload gets one fresh CLI process and a **10-minute wall-time limit**.
At the deadline the runner kills the entire process group and continues.
The worker has a 4 GiB JS heap limit. On Linux, each worker is placed in its
own cgroup with a 6 GiB memory cap, no swap and at most 128 tasks. A sampled
6 GiB RSS guard is the fallback when cgroups are unavailable. Processes share one CPU affinity and environment
thread limits; other activity on the host can still introduce noise.

The measured time includes parsing and execution after CLI imports.
`wallMs` also records startup overhead; the ten-minute deadline includes it. There is no
warmup and one sample per night. Group changes use geometric means over
successful, matching workloads that take at least 100 ms in both runs.
The source/test hash excludes imported dependencies, so changes in dependencies
or the environment can affect comparisons. Inspect commit links and individual
history before drawing conclusions. Failed and timed-out work never counts as
a speedup.

## Installed paths

- `/srv/rank-bench/repo`: dedicated checkout, fast-forward pulls only.
- `/srv/rank-bench/controller`: deployed runner, renderer and shell wrapper.
- `/srv/rank-bench/public`: resumable reporting snapshots and JSON history.
- `/srv/rank-bench/logs`: update/build/runner logs, retained for 180 days.
- `/etc/cron.d/rank-bench`: nightly schedule on jack's local timezone.
- `https://rank.viewflow.io/bench/`: public report.

A nonblocking `flock` prevents overlapping scheduled or manual wrapper runs.
If a complete pass lasts beyond the next scheduled start, that start is
skipped and the existing pass continues. With many ten-minute timeouts, a full
pass can exceed one night. Reports update after each demo and are published
every minute and at completion. Historical result files are retained.
An interrupted process leaves the most recent completed measurements on disk;
a later run starts a new pass. It does not resume an interrupted workload list.

Publishing uses SSH from jack to `root@viewflow.io` and `rsync` with delayed
updates, with the HTML snapshot transferred last. The nginx alias points to
`/srv/rank-bench/public`, outside the web application's deployment directory,
so normal site deployments do not erase benchmark history.

The controller's `run.mjs`, `worker.mjs` and `report.mjs` update from the checkout when those
files exist on `origin/main`; until these changes are merged/pushed, the
initial deployed copies run against the latest upstream language sources.
The shell wrapper and cron configuration are installed separately.

Manual full run:

```sh
ssh root@jack.lan /srv/rank-bench/controller/nightly.sh
```

Small isolated check (does not affect public history):

```sh
/opt/rank-bench-node/bin/node /srv/rank-bench/controller/run.mjs \
  --checkout=/srv/rank-bench/repo \
  --output=/srv/rank-bench/smoke \
  --only=deepml/024_neuron --timeout=10000
```

Local harness tests, after compiling TypeScript:

```sh
node --test benchmarks/nightly/nightly.test.mjs
```

The overview includes a histogram of demo execution times with successful
runs in blue and errors/timeouts stacked in red in their elapsed-time bucket.
Median and 90th percentile use successful runs only. During an
active pass it describes completed workloads, not the entire pending corpus.
The summary stays global when the individual-demo table is filtered.

A lightweight renderer runs every minute on CPU 0, independently of the
measurement loop on CPU 2. It generates `dashboard.html` from the latest JSON;
nginx prefers that file for `/bench/`. This allows report UI updates during a
long pass without restarting measurements. The renderer also publishes the
dashboard every minute through `publish-report.sh`, including after the
measurement process exits. The wrapper renders once more before its final
publication so the completed pass is visible immediately.

Install the cron file as root on jack; cron rejects files with another owner:

```sh
install -o root -g root -m 0644 \
  /srv/rank-bench/repo/deploy/nightly-bench.cron \
  /etc/cron.d/rank-bench
```

When copying deployment files with rsync, use `--no-owner --no-group` to avoid
preserving the Mac's numeric owner. The nightly wrapper also reinstalls the
cron file with explicit root ownership after each successful pull.

Use **Run** to view a historical pass: its header, histogram, counters and
individual results update together. **Compare with** selects the baseline for
comparison columns. **Refresh** reloads the selected pass and preserves the
run, comparison and table filters in the page URL. Loading failures appear
beside Refresh and leave the last valid report visible.
