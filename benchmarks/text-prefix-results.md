# Repeated short-text prefix scans (#351)

Run after generating the grammar and building TypeScript:

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/text-prefix.mjs 999999
node --cpu-prof --cpu-prof-dir=/tmp benchmarks/text-prefix.mjs 100000
```

The benchmark uses the unchanged Euler 316 KMP body, replacing only `Top` and
`Num`. It checks every measured sum against an independent JavaScript oracle
which enumerates matching prefixes/suffixes without KMP. The official checks
are also covered by interpreter tests with whole-loop compilation enabled and
disabled: `g(535) = 1008`, and `Top=999, Num=1000000` gives `27280188`.

Each fresh process parses once and executes three times in one interpreter.
Timings exclude parsing, oracle construction and output IO. Diagnostics are
enabled in each measured execution; these are instrumented execution times,
not CLI process times. Compare sequential runs without concurrent test/build
jobs. Timings are observations, never test assertions.

## Profile and implementation

The initial Node CPU profile (100,000 inputs, three executions, including
startup/parsing) attributed 6.62% of sampled time directly to `applySelectors`,
8.19% to GC, 3.81% to owned-array creation, and 2.97% to compiled-loop entry.
These are self times, not the total cost of each operation or an allocation
profile. All 99,999 KMP loops per execution were already compiled.

Text reads in those loops still used generic selector dispatch and copied the
entire string into a code-point array on every read. Scalar addressing, axis
selection and collection length separately implemented code-point storage.

`text-storage.ts` now owns that representation and scalar bounds checks.
Compiled loops call it directly. Text without a surrogate pair uses the
original string as its indexable storage; astral text retains code-point
arrays. Lone surrogates still count as individual points. No string cache or
KMP-specific runtime operation was added. Array writes and their aliasing
rules are unchanged.

Remaining costs include function invocation, local array construction and
short-loop entry. This change does not attempt a broader loop compiler rewrite.

## Full workload results

Node v24.15.0, Apple M5, `Top=999999`, `Num=10000000000000000`.
The baseline is `fb1d6972`; the optimized implementation is `b1ae3963`.
Both were built in separate worktrees and measured sequentially.

| Version | Three executions (s) | Median (s) | Process max RSS (MiB) |
| --- | --- | --- | --- |
| Before | 24.916, 22.405, 25.465 | 24.916 | 445.6 |
| After | 25.863, 22.315, 20.640 | 22.315 | 446.7 |

The observed median decreased by 10.4% (1.12× throughput). The overlapping
sample ranges show run-to-run variation; this is not a guaranteed speedup on
every execution. The first optimized execution was slightly slower. Process
RSS was effectively unchanged; avoiding character arrays does not establish
an overall memory reduction.

All six executions returned `542934735751917735`, matching the independent
oracle. Both versions ran 999,998 compiled KMP loops per execution. On this
machine the original version already finishes within 30 seconds, so the issue's
original timeout is not reproduced on the current baseline.

Raw measurements are in `baselines/2026-10-20-text-prefix-before-full.jsonl`
and `baselines/2026-10-20-text-prefix-after-full.jsonl`.

## Verification

- TypeScript project build, semantic boundaries and application-form checks pass.
- Focused text/loop suites: 416 tests pass.
- Ordinary interpreter suites: 4,767 tests in 241 files pass. Run from
  `packages/interpreter` with `node scripts/test.mjs --exclude test/types.test.ts
  --exclude test/differential.test.ts --exclude test/nurikabe.test.ts` (one line).
  These three expensive audits were not run.
- Coverage includes code-point reads/lengths, negative/huge/out-of-range indices,
  lone surrogates, changing text during a compiled loop, KMP failure links,
  mutable array state and copy-on-write aliases.
