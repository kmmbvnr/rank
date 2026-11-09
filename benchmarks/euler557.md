# Euler 557: lazy pair blocks and native numeric storage

Base: `504014bc`. Full N=10000 answer: **2699929328**.

## Program

The exact reciprocal-pair algorithm is retained. Each pair x<=y represents
(x+y)/(xy). Equal reduced fractions form a group; after sorting by fraction
and x, a pair contributes y once for every later pair in that group. This
counts the inner/outer pairs of a valid triangle cut without floating keys.

One loop fills a preallocated packed array from array-based pair blocks.
This keeps all completed blocks and a second full output buffer from being
live together. Overlapping comparison windows stay as a lazy sequence until
`concat unpack` consumes them. The final grouping uses the existing
`unique .counts` library operation. There are no nested loops, and every line
fits 40 columns. A block width of 50 bounds temporary pair matrices.
Packing bases derive from N instead of fixed 16384/32768 limits. Boundary-row
tests check both the former limit and exact values beyond Int64 without
allocating the full quadratic search. Empty/no-match inputs return zero.

## Shared implementation

Stored integers can multiply or floor-divide by a positive power of two via
checked Int64 word shifts, avoiding BigInt per cell. Both signs and matrix
shapes are preserved. A late overflow discards unpublished output and retains
the unbounded integer route. Budgeted evaluation and physical shared Int64
buffers keep ordinary scaling. The Number precision/copy thresholds are unchanged.

Broadcast comparisons can narrow a completed short boxed integer axis once
instead of reading BigInts for every output cell. The existing arithmetic
small-lane cap is reused; opaque, real, wide, budgeted and shared-word inputs
keep their ordinary routes. Logical reversed slices and partial bitmap words
are tested. This makes small pair blocks fast enough to reduce transient memory.

Native self-rebinding sorts can now reuse exclusive private numeric storage
with compilation disabled. This optimization generates no code. Alias, slice,
deferred-reader, borrowed-parameter, replaced-function, budget and interruption
guards remain. NaNs and signed zeros keep their existing generic ordering;
physical shared buffers are never consumed, including integer buffers.

A separate gap found in an alternative search is also closed: structural
numeric functions may guard actual `isqrt` operands when interval bounds cross
zero. Correlated inputs can still have entirely nonnegative differences. A
negative operand abandons private results and replays the ordinary function,
preserving its domain error. Warm positive/negative/positive calls are tested.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Three alternating
fresh-process pairs per mode/input. Time includes parsing and execution and
excludes importing the interpreter. RSS is the process high-water mark.
Diagnostics and profiling are disabled in primary runs. Every full sample
checks the exact answer; fixture samples execute the unchanged statement tests.

| Input / host / mode | Old s | New s | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Full / Mac / compiled | 7.357 | 5.643 | 1246.3 | 1144.6 |
| Full / Mac / reference | 7.767 | 6.492 | 1726.8 | 1139.6 |
| Full / Intel / compiled | 18.647 | 14.529 | 905.1 | 818.4 |
| Full / Intel / reference | 20.165 | 16.918 | 973.8 | 810.3 |
| Fixture / Mac / compiled | 0.164 | 0.169 | 184.5 | 185.8 |
| Fixture / Mac / reference | 0.143 | 0.152 | 181.8 | 181.8 |
| Fixture / Intel / compiled | 0.415 | 0.433 | 176.2 | 174.2 |
| Fixture / Intel / reference | 0.368 | 0.390 | 169.2 | 170.7 |

Full compiled execution improves by 23.3% on Mac and 22.1% on Intel, with
8.2% and 9.6% lower peak RSS. Reference execution improves by 16.4% and 16.1%;
its RSS falls by 34.0% and 16.8%. Small-fixture execution adds 4-23 ms, with
roughly unchanged memory. Intel one-minute loads were 0.32-1.24 during the
primary samples; no other Node job ran on that host in our benchmark sequence.

Single Mac crossover controls isolate the source/runtime dependency. New
source with the old runtime took 9.099 s / 1162.5 MiB compiled and 10.691 s /
1490.9 MiB reference. Old source with the new runtime took 7.146 s / 1310.7 MiB
compiled and 6.956 s / 1359.1 MiB reference. These are individual controls,
not medians: smaller array blocks need the short-axis comparison improvement
to avoid a slowdown; native reference sorting removes a separate large copy.

A direct 200000-cell signed Int64 scaling microbenchmark checks every result
against independent BigInt arithmetic, outside the timed region. Median
multiply-by-16384 time falls from 5.290 to 2.978 ms on Mac and from 13.051 to
8.815 ms on Intel. Floor division by 16384 falls from 7.275 to 2.950 ms and
from 19.222 to 6.519 ms. These kernel timings are not end-to-end speedups.

A pure lazy concatenation of completed pair blocks kept both the completed
blocks and the final full array live. The selected single buffer-filling loop
avoids that duplication. The comparison windows still use deferred names.

## Alternatives and verification

An independent streaming discriminant search checks the full result in
`euler557-oracle.mjs`. It uses bc(T+a)=a^2 d, a formulation also presented in
[this primary explanation](https://ujimatsu-chiya.github.io/project-euler/557/).
Factoring the discriminant gives the exact bound d <= (T-a)^2/(T+a). The full
search examines 111219958 candidates and also yields 2699929328. Its JavaScript
timing was 1.62 s in an exploratory Mac run. It uses a different search, so the
timing measures both algorithm and execution differences.

Array versions of that search used less memory but took roughly 9-10 s in
exploratory single runs; the reciprocal-pair program was selected. A consumer
spanning gcd, ragged expansion and the final validity mask remains a compiler
opportunity. Current array stages still materialize several intermediates.

TypeScript build and 227 focused checks passed on each host. Checks cover independent piece-area enumeration,
exact fraction groups and all matched pairs across comparison windows, full
Number/exact/reference answers, dynamic packing beyond the old limits and
Int64, signed scaling, late overflow, matrices, budgets, shared memory,
correlated roots and ordinary error replay. The former window/group assertions
are preserved with dynamic keys and the renamed retained value. Two filtered
differential checks verify the full demo and its unchanged fixture on each host.
The full demo returns to ordinary corpus execution.

The existing single-return direct path bypasses numeric-function compilation
in five legacy `numeric-function.test.ts` cases. Their route/caching assertions
fail on the frozen base and current runtime; semantic comparisons pass. That
missed compiler route remains open and is not claimed fixed here.
Exhaustive audits/full npm test were not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler557.mjs compiled
node benchmarks/euler557.mjs reference
node benchmarks/euler557.mjs compiled fixture demos/euler/557_cuttingtriangles_test.ra
node benchmarks/euler557-word.mjs '*' 200000
node benchmarks/euler557-word.mjs '//' 200000
node benchmarks/euler557-oracle.mjs 10000
```

`RANK557_RUNTIME` selects a built runtime; `RANK557_MODULE` selects the module
for the unchanged fixture; `RANK557_EXPECTED` checks a golden result. Profiling
and diagnostics are opt-in (`RANK557_PROFILE`, `RANK557_DIAGNOSTICS=1`).
Raw samples: `baselines/2026-11-09-euler557.json`.
