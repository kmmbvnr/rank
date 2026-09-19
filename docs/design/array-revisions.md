# Array revisions and demand-driven caches

Rank validates cached pure tensor results when they are used. An indexed write
updates source metadata; it does not walk dependent expressions or calculate
new values. Unused expressions incur no validation work. This is pull validation.

Each runtime-owned array has a revision. A derived array records its dependencies
and checks their revisions before returning a cached cell or materialization.
Validation follows transitive dependencies without executing their cells, so a
change to A is visible through B to C even if B has not been evaluated again.
One dependency proof is shared within a write epoch. A bounded mutation journal
can skip writes to newer, unrelated temporary objects; missing history falls
back to full validation. No correctness depends on the journal retaining history.

Tables use whole-table invalidation. Any row or field mutation makes dependent
projections stale on their next use, including projections of unchanged columns.
Per-column and per-row cache retention are future optimizations, not semantics.

Owned buffers also retain resource summaries, avoiding repeated file-ownership
walks of numeric arrays. Compiled loops borrow private eager storage. They batch
revision updates only when the region cannot observe intermediate changes
through lazy inputs, iterators, container operations or user calls. The first
write publishes a revision, including when execution subsequently raises.

Unknown host buffers do not provide reliable revisions, so a reader over one
cannot prove a cell still holds. What it can do is bound how long a stale cell
could go unnoticed: only the embedder writes such a buffer, and only while it
has control. Cells read from one are kept for a single stretch of work the
embedder asked for — one `execute`, one call into a Rank function, or one read
of a lazy value it holds — and dropped when control returns. No cache crosses
that boundary, so what an embedder reads is as live as before, while a chain of
readers within one stretch costs its depth once rather than once per cell.
Without that bound, a step that reads the step before it twice — gradient
descent — costs an exponent in its number of steps. A host function called back
from Rank runs inside the stretch, not outside it, so a buffer it writes there
is seen on the next one.
Replacing public storage or installing accessors disables the fast proof.
Tracked JSON/CSV rows and grouped/joined tables preserve dependency metadata.
Pure builtin tensor operations are covered; this does not introduce automatic
replay of I/O, generators, or arbitrary captured user-function effects.

See [derived values](../language/sequences-arrays.md) and
[table mutation](../language/tables.md) for the current language contract.

## Measurements

Local Apple M5, Node v24.15.0. Baseline interpreter: `946a415`; candidate runtime:
`69f0115`. Later integration commits only change CLI input and documentation.
Each checkout resolves its own built workspace packages. Timings are local
measurements, not mobile predictions. Benchmarks run separately from tests.

The direct runtime benchmark parses once, warms up at the measured size,
alternates checkouts, validates results and reports nine-sample medians.
`node benchmarks/array-revisions.mjs /path/to/built/baseline` reproduces it.

| Workload | Baseline ms | Candidate ms | Observation |
| --- | ---: | ---: | --- |
| Polynomial copy, 1M elements | 16.35 | 5.86 | 2.8x faster |
| 2048 cached column-mean reads | 32.11 | 0.078 | Reuse, not first reduction |
| Dense writes, 1M | 47.15 | 49.68 | 5% slower |
| Matrix writes, 1M | 41.39 | 43.56 | 5% slower |
| Dense updates, 1M | 51.49 | 64.17 | 25% slower |
| Dense reads, 1M | 49.66 | 48.73 | Approximately unchanged |

A separate run added the actual DeepML PCA function on a 2048-by-2 input:
317.81 to 4.96 ms (64x). This exercises covariance and reused tensor results.
Absolute timings vary: that run measured copy at 55.50 to 12.66 ms and dense
updates at 61.10 to 62.60 ms. Preserve both runs rather than selecting only the
best result. The repeatable benefit is reuse; write-heavy workloads still have
metadata overhead and need further profiling.

The complete demo suite passed 1193 tests in 341 files with identical per-file
test counts and output digests. One sequential run took **56.11 s baseline and
59.80 s candidate: 6.6% slower overall**. This is not a suite-wide speedup claim.
The change provides correct mutation-aware reuse and resource metadata; future
optimizations should address write-heavy examples without weakening validation.

Raw results:

- [Microbenchmarks](../../benchmarks/baselines/2026-09-12-array-revisions-micro.json)
- [PCA and microbenchmarks](../../benchmarks/baselines/2026-09-12-array-revisions-pca-micro.json)
- [Baseline suite](../../benchmarks/baselines/2026-09-12-array-revisions-baseline-suite.json)
- [Candidate suite](../../benchmarks/baselines/2026-09-12-array-revisions-candidate-suite.json)

Regression tests cover transitive caches, views, matrix multiplication, numeric
transforms, table mutation, unknown host aliases, journal eviction, nested child
replacement, partial writes before exceptions and lazy reads inside compiled
loops. Writes and metadata inspection are tested not to execute tensor cells.

Final integrated `npm test`: 46 language tests, 1045 interpreter tests and
18 CLI tests passed, including the build.


## AC-power follow-up

The next measurements recorded AC power and `lowpowermode = 0` on the same
Apple M5 and Node version. Absolute times were roughly half the earlier run.
The earlier power and thermal state was not recorded, so this does not establish
that plugging in caused the change. Both sides now run under the same reported
power settings, sequentially, with no tests or builds running alongside them.

Three small runtime changes address observed overhead:

- Materializing a sequence now creates tracked owned storage. Previously,
  `(1 to N) array` produced an untracked buffer, so downstream tensor caches
  could not reuse their cells. This was the main problem in Euler 009.
- A derived reader reuses its local validation result within the same write
  epoch. Unknown host buffers still read live across a return to the host; see
  above for the cell cache they keep inside one stretch of work.
- Compiled loops prepare tensor readers and writers only for array slots.
  Scalar and container variables no longer allocate unused tensor accessors.

Two full-suite runs per version produced these results. All 341 files and 1193
checks have identical test counts and output digests across all six runs.

| Version | Run 1, s | Run 2, s | Mean, s |
| --- | ---: | ---: | ---: |
| Before revisions, `946a415` | 29.052 | 29.151 | 29.101 |
| Revisions, `45aeefc` | 30.434 | 30.805 | 30.620 |
| These fixes, `eec62fd` | 30.245 | 30.554 | 30.400 |

These fixes reduce the suite mean by only 0.7%, which is too small for a strong
speedup claim with two runs. Revision tracking still costs about 4.5% against
the pre-revision suite. The original regression cannot be dismissed as a power
setting difference: it remains visible in this comparison.

Euler 009 improves from 355/378 ms to 155/169 ms, about 2.3x. Collatz improves
from 5281/5274 ms to 5076/5224 ms, a smaller change. Direct nine-sample median
benchmarks, repeated twice, show PCA at 2.84/2.85 ms before and 2.35/2.28 ms
after; cached column reads at 0.043/0.041 ms before and 0.026/0.027 ms after.
Dense writes do not improve. Dense updates vary substantially: 27.0 to 34.9 ms
in one run, 33.4 to 34.3 ms in the repeat. Do not treat that first baseline as
a stable speed comparison. Write-heavy workloads remain a profiling target.

Reproduce with built isolated checkouts and the existing benchmark drivers:

```sh
RANK_BENCH_COUNTERS=0 node benchmarks/tensor-fusion.mjs suite on 1
node benchmarks/array-revisions.mjs /path/to/built/45aeefc
```

The suite timings include parsing, compilation and execution in fresh
interpreters. The direct benchmark warms each workload and alternates versions.
[Raw runs and environment](../../benchmarks/baselines/2026-09-12-pull-cache-ac.json)
include both microbenchmark repeats and all per-file suite measurements.
The focused checkout passed 46 language, 1046 interpreter and 18 CLI tests.
After cherry-picking the code as `c9dbb2e` onto current main, the build and
46 language, 1047 interpreter and 24 CLI tests passed, including SQLite.

Next profiling should separate mutation bookkeeping and allocation cost in
write-heavy loops. General cache hit/revalidation counters remain future
internal diagnostics; these fixes do not add a public inspection interface.
