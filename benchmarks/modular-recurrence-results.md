# Euler 324 modular recurrence

Issue: [#357](https://github.com/kmmbvnr/rank/issues/357).

Measured on 2026-10-21, Apple M5, Node v24.15.0, runtime `ec40f0fd`.
The fix changes the demo only: materialize its fixed coefficient vector once
and copy each 23-cell polynomial result before reusing it. The algorithm and
exact integer arithmetic are unchanged.

Each mode ran three times in fresh processes, sequentially. Mode order reverses
on alternate trials. No builds, tests or profilers ran during this series.
Every run evaluates the full exponent `5 * 10 ** 9999` and checks `96972774`.
Execution time includes parsing, vector construction and recurrence evaluation;
process time also includes interpreter imports and answer verification.

| Mode | Median execution | Median process | Median CPU | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Original lazy vectors | 15.195 s | 15.474 s | 16.809 s | 468.3 MiB |
| Copy the polynomial result | 11.374 s | 11.656 s | 12.993 s | 457.6 MiB |
| Also copy the coefficient vector (final demo) | 8.479 s | 8.768 s | 10.083 s | 461.2 MiB |
| Final demo, Number loops disabled | 7.984 s | 8.267 s | 9.476 s | 456.8 MiB |

The final demo takes 44% less execution time, a 1.79x speedup. Peak RSS is
similar; these observations establish a speed improvement, not a substantial
memory reduction. These are local measurements, not CI timing gates.

## Implementation findings

Both nested product/reduction loops already compile. The outer binary loop
falls back because its `combine` call returns an array. Its BigInt exponent
does not require a new loop backend to complete this workload.

The returned `take` view and the concat-built coefficient vector send repeated
reads through selectors, lazy caches and dependency revision checks. Copying
these short vectors lets existing stored-array readers avoid that work.

Separate full-scale diagnostic runs counted 71,482,414 validation requests and
52,664,523 dependency validations in the original; both counts fall to 20 in
the final demo. Both runs entered 89,804 compiled loops. A separate CPU profile
of the original attributed 11.5% of self samples to `readArrayItem`, 10.2% to
`atArray`, 7.3% to derived `itemAt`, and 11.4% combined to `valueRevision`,
`revisionFrame` and `arrayRevision`. These are sampled self times, not inclusive
call-tree costs. Profiling and diagnostic timings are excluded from the table.

The Number backend remains checked: large intermediate products overflow its
safe integer range and replay through the exact backend. Disabling it saves
about 0.50 s (6%) on the final demo. The production runtime keeps its existing
specialization policy; this task adds no backend or retry heuristic.
The final diagnostic run records 89,793 overflows from 89,804 Number attempts.

A general optimization for lazy operands in mutating loops would need to prove
that each borrowed source stays independent of writes, including aliases and
retained selections. That runtime refactor is deferred: the two explicit copies
resolve this workload without changing lazy evaluation or mutation semantics.

## Verification

The full workspace build, semantic-boundary checks and application-form checks
pass. The Euler 324 test fixture passes through the CLI, its inferred-type audit,
and a differential run with compilation enabled and disabled. These are focused
tests; the complete test suite was not run. The benchmark also checks each finite
checkpoint in all four modes. A separate native JavaScript BigInt implementation,
reducing after each accumulation, reproduced the three checkpoints and the full
answer.

## Reproduction

```sh
npx tsc -b tsconfig.build.json
node benchmarks/modular-recurrence.mjs
node benchmarks/modular-recurrence.mjs --digits=5 --trials=1
node --cpu-prof benchmarks/modular-recurrence.mjs --worker=lazy --diagnostics
node benchmarks/modular-recurrence.mjs --worker=stored --diagnostics
node packages/cli/bin/cli.js test demos/euler/324_tower_test.ra
```

`--digits=0`, `2` and `5` check the three finite checkpoints. `--runtime=/path/to/packages/interpreter/out/index.js`
selects a separately built runtime. The `lazy` mode reconstructs the original
demo by removing the two copies; the `copy` mode materializes only the result.
`stored-exact` uses the final source with Number-loop compilation disabled.

[Raw timings and source hashes](baselines/2026-10-21-modular-recurrence.jsonl).
[Separate diagnostic runs](baselines/2026-10-21-modular-recurrence-diagnostics.jsonl).
