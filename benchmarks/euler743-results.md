# Euler 743: exact modular products in tensor copy kernels

Issue: https://github.com/kmmbvnr/rank/issues/546

Width=100000000, Length=10000000000000000 and Prime=1000000007 are unchanged.
The full answer remains `259158998`. The algorithm still sums 50000000 terms
using two modular product scans per chunk. The only Rank change is a smaller
working chunk, from 4194304 to 262144 cells.

## Current baseline and full-input results

The issue reports 40 seconds. Current main already runs substantially faster:
the stored-array modular callback scan introduced for Euler 739 also applies
here. The baseline at `5db99d8c` is 5.30 seconds on Mac and 11.05 on Intel.
The old 40-second result was not reproduced on its original environment; it
must not be used as the baseline for attributing this new change's speedup.

Node v24.15.0; Apple M5 arm64 macOS and Intel i7-10750H x64 Linux, normal CPU
affinity. One baseline and three serial final fresh-process runs per host.
Other machine load and frequency were not controlled. Baseline variance was
not measured. End-to-end times include parsing; CPU time is recorded separately.

| Host | Current baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 5.30 | 3.16 / 3.07 / 3.08 | 1.72x | 689.13 | 282.67 |
| Intel | 11.05 | 6.65 / 6.51 / 6.90 | 1.66x | 675.79 | 273.23 |

Every full run returned the same answer. Median peak RSS fell by 59.0% and
59.6%, respectively. Peak RSS measures the whole process, not live DP storage
or allocation volume. The new patch is an additional roughly 1.7x improvement
over current main, not a new several-fold improvement over that baseline.

Raw data and derived medians are in `results/euler743/`. Baseline source is
frozen in `fixtures/euler743-original.ra`.

## Compiler before source changes

A CPU profile at Width=8000000, Length=64000000000000, Chunk=262144 sampled
most arithmetic time inside generated tensor kernels, followed by the already
native modular scan and array reversal. The sample counts are in
`profile-summary.json`; diagnostic timings are not pooled into the full series.

The private Number copy kernel previously emitted a checked product followed
by a remainder for `A * B mod M`. A product outside the safe Number integer
range discarded that private output and replayed the exact BigInt kernel.
This was correct, but unnecessary when the modular result itself is compact.

The tensor compiler now recognizes this expression and calls the existing
`checkedNumberModularMultiply` directly, just as the scalar-function and
Number-loop backends already do. Inputs still pass the existing safe integer
checks. The shared helper normalizes signed operands and uses the existing
exact modular multiply for integer moduli in 1..2^30. No rounded
wide product is exposed as a language value.

Unsupported moduli, unsafe inputs and unsupported layouts retain exact replay.
The fusion requires plain multiplication/remainder nodes with compatible
product/output shapes. Ranked operations keep their previous path. The
existing destination-alias guard, private output, demand checks and cancellation
behavior remain in force. No new syntax or problem-specific intrinsic is added.

Before reducing Chunk, one full run with the compiler change alone measured
2.98 seconds on Mac and 6.44 on Intel at the original Chunk=4194304. Peak RSS
was 704.02 and 673.02 MiB. This isolates the speed gain from the source change;
it does not establish memory savings from the compiler alone.

## Memory and working chunk

Exploratory Mac runs at Chunk=262144 and 1048576 measured 2.97 and 3.06 seconds,
with peaks of 284.28 and 441.25 MiB. The original large chunk used about 704 MiB
with the compiler change. A 262144-cell chunk retains throughput while reducing
temporary-array size, so it becomes the default.

This changes the partitioning from 12 to 191 chunks, not the number of terms,
formula, modular arithmetic or search bounds. There are now 382 native scans
rather than 24. Extra modular inverses occur once per chunk and do not dominate
the measured runtime. Users may still override Chunk explicitly.

## Kernel controls

`experiments/euler743-tensor.mjs` uses 1048576 completed Int32 operands.
It initializes the parser before timing, runs one tensor expression and checks
every result against a BigInt oracle after timing. RSS is captured before that
verification. Each row below is a median of three paired baseline/final fresh
processes. The unrelated addition control remains effectively unchanged.

| Operation | Mac baseline / final ms | Intel baseline / final ms |
| --- | ---: | ---: |
| `A * B mod M` | 16.80 / 11.28 | 45.37 / 27.21 |
| `A + B` control | 7.72 / 7.72 | 17.78 / 17.49 |

Raw warmed controls are `kernel-controls-{mac,intel}.jsonl`. Earlier cold-parser
measurements are preserved separately in `kernel-controls-*-cold.jsonl` and
are not pooled into these medians. Cold Intel records alternate baseline then
final, three pairs for product followed by three pairs for addition.

## Verification

TypeScript build passed. On both Mac and Intel, 154 focused tests passed, plus
the full default Euler 743 golden test (4.55 and 10.83 seconds under the runner).
Coverage includes:

- Independent enumeration of actual binary row pairs and every sliding window
  for small inputs; published A(3,9)=560 and A(4,20)=1060870.
- Direct integer coefficient sums with different chunk sizes, odd widths,
  partial chunks and multiple primes, in both compilation modes.
- BigInt oracles for signed safe inputs, unsafe products, modulus boundaries,
  scalar/array operands, compiled-kernel reuse and exact fallback.
- Nested expressions, broadcast/view layouts, wide values, snapshots,
  cancellation, demand budgets and existing tensor/scan regressions.

The published values come from https://projecteuler.net/problem=743.
Full suites and exhaustive audits were not run.

After building, from the repository root:

```sh
EXPECTED=259158998 node benchmarks/euler743.mjs
EXPECTED=259158998 node benchmarks/euler743.mjs 100000000 4194304
DIAGNOSTICS=1 PROFILE=/tmp/euler743.cpuprofile \
  node benchmarks/euler743.mjs 8000000 262144
RANK_ROOT=/path/to/baseline node benchmarks/experiments/euler743-tensor.mjs product
```

Focused tests, from `packages/interpreter`:

```sh
node scripts/test.mjs test/tensor-modular-product.test.ts \
  test/euler743.test.ts test/vector-modular-product.test.ts \
  test/tensor-copy-fusion.test.ts test/native-tensor-copy.test.ts \
  test/modular-array-callback-scan.test.ts \
  test/modular-product.test.ts test/tensor-copy-storage.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t 743
```
