# Euler 790: compiled block sweep

Issue: https://github.com/kmmbvnr/rank/issues/563

The default 100000-rectangle run returns `16585056588495119` in **25.27 s**
on the local arm64 Mac and **57.70 s** on the Intel x64 host. Both used
Node v24.15.0 with an 8192 MiB heap limit. Peak process RSS was 453.33 MiB
and 443.57 MiB respectively. Times include parsing and are individual runs,
not medians. The issue's approximately 7.5-minute full baseline was not
repeated; there is no new full-baseline RSS measurement.

## Compiler and runtime first

Profiling the original 1000-rectangle source found boxed array reads and
materialization dominating execution. The following changes are general:

- Tensor gathers accept integer selector frames of any rank into a vector
  source. The existing emitter already preserves their frame and broadcasts
  consumers; its binding guard previously admitted vectors only.
- Numeric vector loops inline Boolean/integer-to-integer conversion and fuse
  integer `sum axis` over pointwise producers. The latter accumulates directly
  into the reduced output, without materializing the full broadcast product.
  Checked arithmetic replays through exact execution on overflow.
- Copy-cost admission recognizes immutable entry-vector lengths and completed
  pointwise passes. These proofs use native metadata and existing guarded
  indexed facts; they do not execute callbacks. Proven work can admit a mixed
  loop even after the initial Number attempt overflows its accumulator.
- Temporary-buffer allocation no longer scans immutable entry bindings, which
  cannot reference this invocation's pool. Rebound locals, aliases, iteration
  binders, operands and retained results still pin their buffers. The remaining
  scan avoids recursive callbacks for each retained value.

The full loop uses checked numeric array operations with an exact BigInt total.
One speculative Number overflow is expected, followed by a mixed loop. An
experiment collecting strip areas in a separate array was discarded: fixing
cost admission preserves the original exact accumulator without that storage.

## Rank implementation

The sweep and coordinate compression are unchanged. Rebuilding each partial
block previously expanded every interval across 12 shifts. It now uses
`.accumulate` to sum interval lengths into 12 residue bins, then multiplies
those bins by the small constant clock table. This replaces a `Chunk x 12`
product per block with a histogram pass and a `12 x 12` product.

The set of one or two boundary blocks is expressed as a short arithmetic range
instead of constructing and deduplicating a two-element array. This equivalent
representation fits the existing numeric loop backend. There is still one
Rank loop and no new language primitive or problem-specific runtime kernel.
The default `Chunk=512` is retained; a 128-element trial did not improve time.

## Measurements

| Mac probe | Time | Peak RSS |
| --- | ---: | ---: |
| Original source/runtime at `1ca4d8c3`, 1000 rectangles, CPU profiler | 3.15 s | 396.16 MiB |
| Original source + multidimensional gather, same profiled probe | 1.98 s | 371.44 MiB |
| Compiled original block rebuild, equivalent boundary range, 1000 rectangles | 1.01 s | 248.73 MiB |
| Compiled histogram + cost admission, 1000 rectangles | 0.47 s | 271.25 MiB |
| Full histogram, before buffer-liveness improvement | 31.22 s | 457.48 MiB |
| Full final implementation | 25.27 s | 453.33 MiB |

On Intel, the full run improved from 67.20 s before the buffer-liveness change
to 57.70 s after it; a separate repeat took 58.05 s with 444.63 MiB peak RSS. Smaller profiled probes measure compiler/runtime effects;
they are not extrapolated to claim a full-baseline speedup. RSS includes V8,
parsing and transient garbage, so it is not a retained-storage measurement.

## Correctness and validation

An independent compressed raster visits every rectangle's cells and computes
the area-weighted hours directly. It generates coordinates by repeated
squaring, independently of the demo's exponent reduction. Both execution modes
match it at 0, 1, 2, 10, 25 and 100 rectangles, with block sizes 1, 4, 17 and 512.
The original 1000-rectangle fixture also matches. Statement values, including
`C(100)=16190667393984172`, agree with the
[official problem](https://projecteuler.net/problem=790).

Compiler tests cover multidimensional/empty gathers, invalid and missing
indices, alias snapshots, integer conversions, axis order and broadcasting,
empty dimensions, invalid axes, wide sums, budget observation, copy admission,
overflow replay and buffer reuse. The full answer is registered in
`full-scale-demos.test.ts`; expensive reference runs remain outside repeated
corpus audits. Build, 471 focused Mac tests and the full-answer test passed;
79 selected Intel tests passed after the timeout adjustment below. Semantic
boundary checks passed. Exhaustive audits were not run.

The original-fixture comparison has a dedicated 20-second test timeout: its
interpreted source exceeded the default 5 seconds on Intel. Its values passed;
this adjustment does not change runtime behavior or the benchmark target.
The full correctness case allows 120 seconds for busy CI hosts; standalone
measurements, rather than a machine-dependent test timeout, establish speed.

## Reproduction

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node --max-old-space-size=8192 benchmarks/euler790.mjs
RANK_SOURCE=benchmarks/fixtures/euler790-original.ra \
  PROFILE=/tmp/e790.cpuprofile node benchmarks/euler790.mjs 1000
npm test --workspace @arrrank/interpreter -- test/euler790.test.ts test/number-loop-axis-sum.test.ts
npm test --workspace @arrrank/interpreter -- test/full-scale-demos.test.ts -t 790_clockgrid
```

`RANK_INTERPRETER=/absolute/path/to/packages/interpreter/out/index.js` selects
an older built runtime. `COMPILED=0` selects reference execution; `CHUNK=128`
changes the block size for experiments. The driver records the exact answer,
wall time, process peak RSS and runtime diagnostics. Use fresh processes and
avoid concurrent workloads when comparing wall times.
