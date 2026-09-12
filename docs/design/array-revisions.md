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

Unknown host buffers do not provide reliable revisions and use uncached reads.
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
