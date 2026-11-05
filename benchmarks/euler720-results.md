# Euler 720: native completion of modular callback scans

Issue [#536](https://github.com/kmmbvnr/rank/issues/536) requests a several-fold
speedup of the default `720_unpredictablepermutations.ra` program, preserving
the answer and identifying its dominant array operation. The Rank program is
unchanged. The full answer remains `688081048`.

## Profile and implementation

The dominant operation was `(1 to Size - 1) scan mulp`, where
`fun A mulp B = A * B mod Prime`. In the three baseline Mac runs, the median
factorial stage took 11.93 seconds out of 13.12 seconds for the whole program.
The corresponding Intel stage took 32.26 of 35.38 seconds.

A baseline CPU profile at `Bits = 23` recorded 608 of 3635 self-time samples in
`scalarCaptureKey` and 716 in `function-invocation.js`. Each element repeated
capture-type selection, callback dispatch and boxed scalar accumulation.
Garbage collection accounted for another 452 samples. The optimized full-size
profile has no samples in either capture-key construction or function invocation.
The two profiles use different bounds; their sample counts are evidence of the
changed execution path, not a timing comparison. Summaries and diagnostic runs
are retained in `results/euler720/`.

The compiler recognizes a two-data-parameter function with a single return of
`(A * B) mod M` or `(A + B) mod M`, including reversed parameter order and a
literal or captured modulus. Complete demand over a constructor-proved finite
arithmetic range can then fill one private Int32 prefix buffer directly. The
loop uses the existing exact modular multiplication routine rather than rounding
a large Number product. Range endpoints and an optional seed must fit Int32;
the integer modulus must be between 1 and `2 ** 30`. Other domains keep the
ordinary evaluator.

The implementation registers a private declaration-owned recipe and reuses the
existing guarded sequence-completion registry. It keeps ordinary iteration for
partial demand, snapshots captured values, preserves the unreduced first value
or seed, and settles the function's return contract at the first actual
combination. Every complete demand creates fresh storage. Memo, ranked and
multi-statement callbacks are excluded. Demand budgets, inspection and scalar
execution observers retain the normal callback path. Native loops poll in
blocks of 4096 and publish no partial output on cancellation.

No permutation recurrence, Lehmer-code update or factorial algorithm changed.
An experimental cache for repeated capture-signature selection was removed:
whole-scan lowering eliminates that work on this path without another cache.

## Measurements

Baseline: `d33e7a59`. Candidate: `ce2a05a4` plus the verification commits;
verification adds no runtime changes. Both use the same unchanged Rank source.
Three paired fresh-process baseline/candidate runs were taken per host, with
Node v24.15.0 on Mac arm64 and Intel x64 (`jack.lan`). Runtime JavaScript and
source hashes matched across hosts (492 files). Intel ran the same built
JavaScript; its older dependency snapshot was not used to rebuild TypeScript.

No other test or benchmark from this task ran concurrently on the measured
host. Diagnostics and profiling were disabled during timing samples. RSS is
peak process RSS, including parsing and retained arrays.

| Host | Baseline median, s | Final median, s | Speedup | Baseline RSS, MiB | Final RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mac arm64 | 13.116 | 1.410 | 9.30x | 3489 | 2001 |
| Intel x64 | 35.376 | 3.582 | 9.88x | 2303 | 1202 |

Mac timing ranges were 13.01–16.20 seconds before and 1.36–1.44 seconds after.
Intel ranges were 35.23–35.51 seconds and 3.53–3.60 seconds. All twelve full-size
runs returned `688081048`. Median peak RSS fell by 43% on the Mac and 48% on
Intel. The factorial stage now takes about 0.252 seconds on the Mac and 0.419
seconds on Intel.

Euler 715 at `Limit = 10 ** 10` is a collateral control. All samples returned
`800568803`:

| Host | Samples per version | Baseline median, s | Final median, s | Baseline RSS, MiB | Final RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mac arm64 | 6 | 2.783 | 2.845 | 313 | 314 |
| Intel x64 | 3 | 6.875 | 6.892 | 294 | 296 |

The first Mac series included a slow sample in each version. Three additional
paired runs gave medians of 2.731 and 2.746 seconds, a 0.6% difference. The full
six-sample Mac medians differ by 2.2%; the Intel medians differ by 0.25%. These
controls show no large slowdown, but do not establish that small differences
are significant.

## Verification and reproduction

The focused scan, scalar-function, closure, sequence-completion and Euler suites
pass 670 checks across 34 files, including two source-snapshot and opaque-reader
regressions added after the main run. The full default Euler 720 test also
passes, asserts the answer and requires one native modular callback scan.
TypeScript build, semantic-boundary checks and `git diff --check` pass.
No exhaustive audits or full `npm test` were run.

The independent Euler checks count smaller suffix values for every Lehmer cell,
compute the permutation rank with exact factorials, check absence of arithmetic
progressions through size 64, and enumerate the first lexicographic valid
permutations at sizes 4 and 8. Compilation-enabled and reference runs agree
through size 1024. The [statement examples](https://projecteuler.net/problem=720)
`S(4) = 3`, `S(8) = 2295`, and the residue `S(32) = 641839205` also pass.

The general demo/corpus exclusion remains because the program retains large
arrays; its stale time estimate was replaced with the full-scale test pointer.

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler720.mjs
node benchmarks/euler720.mjs 5 reference
```

Use checkout-local `@arrrank/*` links. `RANK_ROOT` selects a built runtime and
`RANK_SOURCE` selects a source variant. `DIAGNOSTICS=1` and `PROFILE=path` enable
investigation modes. Raw samples are in `benchmarks/results/euler720/`.
