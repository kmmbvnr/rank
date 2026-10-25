# Ranked addressing measurements

Measured locally on 2026-10-25, macOS arm64, Node v24.15.0. Two warmup rounds
and seven measured rounds per variant, with explicit GC before each timed run.
The final measurement ran after the test processes finished.

Source/selector setup is outside the timed region. Parsing, execution and eager
result completion are included. Each result is checked against independently
constructed expected values and shapes. The Euler case checks the default
answer `0.5001817828` in both variants.

[Raw samples](ranked-address-results.json) also retain heap-use deltas. These
are neither allocation counts nor peak memory measurements and do not establish
memory savings.

## Results

| Case | Variant | Median, ms |
| --- | --- | ---: |
| paired-points | ranked | 4.202 |
| paired-points | wrapper | 7.165 |
| paired-points | loop | 3.624 |
| paired-blocks | ranked | 1.651 |
| paired-blocks | wrapper | 5.355 |
| column-transpose | ranked | 5.455 |
| column-transpose | transpose | 4.683 |
| paired-write | ranked | 1.121 |
| paired-write | loop | 1.225 |
| euler-597 | before | 7.253 |
| euler-597 | ranked | 40.786 |

Direct paired gathers outperform the function wrapper in these samples; the
scalar loop remains faster for individual points. Paired blocks improve over
the wrapper. Column gathering is slightly slower than built-in transpose, and
the paired-write difference is small.

The Euler 597 rewrite is about **5.6 times slower** than its previous compiled
loop. It demonstrates the bulk-selection expression, but is not a performance
optimization. These small local measurements do not establish general speedups.

## Reproduce

```sh
npm run build
git show 761a3599a72c0b535846b3fa262c6d3d25161c38:demos/euler/597_torpids.ra > /tmp/rank-597-before.ra
node --expose-gc benchmarks/ranked-address.mjs 7 /tmp/rank-597-before.ra
```

Omit the last argument to run only the addressing microbenchmarks.

## Verification

- Language suite: 1,379 tests passed.
- Main interpreter suite: 7,906 tests passed, including 56 ranked-address tests
  covering both execution modes. The language's ranked-address file has 13 tests.
- Type audit: 1,431 demos ran; all eight shards and the coverage check passed.
- Nurikabe: all six exhaustive tests passed.
- All three changed demo suites passed through the CLI: transpose, one-hot,
  and Euler 597. Their differential comparisons also passed.
- Semantic-boundary and application-form checks passed; the build and diff
  whitespace checks passed.

The full differential audit is **not a green gate**. Its 1,777 file targets
were attempted across the initial shards and explicit reruns:

- Sushi's test fixture and Euler 477's main/fixture have correctness differences
  between reference and compiled execution. All three were reproduced in an
  isolated archive of the base commit above, with separately generated grammar
  and compiled packages; they predate ranked addressing.
- Euler 562's fixture, Euler 569's fixture and Euler 576's main exceeded the
  parallel run's deadline. They subsequently passed in isolated sequential runs
  using the repository's long-test runner, in approximately 105, 174 and 100
  seconds respectively.
- Euler 585's default and Euler 594's default exceeded the 300-second budget
  while synchronous evaluation prevented the normal timer from firing. Those
  workers were explicitly stopped. All 34 remaining cases from their shards
  passed in named reruns.
- A separately targeted Euler 594 fixture command also hit an external
  300-second deadline. Its buffered Vitest output did not retain an engine-level
  progress event; it is a timed-out command, not a passing or completed demo.

The slow workloads and existing full-scale exclusions are recorded in
[issue #447](https://github.com/kmmbvnr/rank/issues/447). Deadline enforcement and
suite scheduling are tracked separately in
[issue #414](https://github.com/kmmbvnr/rank/issues/414).
