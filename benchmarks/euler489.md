# Euler 489: factorizations, array state and compiled folds

The full result remains **1791954757162** for `Ma=18`, `Nb=1900`.
The original program is retained in `benchmarks/fixtures/euler489-original.ra`.
The small statement fixture is unchanged.

## Program

For each pair `(a,b)`, every common divisor of the cubics divides the
resultant `a^3 (a^6 + 27 b^2)`. The program factors this integer once, counts
prime multiplicities with an outer comparison and a row count, and constructs
prime powers with array exponentiation. A seeded row fold combines independent
prime-power constraints by CRT. Only singular-root lifting uses an explicit
loop; candidate digits and CRT products use broadcasting and masks.

For all primes not dividing `6a`, combine their complete prime powers into
one modulus `m`. Its totient is the product of `p^(e-1)(p-1)`. A single inverse
then gives `r = -(a^3+3b)/(2a^2) mod m`. This is a common root for the full
modulus: multiplying the two cubic residues by `8a^6` gives respectively
`-(a^3+b)(a^6+27b^2)` and `(a^3-b)(a^6+27b^2)`. Both vanish modulo `m`, and
`8a^6` is invertible there. Consequently no per-prime cubic checks or repeated
good-root lifting are needed. The seeded fold only processes primes dividing
`6a`, retaining all singular roots and the largest valid prime powers.

Completed CRT states are returned explicitly with `concat ... copy`. This
avoids retaining intermediate concat and contract graphs across subsequent
array operations. Empty or negative parameter grids still produce zero.

## Shared compiler support

These changes support existing Rank constructs rather than adding a
workload-specific operation:

- Explicit completion of finite factor/divisor pipelines inside functions,
  including `unique`, using existing native implementations and entry guards.
- Ordinary bound finite ranges, reshape (including inferred dimensions),
  array `powmod`, mask gathers, and mixed native/elementwise array expressions.
- Integer array powers when nonnegative exponents are proved from literal
  values or immutable `count`/`len` results. Unknown array exponents retain
  ordinary evaluation; scalar parameter guards remain in force.
- Stacking equal-rank arrays along a literal axis.
- Exact ordered integer `reduce *`, with the existing empty identity. The
  checked Number specialization replays unsafe products exactly.
- Seeded ordered folds over vectors or matrix rows with a global, pure,
  strict binary callback. Array state may change length. Callback identity,
  dependencies, modules and native implementations are rechecked. Effectful,
  parameter-mutating, unsupported or observable execution retains ordinary
  evaluation. Budgets, inspection, opaque cancellation and compiler hooks do
  not enter the private fold. `compiledFunctionFolds` records actual entries.
- Number-specialized fresh integer vector results: all components are checked
  before publication, with exact replay on overflow. Array results are not
  exposed through the scalar-only Number call ABI. No global Number-array
  size threshold was changed.

An additional correctness gap surfaced while testing folds: a compiled
array expression in `return` was eagerly copied, moving errors into the
returning helper. Returned native recipes now retain array views; when the
reference return propagates a plan, shape and cell construction remain
behind the same demand boundary. Ordinary `=` and ordinary callback
parameters still complete their operands. Captured storage and callbacks
are retained without caching computed cells. Tail-control signals pass
through the delayed-error wrapper without losing their continuation.

Pure exact helpers may borrow private numeric buffers. Error previews for
these trusted views read at most eight stored cells, without evaluating
lazy readers or copying complete buffers.

## Measurements

Frozen baseline runtime: `6466c953194f7eed4c7619d724e147d8b7c73614`.
Both hosts use Node 24.15.0. Normal measurements disable RuntimeDiagnostics.
Processes run sequentially per host; the three compiled rounds alternate old
and new order. The final series was measured on the integrated parent
`0172b6b2`; subsequent argument-boundary repairs produce byte-identical exact
and Number kernels for all four demo functions. Release verification also
includes parent `96ca4813` (range-mask support and unrelated formatting),
then `5c2fd54d` (vector axis sums and Euler 790). The generated helper
kernels remain byte-identical across those integrations.
That new range-mask primitive handles sequences, whereas this demo selects
completed arrays. The codegen receipts and both measured/final runtime hashes
are retained in the baseline JSON rather than claiming identical runtime trees.

Compiled medians of three full runs; RSS is the median of process peak RSS:

| Host | Original time | Final time | Speedup | Original RSS | Final RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Apple M5, 16 GiB | 11.414 s | 6.938 s | 1.65x | 1114.4 MiB | 884.8 MiB |
| Intel i7-10750H, 24 GB | 41.795 s | 22.769 s | 1.84x | 1100.3 MiB | 544.0 MiB |

RSS varies substantially with GC and tiering. Mac original peaks span
641.1–1159.0 MiB and final peaks 540.9–889.7 MiB; Intel spans 908.2–1189.6
and 540.6–858.0 MiB. These medians do not establish a hard memory cap.
Intel was idle before the series; load averages during it were about 1–1.5,
with reported free memory around 8 GiB. A later idle check again showed 99–100% idle CPU
and no active swapping. Historical allocated swap alone is not memory pressure.

Reference execution does **not** show a reliable improvement. Single full
observations in the same series were 20.471 → 23.643 s on Mac and
65.117 → 73.555 s on Intel; the Intel process CPU time also rose from 84.8
to 96.5 s. Reference RSS was 633.4 → 1018.9 MiB and 618.4 → 551.5 MiB.
An earlier series with the same final Rank source gave 22.799 → 19.304 s
on Mac and 69.872 → 70.878 s on Intel. The compiled path improves consistently;
the reference path still pays for function, array and fold bookkeeping and
regresses on Intel in a final reverse-order check as well: new 69.915 s versus
old 64.337 s, with 92.97 versus 84.05 s process CPU time. Peak RSS in that
repeat was 986.1 versus 601.7 MiB. Consequently reference memory does not show
a consistent reduction either. Do not describe this change as a general
interpreter speedup.

Single separation controls, taken before the last parent integration, show
why both program and compiler changes matter. The new demo on the frozen old
runtime took 17.639 s on Mac and 70.211 s on Intel. The old demo on the new
runtime took 11.705 s and 43.414 s. These are controls, not three-run medians.
The separate eager-count variant was rejected: keeping counts inline avoids
an ordinary materialized comparison grid and gave lower compiled peaks in
the alternating control, especially on Intel. Raw observations are retained.

Diagnostic neighbor probes alternate three runs with the same instrumentation:
486 was 184.7 → 184.8 ms on Mac and 438.2 → 449.4 ms on Intel; 487 was
415.1 → 423.9 ms and 836.9 → 831.0 ms. Answers match, median peaks remain
within about 2 MiB, and these small timing differences do not establish a
neighbor speedup. Diagnostic figures are kept separate from normal timings.

Three repeated compiled entries in one interpreter, with forced GC only in
the retained-memory harness, show no growing buffer retention. Final heap
usage was 63.77 → 63.92 MiB on Mac and 47.79 → 47.94 MiB on Intel;
array buffers stayed at 4.036 MiB. Baseline retained heaps were about 79.2 and
83 MiB, with 0.047 MiB buffers. Thus buffers increase by about 4 MiB but remain
stable. Forced-GC retained figures do not measure normal peak memory.

## Verification

An independent C++ oracle retains the old per-level candidate lifting,
uses exact 128-bit modular products and separately implements factorization
and CRT. It gives the same full result, with at most 121 singular roots and
144 combined roots in this input. Exhaustive enumeration over full resultant
periods independently checks all 24 pairs `a<=4,b<=6`; their sum is 16632.
Nine additional singular/high-power pairs and the original fixture are checked
on both numeric backends and with compilation disabled. Empty and negative
grids, lazy results, errors, callback rebinding, budget/cancellation fallback,
array shapes and neighboring compiler paths have focused tests.

Release checks pass 1160 tests in 39 focused files on both Mac and Intel, including
return/control/capture, borrowed-array boundaries, neighboring range masks and
Euler 799 integration. Source and test TypeScript checks, 13 semantic
script tests, 65 semantic owners and application-form checks pass. Language
integration passes 513 tests in four files. Filtered differential runs pass
the full 489 program and its statement fixture on both hosts. A subsequent
264-case check in 11 files covers integration with the latest vector-axis-sum
changes on both hosts, including both Euler 489 and Euler 790. The final
parent also includes `58816459`, which only formats unrelated ACMP demos.
The exhaustive
unfiltered audits and full package suite were not run.

A prototype frame pool was rejected: a reference control took 23.40 s / 667.8
MiB versus 21.73 s / 559.0 MiB without pooling. These are single exploratory
observations, not a universal claim about frame reuse. No frame pool ships.

## Reproduction

From the repository root, after building interpreter output:

```sh
node benchmarks/euler489.mjs compiled
node benchmarks/euler489.mjs reference
node benchmarks/experiments/euler489-compare.mjs /path/to/frozen/out/index.js
node benchmarks/experiments/euler489-codegen.mjs --source
node --expose-gc benchmarks/experiments/euler489-retained.mjs
c++ -O3 -std=c++17 benchmarks/experiments/euler489-oracle.cpp -o /tmp/euler489-oracle
/tmp/euler489-oracle
/tmp/euler489-oracle 4 6 brute
```

`RANK489_RUNTIME` selects a frozen interpreter for individual runs;
`RANK489_DIAGNOSTICS=1` enables separate diagnostic probes.
