# Bulk integer bit reads

`bit` now has a native batch path for scalar integers, integer arrays and native
integer ranges, with ordinary scalar broadcasting. A scalar BigInt is decoded
once per batch. Small values use machine bit operations; varying wide array
values retain exact BigInt arithmetic. Results use the existing packed boolean
storage, so masks, boolean operations and reductions can consume them directly.
No Euler-specific bounds, constants or expression matching are involved.

The path checks the builtin identity and implementation. Opaque readers, failed
domains, inspection, host callbacks and demand budgets retain the ordinary
mapper. Private output is discarded on domain failure. Cancellation propagates.
Sources are read through native integer proofs, without invoking user callbacks.
No input storage is changed and no decoder survives the batch.

## Measurements

Node v24.15.0 on ARM64 Mac and x86_64 Intel. Three alternating fresh processes
per version and mode; each worker warms up three times and reports the median
of nine timed executions, including parsing and normal Rank demand. Values below
are medians across the three processes. Every result is checked against an
independent JavaScript oracle. Host load was not controlled.

Before and after use the same compiled worktree, including pre-existing edits;
before only removes the new `mapIntegerBits` dispatch from `rank-application.js`.
These measurements isolate this change from the other pending optimizations.

| Expression | Mac compiled before → after | Intel compiled before → after |
| --- | ---: | ---: |
| range-mask-sum | 37.31 → 1.67 ms (22.3×) | 141.64 → 4.20 ms (33.7×) |
| range-count | 4.13 → 0.62 ms (6.6×) | 17.19 → 1.76 ms (9.8×) |
| irregular-count | 2.65 → 1.33 ms (2.0×) | 7.76 → 3.19 ms (2.4×) |
| values-scalar-bit | 2.38 → 1.58 ms (1.5×) | 7.01 → 4.39 ms (1.6×) |
| pairwise-bit | 2.71 → 1.37 ms (2.0×) | 8.02 → 3.60 ms (2.2×) |
| broadcast-bit | 71.21 → 27.69 ms (2.6×) | 184.92 → 75.64 ms (2.4×) |
| combined-masks | 8.89 → 1.72 ms (5.2×) | 30.00 → 4.13 ms (7.3×) |

Reference mode uses the same native path, without requiring the JIT.
Reference speedups on mac: 1.5–28.3×.
Reference speedups on intel: 1.8–41.0×.

The synthetic masks have 40,000 bits; index ranges have 28,123 elements and the
broadcast case has 449,968 results. These are expression timings, not full Euler
program speedups. The actual unchanged Euler 23 demo also returned 4179871 with
compilation both enabled and disabled. No new phone measurements were made.

Reproduce after `tsc -b tsconfig.build.json`:

```sh
node benchmarks/bit-arrays.mjs compiled
node benchmarks/bit-arrays.mjs reference
```

`RANK_BITS_RUNTIME=file:///absolute/path/index.js` selects an isolated runtime.
Raw samples are in `baselines/2026-11-03-bit-arrays-{mac,intel}.jsonl`.

## Verification

334 tests passed across 15 focused files. Coverage includes scalar and array
inputs, wide integers, reversed and
irregular positions, repeated indices, broadcasting, slices, empty arrays,
source mutation, replacement bindings, negative domains, unread later errors,
opaque readers, cancellation and demand/polling guards. Related ranked, packed
boolean, missing-cell, shape-contract and integer-loop tests were also run.
The TypeScript build and semantic-boundary checks pass. Full/exhaustive audits
were not run.
