# Integer powers and catalogue scalar calls (#391)

Baseline: `f6c1b489`. Apple M5, Node v24.15.0, 2026-10-23.

The Number loop backend now accepts pure catalogue scalar calls over numeric and
boolean registers through a shared exact-native adapter. Registered Number
kernels accelerate binary gcd/lcm. Integer powers use checked repeated squaring;
computed exponents can select a private backend independently of the publishing
BigInt compiler. Mixed private registers preserve large scalar powers and inputs.
Negative exponents discard the attempt before reference execution. The existing
isqrt lowering remains; user functions named isqrt now reach the callee compiler.

## Separate measurements

Each microbenchmark uses 100,000 iterations, three fresh-process timed samples,
one workload warmup per process, and a separate diagnostic run. Parsing is inside
the timed region. Every result is checked against a fixed expected integer.

| Stage | Case | Baseline median, ms | Candidate median, ms |
|---|---|---:|---:|
| Scalar-call adapter and kernels | gcd | 13.01 | 6.28 |
| Scalar-call adapter and kernels | lcm | 15.12 | 9.12 |
| Scalar-call adapter and kernels | isqrt (unchanged) | 7.61 | 7.92 |
| Powers | computed exponent | 75.62 | 8.22 |
| Powers | cube | 13.05 | 6.40 |

A final run of all five cases measured gcd 12.94 → 6.36 ms (2.03x), lcm
13.88 → 9.53 ms (1.46x), computed exponent 72.87 → 6.60 ms (11.04x), and
cube 13.10 → 6.44 ms (2.04x). Isqrt measured 8.39 → 7.32 ms; no isqrt speedup
is claimed because its implementation is unchanged.

Targeted Euler checks use one fresh-process timed sample and a separate
diagnostic run, without warmup. These are small-input checks, not full-input
performance estimates. Answers match the repository's existing demo tests.

| Program variant | Input | Baseline, ms | Candidate, ms | Answer |
|---|---|---:|---:|---|
| 272, first two multiplication workarounds restored to powers | Limit=10^9 | 753.34 | 588.63 | 316174709149021 |
| 272, current source | Limit=10^9 | 619.60 | 590.39 | 316174709149021 |
| 424, search lookup expressions restored to powers | Count=1 | 1784.91 | 1414.24 | 8426039571 |
| 424, current source | Count=1 | 808.06 | 798.12 | 8426039571 |

The existing Euler programs retain their workarounds: the 424 lookup table is
still faster. Restored-power variants exist only inside the benchmark harness.

## Reproduction and validation

Build the candidate and retain a separately built baseline interpreter, then run:

```sh
node benchmarks/integer-loop-operations.mjs --baseline=/absolute/path/to/baseline/out/index.js
node benchmarks/integer-loop-operations.mjs --cases=272-power,272-current,424-power,424-current --trials=1 --baseline=/absolute/path/to/baseline/out/index.js
```

`npm run build` passed. Nine focused interpreter suites passed 617 tests:
number-builtin, integer-loop, number-loop, numbers-loop, geometric-loop,
real-loop, native-loop, typed-native and numbers-math. Coverage includes exact
integers above 2^53/2^100, wide builtin results, negative exponents, zero powers,
sign precedence, partial scalar/array writes, aliases, native errors, builtin
rebinding and existing cancellation checks. The full test suite was not run.

Computed powers require a private region. Unsupported effects/contracts and
large array cells can retain reference execution; replay preserves exact values.
The publishing BigInt backend still accepts only literal integer exponents.

Raw timed samples and source hashes are in
[the baseline artifact](baselines/2026-10-23-integer-loop-operations.json).
