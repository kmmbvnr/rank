# Euler 210 investigation

Investigated at `892e19e4` on macOS arm64, Node v24.15.0. Euler 210 is the
next uncompleted problem by number in issue #447. Its main is excluded from
the audit execution budget; the small fixture remains covered.

The implementation registers `isqrt`'s integer result and uses the deferred sum
with a 250000-cell block. The geometric algorithm, default radius, small fixture
assertions, exact arithmetic and Number admission policy are unchanged. Final
shipping measurements and verification follow the initial investigation below.

## Initial investigation: controlled measurements

Three serial fresh processes per variant, alternating order within the baseline
cohort and within the later prototype cohort. No builds, tests, diagnostics or
oracle jobs overlapped. Timings include parsing, compilation and execution,
excluding imports and interpreter construction. Every full-input result was
`1598174770174689458`.

| Variant | Median | Range | Median process peak RSS |
| --- | ---: | ---: | ---: |
| Current array program, compiled | 9034.49 ms | 8997.05–9060.43 ms | 615.28 MiB |
| Current array program, reference | 9113.61 ms | 9091.15–9142.77 ms | 611.97 MiB |
| Same summation as a scalar compiled loop | 2415.69 ms | 2409.89–2499.03 ms | 168.77 MiB |
| Integer-result metadata + deferred sum, original chunk | 2840.84 ms | 2837.28–2904.92 ms | 349.91 MiB |
| Same prototype, chunk 250000 | 2837.61 ms | 2811.77–2850.14 ms | 239.20 MiB |

The array prototype is 3.18x faster than the current compiled program. Peak RSS
is whole-process high-water memory, including V8/GC; it is not retained storage.
The two cohorts were measured sequentially, not interleaved with one another.

## Where the time goes

The geometry already reduces a quadratic lattice search to a one-dimensional
circle sum. At the default radius it computes 51,776,696 square roots, from
`A0 + 1 = 125000000` through `A = 176776695`. This remains O(R).

The main cost is executing the array expression, not a failed attempt to use
Number loop registers. A separate CPU profile attributes about 36.1% of self
samples to the owned-array cell setter, 8.6% to `mapStoredIntegers`, 7.2% to the
derived-array values iterator, and 4.5% to `integerSquareRoot`. These are sampled
self costs, not exact allocation counts or inclusive call-tree percentages.

`isqrt` is already registered as a pure scalar builtin, but its registration
omits the optional integer-result metadata. Consequently it cannot carry a
native arithmetic recipe through to the reduction in a deferred expression.
The existing generic mechanism already supports such scalar stages.

The isolated prototype changes only the registration's fourth argument:

```ts
scalarNative('isqrt', checkedScalar, storedBatch, 'integer')
```

It then gives the consumer an explicit deferred expression:

```rank
for L in A0 + 1 to A by Chunk
  Xs = L to (L + Chunk - 1 min A) array
  Part' = (Q - Xs * Xs) isqrt sum
  Gen += Part
end
```

This retains the ordinary `Xs =` boundary and the array formulation. The
subtraction, square, scalar builtin and sum can run as one exact native graph.
A diagnostic run with chunk 50000 reports 1036 compiled tensor reductions and
zero ordinary cells computed. No Number precision checks or admission thresholds
are changed: `Q = 31249999999999999` exceeds the safe Number integer range.

Controls show that neither change works alone: metadata with the original
program took 9.30 s in one exploratory run; the deferred sum without metadata
took 12.12 s. Making only `Xs` deferred took 9.16 s; removing its `array` took
9.02 s. These are single exploratory samples, not additional repeated cohorts.
Using a smaller chunk alone took 9.13 s: it helps memory rather than speed.
Making `Xs` deferred on top of the complete prototype did not improve its
single exploratory timing (2.84 s).

## Initial prototype verification and proposed follow-up

- Twenty radii, multiples of eight from 8 through 160, match an independent
  brute-force enumeration of all points in the diamond, using integer dot
  products and excluding degenerate triangles. Both runtimes and both execution
  policies pass: 80 comparisons total. The oracle uses chunk 3 to cross blocks.
- The unchanged fixture passes for the original and prototype runtimes in both
  execution policies: answers 100, 916 and 1022626.
- The full answer agrees across original, reference, scalar and array-prototype
  runs. The provided harness checks the golden answer explicitly.
- The harness passes `node --check`. No full interpreter suite or exhaustive
  demo audit has been run for this research-only prototype.

The proposed implementation step was to register `isqrt`'s integer result, add focused
coverage for deferred arithmetic feeding a reduction (including lazy errors,
source boundaries, interruption and reference behavior), and use the deferred
sum in the demo. A 250000-cell chunk is a measured memory improvement; it is not
a universal optimal block size. Retain exact arithmetic and the current Number
admission policy. More elaborate lattice-counting algorithms remain possible,
but are not needed to recover this measured 3.18x execution overhead.

## Reproduction

```sh
node benchmarks/euler210-obtuse.mjs --original --runtime=/tmp/rank210-baseline-runtime/index.js
node benchmarks/euler210-obtuse.mjs --original --reference --runtime=/tmp/rank210-baseline-runtime/index.js
node benchmarks/euler210-obtuse.mjs
node benchmarks/euler210-obtuse.mjs --scalar
node benchmarks/euler210-obtuse.mjs --fixture
node benchmarks/euler210-obtuse.mjs --runtime=/tmp/rank210-runtime/index.js --plan --Chunk=250000
```

`--runtime` accepts an isolated build. The baseline build differs from the final
build only by removing the added integer-result metadata. `--original` restores
the original demo source exactly; `--plan` restores the experimental deferred
sum when combined with `--original`. Other controls are `--deferred`, `--sequence`,
`--diag`, `--R=...` and `--Chunk=...`. Diagnostics are separate from timing samples.

Raw samples, source hashes, prototype details, CPU self-sample summary and the
independent oracle are in
`benchmarks/baselines/2026-10-27-euler210-investigation.json`.

## Final implementation and verification

The shipped source adds the integer-result registration, `Part'` sum and
250000-cell block described above. The fixture only replaces its obsolete
70-second comment; its inputs and assertions are unchanged. Eleven additional
tests cover wide exact arithmetic feeding a compiled reduction, lazy domain
errors and unused plans, completed-result independence, user overrides, opaque
host demand order and cancellation followed by a fresh exact demand.

The final build was compared with a copy differing only by the reverted
`isqrt` result metadata. The harness's `--original` reconstruction was checked
byte-for-byte against the pre-change main source. Five alternating serial fresh
processes per compiled main variant; a separate three-per-variant reference
cohort. No heavy jobs overlapped admitted samples. One reference sample that
overlapped a small diagnostic run was excluded and replaced at the end; both
the excluded sample and its reason are retained in the raw data.

| Final-build variant | Median | Range | Median process peak RSS |
| --- | ---: | ---: | ---: |
| Original, compiled | 9258.07 ms | 8967.66–9261.37 ms | 615.19 MiB |
| Shipped, compiled | 3005.33 ms | 2936.86–3058.17 ms | 241.23 MiB |
| Original, reference | 9264.70 ms | 8887.08–9472.26 ms | 615.38 MiB |
| Shipped, reference | 11446.61 ms | 11073.88–11568.16 ms | 430.33 MiB |

Compiled execution improves **3.08x** and peak RSS falls by about 61%. Reference
execution has a measured **23.6% time regression**: the deferred expression uses
ordinary lazy traversal when native compilation is disabled. This is a compiled
execution improvement, not an all-engine speedup. Improving reference traversal
remains follow-up work; no execution lanes or timeouts are changed.

A three-pair Euler 200 control has medians 418.07 ms before and 418.36 ms after
the runtime change, with overlapping ranges (414.36–419.24 / 418.04–420.99 ms).
No timing regression was established in this control. Process memory remains
GC-dependent; no Euler 200 memory claim is made.

Validation of the final source:

- TypeScript build passes, including the new tests.
- All **9091 ordinary interpreter tests in 401 files** pass. Exhaustive demo
  type/differential suites and the separate Nurikabe suite are outside this run.
- All 32 integer-square-root tests and **four scoped Euler 210 type/differential
  checks** pass. The main execution exclusion was removed only in the temporary
  validation checkout so the scoped audit actually executed it.
- Forty independent lattice-point oracle comparisons pass on the final source:
  radii 8 through 160 in steps of eight, chunk 3, both execution policies.
- The unchanged fixture passes in both policies, and every final full-input
  timing checks the golden answer **1598174770174689458**.
- Harness syntax and whitespace checks pass.

Final raw measurements, hashes, verification summaries and oracle source are in
`benchmarks/baselines/2026-10-27-euler210-optimization.json`. The initial
investigation data remains separate, so prototype timings are not presented as
shipping-build measurements.
