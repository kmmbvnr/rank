# Euler 746: sparse integer matmul and word-based tensor loads

Issue: https://github.com/kmmbvnr/rank/issues/547

The Rank source and algorithm are unchanged, including Families=2021,
Prime=1000000007 and the 9x5x2022 tables. The full answer remains `867150922`.
The actual transfer loop has 4040 iterations, Length=3..4042 inclusive; the
initial table represents length 2. No search bounds or state counts were reduced.

## Full-input measurements

Baseline: main `8113e48d`. Source is frozen in `fixtures/euler746-original.ra`
and remains byte-identical to the demo. Node v24.15.0, Apple M5 arm64 macOS
and Intel i7-10750H x64 Linux, normal CPU affinity. One baseline and three
serial final fresh-process measurements per host. Other machine load and
frequency were not controlled; baseline variance was not measured. Timings
include parsing and execution. CPU time is recorded separately in raw JSON.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 24.45 | 7.28 / 7.31 / 7.41 | 3.35x | 447.28 | 386.97 |
| Intel | 60.75 | 26.31 / 26.70 / 26.54 | 2.29x | 371.65 | 308.39 |

Every full run returned the same answer. Median peak RSS fell by 13.5% on Mac
and 17.0% on Intel. Every final peak was below its host's baseline. RSS measures
the whole process, not only live table storage or total allocation volume.
The Mac speedup does not transfer unchanged to Intel.

Raw measurements are in `results/euler746/base-*-full.json` and
`final-*-{1,2,3}.json`; `summary.json` contains derived medians and ratios.
The issue's older 32-second figure is not substituted for either measured baseline.

## Profile and general implementation changes

At Families=300, the original self-sampling profile placed `denseMatmul`
(144 samples) and `contiguousNumberMatmul` (78) alongside generated tensor
arithmetic (172 anonymous samples) at the top. Garbage collection, integer
bounds and axis reductions were secondary costs. Profiles are short diagnostic
runs, not precise full-input time attribution. Summaries are retained in
`profile-summary.json`.

Three general changes address those costs:

1. Exact integer matrix outputs are written through signed high and low Int32
   words rather than creating a BigInt for each result. The existing absolute
   product bound proves every partial sum and result is in +/- (2^53-1).
   The low bits and floor(value/2^32) therefore reconstruct the exact Int64
   result, including negative values and carries. Output type remains integer.
2. A wide contiguous integer matrix product can use a sparse left matrix.
   The left matrix must have at most half its entries nonzero, and its cell
   count must not exceed the output column count, so preparation amortizes.
   Nonzero coefficients and right-row offsets are collected locally per call,
   with no persistent cache. Unit rows use sums; other coefficients use exact
   multiply/add. Empty rows remain zero. This avoids zero multiplications,
   the right transpose and a full Float64 output scratch buffer.
3. The checked Number tensor-copy kernel loads Int64 leaves through signed
   high words and unsigned low words. It reconstructs a Number and still
   requires Number.isSafeInteger before using it. Values outside the safe
   domain discard private output and replay the ordinary exact kernel.
   This removes per-cell BigInt loads/comparisons/conversions after matmul.

These are language implementation changes. No transition matrix or Euler
recurrence is encoded in a new intrinsic, and no Rank program edits are needed.

The sparse path is integer-only and inherits the existing absolute-product
bound. Real products retain their original accumulation order and all zero,
NaN and infinity behavior. Unsupported dimensions, axes, storage and unsafe
bounds retain the previous paths. Observable demand budgets and host polling
also retain their ordinary traversal. Private work remains cancellation-polled.
Operands are never modified. Tensor inputs backed by a shared Int64 buffer
retain exact loads rather than introducing two potentially torn word reads.

The proof for word loads is valid at both signs of the Number boundary:
within the safe range, high*2^32+low is exact; outside it, the reconstructed
value cannot become a safe integer. The existing guard therefore preserves
exact replay. Buffer byte offsets, logical offsets and native view layouts
remain part of addressing.

## Exploratory steps

All earlier trials remain separate from the final series:

- `words-*`: exact word output packing only, full Mac 18.87 seconds.
- `sparse-*`: initial sparse integer product, full Mac 14.13 seconds.
- `sparse-bounded-*`: sparse admission restricted to wide products,
  full Mac 12.46 seconds.
- `unbox-*`: first word-reader trial, full Mac 7.16 seconds.
- `final-trial-*`: corrected multiple-buffer declaration emission,
  full Mac 7.64 seconds, before the three final primary runs.

These are single exploratory samples; do not treat their differences as
controlled marginal effects or pool them with the final series. Initial matrix
changes alone did not lower observed process peak RSS; memory savings were
measured only after the combined final implementation.

## Kernel controls

`experiments/euler746-kernels.mjs` times matmul directly on completed arrays,
and separately times a checked tensor expression after parser initialization.
Setup and independent BigInt output verification occur outside timing; real
controls verify the same ordered floating sum. Peak RSS is captured before
verification. Each row below uses three paired baseline/final fresh processes.

| Operation | Mac baseline / final median ms | Intel baseline / final median ms |
| --- | ---: | ---: |
| Sparse integer 9x9 by 9x10110 | 6.70 / 2.53 | 20.34 / 6.36 |
| Dense integer, same dimensions | 6.91 / 6.13 | 20.13 / 15.89 |
| Real dense control, same dimensions | 4.74 / 4.80 | 10.99 / 10.91 |
| Int64 `(A+B) mod M`, 1048576 cells | 39.71 / 17.37 | 112.22 / 42.58 |

The integer paths improve; the real control remains effectively unchanged.
Raw controls are `kernel-controls-{mac,intel}.jsonl`.

## Verification and reproduction

On both Mac and Intel, 149 focused tests and the full default Euler 746 golden
test passed (9.30 and 28.09 seconds under the runner). Another 54 linear algebra
and contiguous-matmul tests passed on each host. TypeScript build passed.
Full suites and exhaustive audits were not run.

Tests include independent complete cyclic-word enumeration for Families=1..6,
exact inclusion/exclusion with two primes in both compilation modes, and the
existing Families=10 example. Runtime coverage includes weighted sparse rows,
zero rows, signs and carries, safe Number boundaries, values outside that
range, exact cancellation fallback, buffer byte offsets, slices, broadcasts,
shared Int64 buffers, snapshots, cancellation and demand budgets. Existing
real tests cover rounding order, NaN, infinities and signed zero.

From the repository root after building:

```sh
EXPECTED=867150922 node benchmarks/euler746.mjs
DIAGNOSTICS=1 PROFILE=/tmp/euler746.cpuprofile \
  node benchmarks/euler746.mjs 300
RANK_ROOT=/path/to/baseline \
  node benchmarks/experiments/euler746-kernels.mjs sparse
node benchmarks/experiments/euler746-kernels.mjs tensor
```

Focused tests, from `packages/interpreter`:

```sh
node scripts/test.mjs test/integer-matmul.test.ts \
  test/sparse-integer-matmul.test.ts test/tensor-int64-words.test.ts \
  test/euler746.test.ts test/tensor-modular-product.test.ts \
  test/tensor-copy-storage.test.ts test/native-tensor-copy.test.ts \
  test/tensor-copy-fusion.test.ts test/vector-modular-product.test.ts
node scripts/test.mjs test/linalg.test.ts test/contiguous-matmul.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t 746
```
