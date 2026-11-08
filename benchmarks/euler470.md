# Euler 470: compact subset statistics

The old program kept count/sum tables for every nonempty subset and every face threshold. At N=20 these two tables alone contain 44,040,150 Int32 cells (168 MiB), before temporary arrays. Most remaining work is native bulk arithmetic, scans and stable sorting rather than scalar interpretation.

Subset statistics now grow by doubling: adding face j appends the old counts plus one and the old sums plus j. A threshold query uses `mask mod 2^threshold` to select the corresponding subset statistics, including the empty subset. This removes the threshold dimension and its repeated full-set writes. Large intermediates are local to the gain-histogram function. The histogram and library linear solve retain their mathematical roles, and the public `Sd` vector remains available. Every function and the main body have at most one loop; no Rank loops are nested, and lines fit 40 columns.

The general stable Int32 argsort kernel also skips the scatter stage when a radix digit has only one occupied bucket. It keeps stable ascending/descending ties, exact wider-integer fallback, unchanged inputs and existing interruption admission. No language syntax or Number-mode threshold changes.

## Verification

A separate C++ long-double oracle enumerates the actual faces of each subset, applies the stopping recurrence directly and uses expected visits of the birth-death chain instead of histograms or matrix solving. It obtains F(20)=147668793.788316905, rounding to **147668794**. Small TypeScript oracle tests compare every cost, with zero/empty boundaries and all three numeric backends. Imported examples retain S(6,1)=208.3 and F(10)=45968.

The existing histogram/linear-solve computation gives S(20,1)=12533140.473734815 versus the long-double oracle's 12533140.4738969412, a difference of about 1.6e-4 (relative 1.3e-11); this predates the change. The full answer and previous cost vector are preserved. This is floating-point expected-value computation, not an exact-rational claim.

The default program is restored to corpus eligibility now that it completes in seconds. Focused tests and exact-name-filtered differential runs are used here; full npm test and exhaustive audits are not run.

## Measurement method

Fresh-process N=20 comparisons alternate the original program, new program with the frozen baseline runtime, and final program/runtime. The baseline is commit 1cd12283. Both hosts are loaded; the Intel machine is also running a separate benchmark controller and ZFS scrub. These are observations under load, not idle-host timings. Raw samples retain elapsed time, CPU usage, peak RSS, source/runtime hashes and load/free-memory readings.

Radix microbenchmarks include narrow, constant, high-digit-only and full-width signed keys, both short and longer warmups. An earlier varying-bit prototype was rejected after short-warmup full-width regressions; it is not the selected implementation.


## Results

N=20 medians of three alternating fresh-process comparisons per variant and mode:

| Host / mode | Before → after, seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Mac compiled | 3.061 → 2.230 | 631.2 → 401.5 |
| Mac reference | 2.994 → 2.017 | 703.5 → 453.3 |
| Intel compiled | 7.182 → 5.216 | 624.4 → 375.5 |
| Intel reference | 7.556 → 5.233 | 606.0 → 419.5 |

Memory improves on both architectures. Most full-program improvement comes from the subset layout. Isolating the sort change on Intel gives compiled 5.266 → 5.216 s and reference 5.243 → 5.233 s, a small difference under load. The Mac mask-only samples vary from 2.084 to 3.493 s in compiled mode; they do not support assigning the combined speedup to sorting.

The longer-warmup radix microbenchmarks show narrow keys 16% faster on Mac and 20% on Intel, constant keys 37%/43% faster, and high-digit-only keys 29%/29% faster. Full-width keys are unchanged on Mac and about 2.4% slower on loaded Intel; this small overhead is retained explicitly rather than described as a universal speedup. The short-warmup full-width result is +0.5% on Mac and +2.3% on Intel. The rejected varying-bit implementation had a much larger short-warmup regression.

**171 focused checks in five files passed on each host.** The name-filtered differential run selected and passed exactly two cases per host: full program and imported fixture. TypeScript source/test projects, semantic-boundary and application-form checks, and four exclusion-catalogue checks passed. No exhaustive audit or full npm test was run.

Raw selected samples, intermediate variants, oracle outputs and verification logs are in [the baseline record](baselines/2026-11-08-euler470.json). Reproduce program comparisons with `node benchmarks/euler470-compare.mjs /path/to/frozen/interpreter/out/index.js`; the frozen snapshot needs its matching language package. Run `node benchmarks/experiments/euler470-sort.mjs 40 40` with and without `RANK470_RUNTIME` for isolated sort comparisons. Build the independent oracle with `c++ -O3 -std=c++17 benchmarks/experiments/euler470-oracle.cpp`.
