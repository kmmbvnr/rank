# Euler 642: fused array statement chains (#505)

The unchanged Euler 642 demo now runs below 15 seconds on the reference machine.
The exact Region backend recognizes pure local assignment chains ending in a
unique linear rank-1 array write. Range-derived arithmetic, comparison masks,
min/max, integer gathers and choose lower to one element loop. Shared expressions
are computed once per cell. The private output is committed only after every
source read completes, preserving overlapping reads and writes.

No demo algorithm or source changes were needed. Both outer prime loops remain
compiled (`compiledLoops = 2`, `numberLoops = 0`). The full workload completes
76,632 fused regions covering 319,554,515 destination cells. CLI `--diagnostics`
now prints `fusedArrayRegions` and `fusedArrayRegionCells`.

## Implementation checks

A hand-written snapshot kernel for the first sieve at N = 4*10^10 took 0.183 s
versus 3.782 s for the current Rank path. Every cell in both resulting tables was
compared, not just the final answer. This was a feasibility experiment, not the
whole-program speedup.

The first general guarded implementation took 16.387 s for the default input.
Sharing per-cell scalar expressions and using established Int32/range bounds
removed redundant checks; a follow-up exploratory run took 12.381 s. Both gave
631499044. The repeated final samples below measure the delivered implementation.

## Final measurements

Apple M5, Node v24.15.0, macOS arm64. Base revision: `8598c2ba`.
Three fresh sequential off/on process pairs per input, using the same build.
`tensorFusion: false` disables array regions and existing expression fusion;
both modes keep the exact compiled prime loops. This is an end-to-end control,
not an isolated kernel throughput comparison. Imports and construction are
excluded; parsing and execution are included. Every answer and loop count is
asserted by the harness.

| Input | Off median | On median | Answer |
| --- | ---: | ---: | ---: |
| N = 10^9 | 1.393 s | 0.714 s | 895017934 |
| Default N = 201820182018 | 25.620 s | 13.009 s | 631499044 |

Default speedup: **1.97x**. All three on samples are below 15 seconds:
12.918 / 13.279 / 13.009 s. Peak process RSS medians are 1322 MiB off and
951 MiB on (about 28% lower). CPU medians are 41.206 s off and 17.032 s on.

Raw samples: [2026-11-01-euler642-fusion.json](baselines/2026-11-01-euler642-fusion.json).

```sh
node benchmarks/euler642-fusion.mjs off
node benchmarks/euler642-fusion.mjs on
node benchmarks/euler642-fusion.mjs off 201820182018
node benchmarks/euler642-fusion.mjs on 201820182018
node packages/cli/bin/cli.js --diagnostics demos/euler/642_largestprimefactors.ra --n=10000
```

## Guards and limits

Local names must have no existing binding or uses/writes outside the chain.
Escaping results, empty or duplicate destination ranges, untracked/lazy inputs,
unsupported shapes, inspection and observable host polling retain the original
statements. Ready boxed integer arrays may be copied with revision-based reuse;
compact Int32/Int64 storage is borrowed during the synchronous computation.

Array bounds and divisors must also prove that eliminating a named intermediate
cannot hide its ordinary error, including an unselected gather. Cell arithmetic
outside Number's safe-integer range declines before destination mutation and replays the exact statements.
Narrow output widens privately when needed. Cancellation and demand exhaustion
leave partially calculated output private. Compound results include the original
destination exactly once and commit as replacement over unique selectors.

## Verification

- `npm run build` passed.
- 775 focused interpreter tests passed across eight files: array-region,
  region-boolean-arrays, integer-loop, number-loop, number-loop-vectors,
  slice-write-snapshots, slice-writes and interrupt.
- Five CLI diagnostics tests passed; a real CLI run reports fused regions.
- Both Euler 642 fixture cases passed (N = 10, 100, 10000 and 10^9).
- Full `npm test` and exhaustive corpus audits were not run.
