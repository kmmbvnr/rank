# Factorial valuations (#354)

The unchanged Euler 320 demo now finishes its default million-element workload
in a median 9.469 seconds, versus 57.302 seconds at baseline `fc5e820d` (6.05x).
Both runtimes return the exact integer `278157919195482643` in every full run.

## Cause and implementation

The scalar-function proof rejected `max` in the `minimum` helper. That also
prevented the surrounding SPF factor walk from compiling as one region. The
baseline 100,000-element CPU profile shows time in function invocation,
expression evaluation, frame lookup and repeated loop preparation, rather than
only in integer division.

Scalar extrema now have one shared expression proof tree and one selection
code generator, used by loop and function lowering. This replaces the loop's
separate syntax recognizer. The existing callee guards can then bind `minimum`
and its nested `valuation` calls for the whole factor walk. On the official
sample, compiled loop entries fall from 6,379 to 2: the sieve and the factor walk.
Neither run unpacks typed array storage.

Only proven same-domain integer or real operands use this lowering. Mixed
domains and collection reductions retain ordinary execution. Selection preserves
the first operand on ties, including signed zero and NaN, and operands are
evaluated once in source order. Existing builtin identity and closure guards
still apply. The Number backend continues to decline user calls; the compiled
factor walk and helper arithmetic retain BigInt precision.

No Euler source, SPF algorithm, integer division implementation or array storage
contract changed. A broader backend refactor was not needed for this fix.

## Measurements

2026-10-21, Node v24.15.0, Apple M5. Three alternating baseline/current pairs
run sequentially in fresh processes, with profiling and diagnostics disabled.
Execution timings include parsing, compilation, sieve construction and search;
module imports occur before the timer. Every result is asserted. Smaller cases
change only the demo's `Upper` option.

| Upper | Baseline, s | Current, s | Speedup |
| --- | ---: | ---: | ---: |
| 1,000 | 0.340 | 0.266 | 1.28x |
| 100,000 | 5.641 | 1.089 | 5.18x |
| 1,000,000 | 57.302 | 9.469 | 6.05x |

The full baseline samples take 56.256, 57.903 and 57.302 seconds; current samples
take 9.469, 9.380 and 9.531 seconds. Peak RSS is recorded separately in the raw
results; it is a process high-water mark, not a live-heap measurement or an
asymptotic memory bound. The three arrays still require O(Upper) storage.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/factorial-valuations.mjs --baseline=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/factorial-valuations.mjs --cases=1000 --trials=1 --diagnostics=true
node --cpu-prof --cpu-prof-dir=/tmp benchmarks/factorial-valuations.mjs --worker=100000 --runtime=/path/to/baseline/packages/interpreter/out/index.js
```

Evidence:

- [Timing samples](baselines/2026-10-21-factorial-valuations.jsonl)
- [Separate sample diagnostics](baselines/2026-10-21-factorial-valuations-coverage.jsonl)
- [Baseline CPU profile summary](baselines/2026-10-21-factorial-valuations-profile.json)

## Verification and limits

The TypeScript build, semantic-boundary and application-form checks pass.
The language suite passes 1,198 tests; the complete ordinary interpreter suite
passes 4,836 tests in 248 files; ordinary common tests pass 412 tests.
Regression coverage includes the official Euler 320 sample with compilation on
and off, exact integers beyond 2^53 and 2^63, real edge cases, chain grouping,
mixed/collection fallback, destructive operand reads, errors and builtin rebinding.

The root `npm test` run is not clean. Name and type corpus audits were stopped
while executing the unrelated full Euler 261 workload; seven of eight shards in
each audit had passed. No complete corpus or differential-audit pass is claimed.
A separate Euler 261 check at Limit=3,000,000 gives the same `1305678503` on both
runtimes in 1.469/1.474 seconds.

The CLI explain corpus test also fails on the unmodified baseline: it reports
`all` in `230_fibonaccwords_test.ra`, and `round` in `389_platonicdice_test.ra`
and `398_cuttingrope_test.ra`. Those diagnostics are outside this compiler fix.
