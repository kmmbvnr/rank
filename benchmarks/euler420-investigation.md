Historical investigation at `51ef33ba`. The implementation and final measurements are in [the follow-up](euler420-followup.md). Compiler gaps described below are the pre-change findings.

# Euler 420: 2x2 Positive Integer Matrix

Research base `51ef33ba`, Node v24.15.0, 2026-11-06. Selected as the next
unfinished row in fresh #447. Production files and GitHub are unchanged.
All alternative sources below are research controls, not a delivery.

## Diagnosis

The old approximately 42-second exclusion is stale on this checkout. A full
current Mac probe takes **2.062 s / 740.6 MiB**, answer **145159332**.

The existing number-theoretic reduction is reasonable: coprime trace ratios
p:q, an integer n and a parity-constrained m contribute a divisor count.
It avoids enumerating all positive matrices at N=10^7. The opportunities are
redundant array work, representation and compiler coverage.

A separate phase-instrumented original probe takes 2.066 s: pair construction
1.031 s, divisor table 0.030 s, final summation 1.005 s. The outer summation
is not compiled as one region. The 3997 Number-loop executions are mainly its
two counter loops plus the divisor sieve; loop preparation totals only 12.3 ms,
so this is not evidence of expensive repeated compilation.

A V8 profile attributes 8.6% of samples to stored Int32 comparisons, 8.3% to
stored Int32 binary maps, 5.9% to array reads, 4.7% to GC and 3.5% to packed
sums. Anonymous generated kernels account for another 16.9%. The work is
spread over array passes, reads and materialization as well as dispatch.

## Program improvements

- For even n, the two old parity-prefix arrays are identical. For odd n,
  only one group contributes. Build one prefix on m = n mod 2, n mod 2 + 2,
  ... instead of two full-length prefixes containing zeros. A query with
  largest m = t reads prefix index `(t + 2 - parity) // 2`.
- Replace decrementing sorted-table counters with existing `upperindex`.
  This removes about 1.2 million counter decrements in favor of roughly
  4000 native logarithmic queries, and removes nested source loops there.
- Compute each row's q limit once as
  `min(p-1, isqrt(Bound-p*p))`. The grid mask then needs only q <= limit.
  No full p²+q² matrix is needed to decide admissibility.
- Obtain p and q from the selected linear grid indices using division and
  remainder, instead of expanding and retaining two full coordinate grids.
- Apply gcd only after geometric filtering: **1,961,584 candidate pairs**,
  instead of the approximately five-million-cell rectangle. There remain
  **795,763 / 397,882** coprime pairs in the two parity groups.

The `row-bounds` prototype combines these changes while retaining array
operations and the original mathematics. The divisor sieve remains unchanged.

Selected full Mac exploratory probes (single, sequential observations):

| Variant | Seconds | Peak MiB |
| --- | ---: | ---: |
| Original | 2.062 | 740.6 |
| One compact parity prefix | 1.663 | 617.5 |
| Linear-index coordinates | 1.635 | 622.4 |
| Deferred full-grid gcd/squares | 1.982 | 568.8 |
| Scoped deferred pair builder | 2.285 | 584.7 |
| Explicit copies of returned pair columns | 3.058 | 587.3 |
| Geometry before gcd, eager squares | 1.727 | 583.2 |
| Native upper-index queries too | 1.487 | 576.5 |
| Per-row geometric bounds | 1.443 | 582.8 |
| Packed integer keys in Rank | 2.731 | 563.4 |
| Deferred-query scalar helper | 9.197 | 635.9 |

The lazy and copied variants were not automatically better. Deferred query
bindings placed directly in the mutable outer scope also protect K0/K1 and
correctly reject their later mutation; that invalid variant is not counted as
an optimization. Scoped query plans avoid that error but currently miss the
compiler path described below.

## Repeated full comparison

Three alternating fresh-process original/row-bounds pairs per host, N=10^7.
Parsing is included, phase logging disabled, diagnostics enabled. Other host
load was not controlled. Every answer is **145159332**.

| Host | Original seconds | Candidate seconds | Median before → after |
| --- | --- | --- | --- |
| mac | 3.294 / 2.878 / 2.562 | 3.312 / 2.035 / 1.780 | **2.878 → 2.035 s** |
| intel | 6.862 / 6.952 / 6.847 | 4.709 / 4.794 / 4.925 | **6.862 → 4.794 s** |

Peak RSS ranges: original Mac **651.2–726.8 MiB**, candidate **526.1–584.8 MiB**;
original Intel **580.7–581.3 MiB**, candidate **528.3–531.1 MiB**. Mac timing
varies substantially (the first pair shows no gain); the median improvement is
approximately **1.4x on both hosts**. Do not substitute the faster exploratory
1.443-second probe for the paired candidate median.

Separate full reference probes on Mac agree: **3.318 → 2.044 s**, peaks
**862.6 → 697.0 MiB**. These are single probes, not reference medians.
Separate Intel reference probes also agree: **10.838 → 6.734 s**, peaks
**676.5 → 604.7 MiB**. These are likewise single observations.

## General compiler gaps

`experiments/euler420-compiler-probe.mjs` demonstrates independent small cases:

| Body | Expected total | Number loops |
| --- | ---: | ---: |
| Pointwise array binding followed by sum | 36 | 1 |
| `B = A scan + with 0 copy`, then sum | 30 | 0 |
| Direct `(A I) sum` in a loop | 60 | 1 |
| The same gather+sum through an ordinary function | 60 | 0 |

These results and refusals reproduce on both architectures. The scan case is
rejected as an input-type/`with` expression; the function case reports
`scalar-function:unsupported-op:sum`. The latter is not a mathematical limit:
the same gather/reduction already works directly in the loop.

The next useful compiler work is to represent the native additive scan as a
fresh array-producing stage inside the loop region, and support indexed reads
followed by reductions in scalar function plans. Then short ordinary helpers
can compose with their consumer instead of materializing query arrays or
falling back at the function boundary. Preserve scan seed/type semantics,
accumulation order, overflow replay, unused-plan timing, alias snapshots and
guarded execution. No speedup from these unimplemented extensions is claimed.

## Native JS control and limits

A direct typed-array JS control implements the same mathematical counting
formula, generates only the row-bounded pairs, sorts encoded keys and fuses
prefix/gather/reduction traversals. Full answer matches:
**0.224 s / 96.5 MiB on Mac**, **0.316 s / 97.5 MiB on Intel**.
It records pair construction separately (0.108 / 0.210 s). Its explicit domain
N <= 10^7 keeps encoded keys below Number's safe-integer limit.

This is an opportunity bound, not an equivalent generic Rank implementation:
it avoids the rectangular Boolean grid, uses a different sorting representation,
reuses a prefix buffer, and does not expose Rank's demand/alias/error contracts.
It does show that the remaining cost cannot be explained by the mathematics
alone; richer fusion and array execution still matter.

## Correctness

The independent oracle enumerates positive matrices A whose squared trace is
below 200, forms every A², and counts distinct squares with at least two
positive integer roots. This does not use the p:q/divisor-count formula.

Fifteen source variants × reference/compiled × 17 bounds/checkpoints give
**510 passing checks per architecture**. Cases include 3..200 against the
matrix-root oracle, F(1000)=1019 and the existing N=100000 golden 518497.
Full N=10^7 is checked separately in the paired and native runs.

There is an existing boundary issue: original N=0,1,2 errors in square-root or
negative-shape setup despite a zero mathematical answer. The final change
should handle these small bounds explicitly. No production test or exhaustive
corpus suite is modified/run by this research.

## Reproduction

```sh
node benchmarks/experiments/euler420-pairs.mjs
node benchmarks/experiments/euler420-verify.mjs
node benchmarks/experiments/euler420-compiler-probe.mjs
node benchmarks/experiments/euler420-native.mjs
node benchmarks/experiments/euler420-run.mjs reference
```

Raw observations: [baseline JSON](baselines/2026-11-06-euler420-investigation.json).
