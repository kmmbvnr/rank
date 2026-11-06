# Euler 443: use the lazy factorization library

Default N=1000000000000000; answer **2744233049300770**.
Baseline `2fe1da40`, retained in `experiments/euler443-original.ra`.

The [problem](https://projecteuler.net/problem=443) defines g(4)=13 and
adds gcd(n,g(n-1)) at each later index. The existing jump reduction is
retained. At an anchor a with g(a)=3a, let M=2a-1. During unit increments,
gcd(n,g(n-1))=gcd(n,M). For each prime factor p of M the next multiple is
at a+(p-1)/2, so the least factor gives the earliest non-unit increment.
At that index the gcd is exactly p and the value is three times its index.
Between jumps, g(n)=n+2a.

The old source trial-divided M with chunks of up to one million odd
candidates, allocating remainder and selector arrays. The library already
provides a lazy **ascending** factor sequence. `M factors first` therefore
gets the least factor directly. Small factors stream without completing
an unused cofactor; remaining 64-bit values use the existing deterministic
primality test and Pollard-Brent splitting. Default intermediates fit that
domain. The per-interpreter small-factor cache remains bounded at 4 MiB.

A tiny custom `scan` computes the initial values through index 9. The only
explicit loop advances anchors while they remain below N. It replaces the
arbitrary 100000-step cap and handles an exact final anchor by ordinary loop
termination. No duplicate trial division, answer table or new builtin is
introduced. Every production line fits 40 columns.

## Measurements

Node v24.15.0, fresh processes, no heap/GC flags. Times include parsing.
Mac entries are medians of three processes; Intel entries are single
controls. RSS is process peak, with medians of peaks on Mac. The final Mac
controls were rerun after the test process finished to avoid overlapping
benchmark and test work.

| Host / mode | Original s | Final s | Original peak MiB | Final peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 compiled | 1.926 | 0.128 | 491 | 179 |
| Apple M5 reference | 1.873 | 0.119 | 481 | 178 |
| Intel i7-10750H compiled | 5.379 | 0.303 | 278 | 153 |
| Intel i7-10750H reference | 5.430 | 0.287 | 266 | 147 |

Compiled improves 15–18x and reference 16–19x. Peak RSS falls by 45–64%.
These use the measured current baseline, already faster than the historical
18 s in the issue. Both original engines were similar because the old
array arithmetic already used native kernels; the bottleneck was the
chosen factor-search operation.

The jump loop still declines whole-loop compilation at `first`. This is
not the dominant remaining cost: representative final Mac runs spent about
85–87 ms parsing and 28–42 ms executing. No interpreter/compiler changes or
Number-mode guard changes are made in this step. The existing factorization
implementation supplies the general optimization.

## Verification and audit coverage

- TypeScript source/test build and semantic/application-form checks.
- 99 targeted tests in three files on both hosts, including factorization
  and bounded-factor-table regression suites.
- The new demo tests compare 82 selected N values against direct recurrence
  through N=20000, in three modes (246 entrypoint comparisons). Samples cover
  the initial scan and both sides of every anchor through index 1000.
- A 64-unit demand-budget test consumes the first factor of
  3*(2^521-1) in both engines, proving that the unused wide cofactor is not
  fully factored by this consumer.
- All five Rank fixture tests pass in three modes on both hosts. Original
  assertions remain; initial/jump boundaries and the full-default golden
  assertion were added.
- Full default answer in both engines on both hosts. The main's manual
  execution exclusion is removed.

Exhaustive audits and the full suite were not run. Raw measurements are in
`baselines/2026-11-07-euler443.json`.

Reproduce after building:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/experiments/euler443-run.mjs compiled
node benchmarks/experiments/euler443-run.mjs reference
node benchmarks/experiments/euler443-verify.mjs
```

The runner accepts a limit and source path after the mode. RANK443_RUNTIME
can select a separately built runtime by file URL.
