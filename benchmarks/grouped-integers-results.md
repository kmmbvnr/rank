# Grouped integer scans: Euler 309

Measured on 2026-10-20, Apple M5, Node v24.15.0.
Baseline: `36ad7c37`; runtime/demo candidate: `63a3f4f6`.
The baseline includes the `Hs take I` correction: the previous `Hs till I`
returned zero even for the statement checkpoint.

## Reproduce

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/grouped-integers.mjs 200 1000 10000 1000000
node benchmarks/grouped-integers.mjs --index-worker 100000
node packages/cli/bin/cli.js demos/euler/309_ladders.ra
```

The Euler benchmark splits execution at `Answer = 0`. Each phase includes its
parse/prepare time; the reported sum excludes Node startup. Each size runs in a
fresh child process with a 30-second deadline. Diagnostics are cumulative across
the two phases. Known answers are asserted, including `210139` at one million.

## Observations

| Limit | Baseline grouping / pairs | Candidate grouping / pairs | Total before / after |
| --- | --- | --- | --- |
| 10000 | 0.412 s / 1.707 s | 0.422 s / 0.114 s | 2.119 s / 0.535 s |
| 1000000 | Did not complete within 30 s | 3.750 s / 8.327 s | >30 s / 12.077 s |

The full candidate totals in three fresh processes were 16.561, 12.077 and
11.587 seconds; the table uses their median. The smaller case has one sample.
Host load affected timings, including timeouts during competing corpus audits.
A subsequent full CLI run from the rebuilt main checkout, after those checks
stopped, printed `210139` in **12.91 seconds**.

The full phased runs peaked at approximately 1.22–1.27 GiB RSS. There is no
completed full-scale baseline RSS measurement, so these results establish speed
and correctness rather than a full-scale memory reduction.

The separate index case reads 100000 `(integer, integer)` keys and asserts the
sum `4999950000`. The current harness run against each checkout measured
316 ms on the baseline and 119 ms on the candidate. Diagnostics show zero
compiled read loops before and one after; this case excludes data population.

## Changes and verification

- Extract indexed store lowering from the general loop statement compiler.
- Compile integer index reads using a mutation-maintained integer-domain proof.
- Encode integer tuple keys without the structural set codec and JSON.
- Use dense width counters, generate each Pythagorean triangle once, and scan
  height pairs directly without temporary arithmetic arrays.
- Euler checkpoints `0`, `5`, `76`, `1438` pass; reference and compiled execution
  agree on five reduced limits. Full-scale runs return `210139`.
- 4691 ordinary interpreter tests pass, excluding the separate corpus/puzzle
  audits and the compiler-rejection suite. The Euler type/differential audits
  pass, as do 131 SQLite tests after building the native dependency.
- The complete `npm test` run is not green: the compiler-rejection counter test
  and three unresolved-name reports in the CLI explain corpus also fail on the
  baseline. Whole-corpus audits were stopped and are not claimed as passed.
