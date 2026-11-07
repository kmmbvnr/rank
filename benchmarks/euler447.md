# Euler 447: retractions

The full answer remains **530553372**. For each n, the number of nonconstant
retractions is the sum of its unitary divisors minus n. Mobius inversion gives

```
F(N) = sum(mu(t) * t * T(N // t^2)) - N * (N + 1) / 2
T(x) = sum(sigma(k), k = 1..x)
```

The existing algorithm is retained, with smaller working sets. For odd u,
`mu(2u) = -mu(u)`; multiples of four have zero Mobius coefficient. Combining
these contributions halves the Mobius table and shares the two summatory
queries. Prime-power marking uses one loop and array slices.

Small summatory queries read a modular prefix table. Large queries use the
hyperbola identity, processing at most 131072 terms at once. The remaining
Mobius terms also run in blocks. The automatic direct-query cutoff is twice
the integer fourth root of N, clamped to the square root; `--cut` remains
available for explicit comparisons. At the default input, this builds roughly
2.5 million prefix entries instead of 11.1 million. Exploratory cuts 3000,
6000 and 24000 favored the middle choice for both speed and RSS on Mac.

Triangle products and their modulus are expressed in one operation. The
existing exact modular multiplication backend then avoids materializing wide
integer product arrays. The full Number execution has no overflow/replay.
Ordinary completion boundaries are preserved. Different names distinguish
vector triangle values from the scalar correction; the Rank fixture checks
repeated imported runs with changing N and Cut in the same interpreter.

A general compiler change supports `A Keys += Values`, `-=`, and `*=` for a
one-dimensional numeric destination and integer array selectors. It validates
all keys before evaluating the RHS, snapshots aliases, computes updates from
the original selected cells, then commits writes. Repeated keys keep last-write
semantics. Integer overflow replays the exact backend, and Int32 destinations
widen when required. Real operands of the same element type are supported.
The original scalar RHS remains the assignment result. Escaping array RHS
results retain the native path because they may be lazy selections of the
updated destination. Budgeted and observed execution also retain native
completion/work boundaries, including calls after a helper has warmed up.
The sigma sieve can now use the direct compound spelling within its private
Number region instead of a separate gather and ordinary scatter expression.

## Measurements

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, compiled | 13541.56 | 7298.22 | 1875.66 | 665.62 |
| Mac, reference | 10480.34 | 7142.75 | 1665.09 | 751.48 |
| Intel, compiled | 30918.58 | 14312.53 | 1425.34 | 378.84 |
| Intel, reference | 26311.00 | 14236.75 | 1132.91 | 406.12 |

Three alternating before/after pairs per mode and host use fresh Node
v24.15.0 processes. The baseline is 821aa2a3, and final samples have matching
source hashes on both hosts. Timing includes parsing and execution; RSS is
process peak. Intel pre-run samples show 99–100% CPU idle, with no active
swap traffic; vmstat output is stored with each sample. Mac
background load varies, so the report retains raw timings as well as medians.
Exploratory samples before the final cutoff/name fixes are excluded.

A focused compound-scatter workload performs 100 updates of every other cell
in a private integer array. It verifies the arithmetic total and reports
whether the entire helper compiles as a Number region. The timing ranges
overlap: there is no consistent isolated speedup.

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, scatter | 141.09 | 146.70 | 167.22 | 169.27 |
| Intel, scatter | 296.18 | 288.08 | 134.34 | 134.32 |

This closes a compilation gap; the full demo's larger gain comes from its
smaller tables, blocked arrays and modular arithmetic.

## Verification

452 focused tests across 12 files pass on Mac and Intel. Direct
factorization supplies 255 independent prefix comparisons per host across
Number compilation, exact compilation and reference execution, with 17 input
limits and five cutoffs. These cover zero, one, square boundaries, odd/even
cutoffs and an empty tail. The full compiled answer and zero Number overflows
are asserted. The three-test Rank fixture passes in all three backends,
including repeated runs at 100/1000 and two cutoffs at ten million.

Compound-scatter tests cover duplicate and aliased keys/RHS, saved snapshots,
scalar results, real arithmetic, empty selections, shape/index/type errors,
Int32 widening, unsafe integer replay, observers and demand budgets after a
warm ordinary call. Existing stage tests had two stale diagnostic counts on
the clean baseline; those expectations are refreshed without changing their
score, completion-order or source-mutation assertions. Source/test TypeScript
checks and execution-exclusion checks pass. Exhaustive audits were not run.
The full demo is removed from the execution exclusions.

Raw measurements: [full runs and scatter controls](baselines/2026-11-07-euler447.json).
Reproduce from the repository root:

```sh
git show 821aa2a3:demos/euler/447_retractions.ra > /tmp/euler447-before.ra
node benchmarks/euler447.mjs compiled 100000000000000
node benchmarks/euler447.mjs reference 100000000000000
node benchmarks/compiled-compound-scatter.mjs
```

For the baseline, build an interpreter at 821aa2a3, set `RANK447_RUNTIME` to
its `out/index.js` file URL, and pass `/tmp/euler447-before.ra` as the third
runner argument. The scatter control uses `RANK_BENCH_RUNTIME` in the same way.
