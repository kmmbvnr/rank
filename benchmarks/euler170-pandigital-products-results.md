# Euler 170: pandigital products

Baseline: `9f0751876ef8b3c4659d74738c76e72f714edb89`, Apple M5, Node v24.15.0.
Only `integer-loop-expressions.js` and `number-loop-runtime.js` differ between
the frozen before runtime and the measured after runtime. The fixture is unchanged.

## Controlled compiled measurements

Three serial fresh processes per version/workload, alternating forward/reverse
version order. Includes parsing and complete execution. Peak RSS is sampled before
validation; it is not retained memory. Profiling and tests did not overlap timing.

| Workload | Before | Compiler only, original algorithm | Final |
| --- | ---: | ---: | ---: |
| Main, seconds | 6.067 | 0.921 | 0.535 |
| Fixture, seconds | 7.732 | 1.205 | 0.759 |
| Main peak RSS, MiB | 267.14 | 235.73 | 236.44 |
| Fixture peak RSS, MiB | 279.70 | 268.92 | 270.25 |

The runtime changes alone improve the main by 6.6x. The final main is 11.3x
faster and the fixture 10.2x faster. Algorithm changes additionally reduce main
execution time by 41.9%. Final peak RSS is 11.5% lower for the main and 3.4% lower
for the fixture. Compared with the compiler-only stage, final peak RSS is slightly
higher; no additional algorithm-stage memory saving is claimed.

## Causes and implementation

The original search reaches the answer after 10,566 output permutations,
5,398,747 cut masks and about 13.8 million gcd steps (counted by a separate JS
translation). Permutations are streamed, not all materialized. The inner search
already compiles, but a blanket ban on condition loops with array writes keeps
it on the BigInt backend. Its scratch array has just 10 elements.

The Number backend now permits condition-loop writes with at most 64 destination
cells in total per invocation. The existing private buffer, safe integer, alias,
binding, builtin, polling and inspection guards remain. Large destinations retain
the exact backend. Overflow discards private state and replays exactly; ordinary
errors publish preceding stores.

Number lowering also handles `bor`, `bit` and `shl` directly with signed Int32
operand checks. Shift counts outside 0..30 and negative `bit` values replay the
ordinary implementation. Left shifts use checked multiplication rather than JS
bitwise shifts, so a wide result never silently truncates. The current builtin
binding is rechecked at every entry.

The demo uses a bounded cut-mask loop. Gcd is accumulated while blocks are built;
once it is one, later blocks cannot raise it, so that cut mask is rejected.
Invalid zero/leading-zero blocks and duplicate factor digits stop immediately.
The descending output order, default digits, multiplier bound and golden answers
are unchanged: 9857164023 (default), 976835214 (digits 1..9).

## Reproduction

Build with `npx tsc -b tsconfig.build.json`, then:

```sh
node benchmarks/euler-pandigital-products.mjs
node benchmarks/euler-pandigital-products.mjs --before-runtime=/path/to/before/packages/interpreter/out/index.js
node benchmarks/euler-pandigital-products.mjs --engine=reference --versions=final --samples=1 --deadline=120000
```

The archived original is `benchmarks/fixtures/euler170-original.ra`.
Raw compiled measurements are in `benchmarks/baselines/2026-10-27-euler170-compiled.json`.
Execution lanes, exclusions and timeouts are unchanged.

## Reference completion and validation

Single serial fresh-process checks (not comparative medians) completed the full
main in 72.030 s and the full fixture in 93.568 s. Both unchanged fixture assertions
passed. The prior original-algorithm reference probe was externally stopped at
60 s, so no reference speedup factor is claimed. General reference execution
cost remains open. Raw completion records are in
`benchmarks/baselines/2026-10-27-euler170-reference-validation.json`.

`test/euler170.test.ts` independently enumerates input digits as the multiplier
and factors, multiplies them, and compares decimal strings. It does not use the
demo's output permutation order, gcd pruning, cut masks or multiplier-width bound.
Eight small digit sets (including zero and positive solutions) match in both
engines. The original full fixture remains unchanged and runs in both engines.

## Verification

- TypeScript project build and interpreter test typecheck pass.
- Semantic boundaries (65 owners) and application-form checks pass.
- **8,799 ordinary interpreter tests in 388 files pass**. The first broad run,
  concurrent with the language suite, exceeded Euler 044's 15 s test deadline;
  that suite passed separately (Euler 044: 4.2 s), and the complete ordinary run
  then passed without the parallel language suite. No deadlines were changed.
- **1,481 language tests in 65 files pass**, including demo-corpus parsing.
- New coverage comprises 26 Number-loop cases, three builtin-rebinding cases,
  and 16 independent Euler checks. It covers total scratch budgets, large-array
  fallback, CoW aliases, exact replay, partial errors, empty loops, signed/wide
  operands, shifts beyond JS's masked range, negative domains, and replaced
  builtin bindings. Exhaustive type/differential and Nurikabe corpora are outside
  the ordinary selection; full Euler 170 is verified directly by the benchmark
  in both engines despite its existing corpus exclusion.

Separate diagnostic runs show 10,566 exact compiled loop entries and zero Number
entries before the changes, versus 10,566 Number entries and zero overflows after
both runtime-only and final changes. The outer permutation traversal still uses
ordinary execution. Each Number entry prepares the current ten-element permutation;
there is no cross-observation plan-result memoization. Raw counters are in
`benchmarks/baselines/2026-10-27-euler170-diagnostics.json`.

## Other-client controls

Three alternating serial fresh-process samples of unchanged current demos, using
the same frozen before/after runtimes. Existing workers validate golden answers.

| Compiled main | Before, s | After, s | Change |
| --- | ---: | ---: | ---: |
| Euler 060 | 2.589 | 2.615 | +1.0% |
| Euler 154 | 9.936 | 9.758 | -1.8% |

Euler 060 has a small timing cost in this sample; the three ranges do not overlap,
so this report does not claim universal speed improvement or zero regressions.
The Euler 170 gain is retained with that measured tradeoff. Neither control's
source or golden answer changed. Raw records, source hashes and memory observations
are in `benchmarks/baselines/2026-10-27-euler170-regressions.json`.
Reproduce the worker cases with `node --expose-gc benchmarks/euler-prime-pairs.mjs
--worker=bits --runtime=...` and `node --expose-gc
benchmarks/euler-pascal-pyramid.mjs --worker=main --version=pruned --runtime=...`,
alternating the runtime in separate processes.
