# Expression fusion with accumulating indexed updates

Related issue: https://github.com/kmmbvnr/rank/issues/561

This change preserves applicable existing expression optimizations when
`.accumulate` is added. It does not add modular reduction of the destination
update and does not complete the language extension requested in #561.

## Implementation

- Unique affine selections can use the existing computed-update kernel with
  `.accumulate`, including integer/real arithmetic and aligned input reads.
  An exact demand budget retains the preceding accumulation evaluator.
- Numeric loops can stream a vector RHS into accumulating integer `+=`, `-=`
  and `*=` updates. The RHS uses the same vector-expression compiler as ordinary
  expressions, including arithmetic, modular products, min/max, bit operations
  and integer square root; there is no separate scatter implementation per op.
- Shape checks and source-buffer alias guards precede private stores. Repeated
  indices update the current private cell. Aliases, unsupported expressions,
  observed array assignment results, real duplicate reductions and observable
  polling keep the existing snapshot/evaluation paths.
- RHS setup and cell failures discard private loop work before exact replay,
  preserving selector validation ahead of RHS errors. Integer overflow remains
  exact; it does not wrap silently.

This is not a promise that every optimization is legal for repeated indices.
The modifier still changes duplicate handling; ordinary compound writes read
original cells and retain the last replacement. Real accumulation retains its
existing per-key grouping to preserve that implementation's rounding behavior.

`Values Keys += (Weights * 13 + 7) mod 101 .accumulate` optimizes the RHS and
then adds it. The modulus applies to the RHS, not to the accumulated target.
A modifier on the completed update, provisionally discussed as `.mod M`, is
not implemented by this change. Its public syntax remains an open question.

## Measurements

Base: `47002aed`. Node 24.15.0; Apple M5 arm64 and Intel i7-10750H x64.
The workload has 1048576 updates to 4096 repeated indices, repeated 24 times.
Setup is outside the elapsed timer; Rank loop parsing/preparation is included.
Peak RSS includes setup and verification. A separate JavaScript calculation
checks the exact result. Three fresh-process before/after pairs per host;
no samples discarded. Host load/frequency were not controlled.

| Workload | Host | Before median ms | After median ms | Before peak MiB | After peak MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| Accumulating expression | Mac | 166.15 | 97.24 | 161.75 | 157.83 |
| Accumulating expression | Intel | 359.23 | 243.72 | 147.83 | 144.68 |
| Ordinary snapshot update | Mac | 224.31 | 225.94 | 165.97 | 166.36 |

The accumulation workload improved about 41% on Mac and 32% on Intel. The
ordinary update control is essentially unchanged. These isolated timings do
not establish an Euler 797 speedup or resolve #564.

## Validation and reproduction

281 focused tests passed on both hosts across seven files. Added coverage
includes computed RHS expressions, duplicate indices, +=/-=/*=, original-value
aliases, overflow replay, shape errors, invalid selectors before scalar RHS
errors, min/max, bit operations, isqrt and unique affine fusion. Existing
real accumulation, assignment results, cancellation and Boolean scatter tests
also passed. The build, application forms and semantic-boundary checks passed.
Full suites and exhaustive corpus audits were not run.

After integration with main at `6466c953`, the build and 309 focused tests
passed on Mac. A separate integration run retained the expected answer in
96.23 ms with 172.55 MiB peak RSS. It is not pooled with the measurements above.

The new stream remains disabled under observable demand. Investigation also
confirmed a pre-existing difference between compiled/reference demand-budget
prefixes for computed RHS expressions; this change does not establish equality
of work charging across all compiler modes.

```sh
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/accumulate-expressions.mjs
RANK_ROOT=/path/to/base node benchmarks/accumulate-expressions.mjs
ACCUMULATE=0 node benchmarks/accumulate-expressions.mjs
```

The first argument changes the update count. Raw samples and test logs are in
`results/accumulate-expressions/`.
