# Euler 714: exact broadcast remainders and sparse matches

Issue: https://github.com/kmmbvnr/rank/issues/533

The default input remains Count=50000, Longest=18 and Block=16777216.
The answer remains `2.452767775565e20`; every full run also produced the same
stored total, `245276777556527600000`. Enumeration and the original residue
BFS remain in place. Six numbers reach the BFS after enumeration.

## Full-input measurements

Node v24.15.0; Apple M5 arm64 macOS and Intel i7-10750H x64 Linux, normal CPU
affinity. Each host has one baseline run from commit 73cfd27f and three serial
final runs with runtime 9653e318 and solution 4bc6f3b3. Other host load was not
controlled. Baseline variance was not measured; especially on Mac, report all
samples rather than treating the speedup as a stable universal ratio.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 267.12 | 82.23 / 68.49 / 53.97 | 3.90x | 2287.80 | 1252.53 |
| Intel | 609.93 | 105.85 / 107.57 / 107.05 | 5.70x | 1767.69 | 730.16 |

Median peak RSS fell by 45.3% on Mac and 58.7% on Intel. RSS is the process
high-water mark, including parsing and runtime setup. All final peaks were
below their host's baseline. Primary raw files are `results/euler714/base-*-full.json`
and `reuse-final-*-{1,2,3}.json`; `summary.json` contains the derived figures.
Earlier `final-*` and `initial-final-*` samples predate the short-call repair
and are retained separately, not pooled into these medians. Profiled runs
are also excluded from the timing series.

## Interpreter change first

The dominant work was a broadcast modulo matrix containing billions of cells.
Profiles showed integer binary mapping, broadcast address calculation,
conversions, dense scans and distinct collection work. Copy-on-write was not
the dominant cost. See `results/euler714/profile-summary.json` for self-sample
summaries (the baseline profile uses a reduced input; the two later profiles
use the full input).

`integer-array-kernel.ts` now computes Int64 remainders by reading their two
Int32 words, without constructing a BigInt for every cell. For positive compact
divisors m <= 2^26, reduce the signed high word modulo m, then reduce
`highRemainder * (2^32 mod m) + unsignedLowWord`. This intermediate is below
2^53, so its integer arithmetic is exact. Signed values retain floor-modulo
semantics. Column broadcasts reuse the divisor and row address; Int32 inputs
also avoid a Float64 scratch matrix and later narrowing.

Admission reuses the existing prepared views and uniform validation. Negative,
zero and oversized divisors retain the existing fallback. Tests cover signed
Int64 boundaries, offsets, strides, reverse views, other broadcast layouts,
deferred errors, cancellation and demand budgets. The budgeted path retains
the existing accounting. Outputs own their storage.

With the original Rank source, the intermediate runtime-only implementation
reduced the Mac full run to 175.08 seconds (1.53x, one sample). The larger final
speedup also needs the following source changes; it is not solely a compiler
improvement or whole-loop compilation.

## Memory and Rank array pipeline

`All sort unique` uses the existing fused numeric sort/unique implementation,
replacing a separate sorted result followed by a generic distinct set.

The old pipeline built an integer hit matrix and a weighted product matrix,
then took a row maximum. The new pipeline extracts the true flat coordinates
of the packed Boolean mask, derives row and column coordinates, and reduces
the minimum column by row. The identity is the width, and only rows present
in the coordinates are assigned. Maximizing `hit * (Width - column)` and
minimizing matching columns select the same earliest candidate. This removes
the dense integer hit/weight matrices and their scans. It uses existing Rank
operations, with no new syntax or task-specific primitive.

Full diagnostics recorded 303 integer keyed folds and 18 fused numeric
sort/unique calls. Number loops and Number tensors remained zero; this result
comes from native array kernels rather than a newly compiled whole loop.

## Kernel and unaffected-path controls

Each table entry is the median of three fresh processes. Large kernels have
16 rows and 1048576 columns, with every output independently checked after
timing. Small controls perform 5000 calls of 128 cells.

| Case | Mac baseline / final ms | Intel baseline / final ms |
| --- | ---: | ---: |
| Int64 row-broadcast modulo | 556.24 / 161.86 | 1074.90 / 224.88 |
| Int32 row-broadcast modulo | 595.44 / 53.01 | 886.65 / 116.63 |
| Small same-shape modulo | 16.55 / 16.61 | 43.75 / 43.67 |
| Int64 modulo scalar | 19.92 / 19.77 | 51.10 / 50.31 |

The compact large kernel's median peak RSS fell from 289.31 to 159.70 MiB on
Mac and 285.78 to 157.66 MiB on Intel. Wide-kernel RSS stayed approximately
180 / 179 MiB. An early implementation prepared views twice and regressed
small calls. Reusing the prepared views and keeping calls below 1024 output
cells on their original path removed that observed regression. Final small
same-shape timings differ by +0.4% on Mac and -0.2% on Intel, within these
samples' noise. Small-control RSS ranges overlap; no general zero-overhead
claim follows from three samples.

## Rejected experiments

A generic monotone Int64 distinct implementation reached 147.51 seconds /
1762.95 MiB with the old source pipeline. It was removed: the existing fused
`sort unique` operation addresses this workload without adding another runtime
feature. Its patch and raw result are retained under `experiments/` and
`results/euler714/rejected/`.

A rewritten packed frontier BFS, including digit-pair pruning and batched
residue expansion, preserved the answer but took 195.17 seconds / 1176.69 MiB.
It was slower than the runtime-only version and is not used. The rejected
Rank source is `experiments/euler714-frontier-rejected.ra`.

## Verification and reproduction

- 162 focused interpreter tests passed on Mac after the final runtime repair.
- 64 focused tests passed on Intel, including both compilation modes for the
  independent direct-multiple oracle.
- The full default compiled demo test passed, asserting the golden answer,
  keyed-fold use, 18 fused sorts and no speculative loop overflows.
- Semantic boundaries checked 65 owners; application-form checks passed.
- TypeScript build passed. The broader workspace build reached Capacitor sync
  and failed because the isolated worktree lacks the Android platform setup;
  this does not validate an Android package. The build log is retained.
- No exhaustive audits or full workspace test suite were run.

The direct oracle tests sums through 500, individual awkward divisors and
short enumeration prefixes that force BFS. Published examples are checked
against https://projecteuler.net/problem=714. The full golden is cross-checked
against the frozen original solution, not claimed to be a published example.
Verification logs are stored beside the measurements. Integration verification
against main c60ffeaa (merge 7b0f3f22) is recorded in `integrated-*.txt`.
The focused integration checks total 162 tests (149 plus 13 segmented tests).

Build TypeScript outputs before benchmarking:

```sh
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler714.mjs
# Reduced inputs; append reference for compilation=false:
node benchmarks/euler714.mjs 500 8 8192 reference
RANK_SOURCE=benchmarks/fixtures/euler714-original.ra node benchmarks/euler714.mjs
PROFILE=/tmp/euler714.cpuprofile DIAGNOSTICS=1 node benchmarks/euler714.mjs
node benchmarks/experiments/euler714-mod.mjs
MODE=compact node benchmarks/experiments/euler714-mod.mjs
node benchmarks/experiments/euler714-control.mjs
node benchmarks/experiments/euler714-control.mjs scalar
```

`RANK_ROOT` selects a separate built baseline checkout for the same drivers.
Profiling, tracing and diagnostics should be separate from primary timing runs.
