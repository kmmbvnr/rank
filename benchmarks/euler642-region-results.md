# Euler 642: boolean arrays and choose in regions (#504)

Both unchanged prime loops now compile through the exact-value Region backend.
Diagnostics report `compiledLoops = 2` and `numberLoops = 0`. Comparisons keep
boolean arrays; choose, min/max, gathers and indexed bulk writes use existing
runtime operations. Intermediate arithmetic stays exact, including the second
loop's large prime powers. This compiles statement dispatch and does not fuse
the array passes; that work remains in #505.

Array call lowering guards builtin identity and implementation integrity.
Compiled bulk stores reuse the ordinary assignment contract, preparing selectors
before the RHS and preserving duplicate-index semantics, snapshots, shape errors
and preceding writes on failure. The existing boolean range-store path is retained.

## Measurements

Apple M5, Node v24.15.0, macOS arm64; base `5c82e146`. Each sample is a fresh
sequential process. Off/on use the same build, changing only
`integerLoopCompilation`. Off reproduces the original two uncompiled loops.
Timings include parsing and execution; imports and construction are excluded.
Every sample checks the answer and the compiled-loop count.

| Input | Loops off | Loops on | Answer |
| --- | ---: | ---: | ---: |
| N = 10^9, median of three | 1.284 s | 1.294 s | 895017934 |
| Default, one pair | 23.753 s | 24.888 s | 631499044 |

There is no measured speedup. The default on sample is 4.8% slower; a single
pair does not establish a stable timing difference. Peak RSS in that pair was
1101 MiB off versus 1528 MiB on, so this change is not a memory optimization.
On the reduced input, all on samples report two compiled loops and all off
samples report zero. Existing tensor-update fusion is not used by the newly
compiled exact regions; their array operations remain separate passes.

During investigation a direct scalar `min/max` call caused a roughly fourfold
slowdown. Reusing the existing compact integer kernel removed that regression;
the table measures the final implementation, not that intermediate version.

Raw samples: [2026-11-01-euler642-region.json](baselines/2026-11-01-euler642-region.json).

```sh
node benchmarks/euler642-region.mjs off
node benchmarks/euler642-region.mjs on
node benchmarks/euler642-region.mjs off 201820182018
node benchmarks/euler642-region.mjs on 201820182018
```

## Verification

- `npm run build` passed.
- 753 focused interpreter tests passed across eight files: region-boolean-arrays,
  integer-loop, number-loop, number-loop-vectors, slice-write-snapshots,
  slice-writes, boolean-masks and interrupt.
- The existing Euler 642 fixture passed both cases, covering N = 10, 100,
  10000 and 10^9; the full default answer was also checked by the benchmark.
- Full `npm test` and exhaustive corpus audits were not run.
