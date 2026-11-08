# Euler 495: modular axis prefixes and private array results

The full result remains **789107601** for `N=10000, K=30`; the statement
fixture remains **287549200** for `N=100, K=10`. The original source is retained
in `benchmarks/fixtures/euler495-original.ra`.

The historical issue entry says about four minutes. The current baseline
already benefits from earlier runtime improvements: initial full observations
were 6.50 s on Apple M5 and 22.06 s on Intel. Do not attribute that earlier
improvement to this change.

## Program

The cycle-index algorithm is unchanged. For each partition of `K`, the program
computes the generating-function coefficients of `prod (1-x^part)^-1`, weights
those coefficients by the multiplicities of prime exponents in `N!`, and sums
signed contributions divided by the usual cycle-type denominator modulo
1000000007. The number of partitions at the default input remains 5604.

Legendre sums use a prime-power tensor. A seeded fold constructs multiplicity
rows through prefix offsets, row expansion and scatter; ones fill the remaining
sum after all larger parts. Each contribution expands positive multiplicities
into its part vector. The coefficient function has the program's only explicit
loop. Each step pads and reshapes the state, then uses a residue-class axis
prefix. Products use existing modular folds instead of a separate reduction
loop. All Rank lines fit 40 columns.

The modular prefix is written in one expression:

```rank
Scan = (Matrix scan + axis 0) mod Md
```

An ordinary intermediate binding between `scan` and `mod` would require the
unreduced prefix to be completed first. Neither the compiler nor the rewrite
silently moves the modulus across that boundary.

## Reusable compiler changes

- Number regions compile integer `scan +` followed by a stored scalar modulus,
  including literal tensor axes, negative axes and scalar seeds. Positive
  moduli up to `2^31` keep reduced states in Int32; adding two residues is exact.
  Signed inputs and seeds are normalized. Other moduli, unsupported modifiers
  and callbacks retain ordinary evaluation or exact replay. The stored Int32
  path needs no per-cell safety conversion. Unseeded axis zero has one outer block,
  avoiding per-cell layout division/remainder. The existing plain 1D prefix
  stays supported; bare multidimensional scans retain the native evaluator.
- Number reshapes accept inferred `#` dimensions using the same metadata
  resolver as ordinary reshape. Invalid, ambiguous and zero-size shapes keep
  ordinary errors. Reshape still preserves alias independence on writes.
- A private function region returning a directly initialized local array can
  publish only its result and parameter bindings on success. It still computes
  discarded ordinary intermediates and their errors. Failed execution publishes
  the complete prior state; overflow retains exact replay. Observable budgets
  keep ordinary function execution.
- Range loops without finite native completion retain the existing analytic
  Number consumer. This repairs an admission regression introduced by the
  previous finite-array support: the exact function tier had started completing
  range arrays instead of using the existing range-sum region. The established
  range-sum test detects both the backend and the correct answer.
- Shared scalar inference declines malformed application modifiers instead of
  throwing a raw error during a compilation probe. Ordinary evaluation owns
  error attribution and prior writes.

No global Number-array threshold changed. An initial generic bare-axis Number
prototype was rejected: it slowed the original demo from 6.50 to 9.36 s on Mac.
The array rewrite with separate unreduced prefixes was also slower after full
Number admission. The shipped admission is for the bounded modular operation.

## Measurements

Frozen baseline: `83892c42e5ebffa77c613b9649506d090e5c9cfc`. The delivery parent
also includes unrelated ACMP formatting through `0738ffde`. Both hosts use
Node 24.15.0. Every normal measurement uses a fresh process with diagnostics
and the profiler disabled. Three compiled rounds alternate old/new order,
with no overlapping benchmark/test jobs on the same host.

Compiled medians of three full runs, with median process peak RSS:

| Host | Original | Improved | Speedup | Original RSS | Improved RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Apple M5 | 6.593 s | 5.065 s | 1.30x | 503.9 MiB | 293.9 MiB |
| Intel i7-10750H | 22.767 s | 11.724 s | 1.94x | 315.0 MiB | 264.8 MiB |

Individual compiled peaks span 499.9–504.1 → 289.6–295.2 MiB on Mac and
314.3–319.7 → 264.3–267.3 MiB on Intel. These are observations, not hard caps.

The separation controls are single observations. On Mac the new program on
the frozen old runtime took 4.97 s / 354.3 MiB; the original program on the new
runtime took 6.80 s / 507.9 MiB. The new compiler reduced peak memory for the
rewritten program; its Mac time is close to the existing native kernels.
Do not claim a universal speed advantage over those kernels from one control.

Single reference observations on Mac were 8.03 → 5.55 s and 510.6 → 318.4 MiB.
Intel reference observations were 23.35 → 16.15 s and 315.3 → 276.5 MiB.
On Intel the new demo on the frozen old runtime took 16.33 s / 278.2 MiB,
whereas the original demo on the new runtime took 22.68 s / 318.2 MiB. Both
the rewrite and compiler help on Intel; their timing effects differ on Mac.

A separate three-entry retained-memory probe forces GC after each entry.
Buffers stay flat at 0.036 MiB for the rewritten program on both hosts,
versus 1.572 MiB for the original. Final retained heaps change from 40.12 to
40.47 MiB on Mac and 39.89 to 40.19 MiB on Intel across the three entries;
original heaps change from about 42.3 to 42.8 MiB. Heap usage grows slightly
in both versions. These retained observations are separate from normal peaks.

Raw timings, source/runtime hashes, separation controls and retained-memory
observations are in `benchmarks/baselines/2026-11-08-euler495.json`.

## Verification

Direct enumeration of strictly increasing factors of `N!` checks all 60 pairs
`0<=N<=9, 0<=K<=5`. It does not use integer partitions, prime exponents or the
cycle-index formula. The small enumeration, statement fixture and an additional
`N=1000,K=20` comparison run with compilation enabled, disabled, and Number
loop compilation disabled. Both original and rewritten full programs give
789107601. Zero-factor and unit-factorial cases are covered explicitly.

The 1317-case selected suite in 47 files passes on Mac and Intel. After the
last Int32 fast-path change, the entire selected set passes again on Mac and
75 focused cases in four files pass on Intel. Language inference/application
checks pass 113 tests in two files on both hosts. Source/test TypeScript,
13 semantic script tests, 65 semantic owners and application-form checks pass.
Filtered differential checks of the full program and its statement fixture
pass on both hosts. Logs are in `benchmarks/results/euler495/`.

The repaired analytic helper now enters one Number region and publishes zero
array cells, versus two million published cells before the repair, while
retaining the same result 1000001000000 for the million-element test.

Focused coverage includes signed residues/seeds, modulus bounds, empty axes,
seed growth, wide inputs and exact fallback, invalid dimensions/modifiers,
unused ordinary errors, returned-array ownership, retained intermediate
results and budget/cancellation behavior. The full program returns to the
ordinary audit lane. Unfiltered exhaustive audits/full suites were not run.

## Reproduction

After building interpreter output, from the repository root:

```sh
node benchmarks/euler495.mjs compiled
node benchmarks/euler495.mjs reference
node benchmarks/experiments/euler495-compare.mjs /path/to/frozen/out/index.js
node --expose-gc benchmarks/experiments/euler495-retained.mjs
```

`RANK495_RUNTIME` selects a frozen interpreter. `RANK495_EXPECTED` checks the
answer. Diagnostic and CPU-profile runs are separate optional probes using
`RANK495_DIAGNOSTICS=1` and `RANK495_PROFILE=/tmp/euler495.cpuprofile`.
