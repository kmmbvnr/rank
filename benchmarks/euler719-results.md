# Euler 719: fuse deferred matrix stages

Issue [#535](https://github.com/kmmbvnr/rank/issues/535) asks for a several-fold
speedup of `demos/euler/719_numbersplitting.ra` at `Limit = 10 ** 12`, with the
same answer and a profile of the dominant operation. The full answer remains
`128088830547982`. The [statement example](https://projecteuler.net/problem=719),
`T(10 ** 4) = 41333`, also passes.

The final demo keeps the original global frontier and partition search. Its
matrix intermediates use the existing `Name' = expression` syntax. The final
`Alive` mask is retained once because three state updates consume it. There
are no root batches, padded roots or ranked search helpers.

## Compiler changes

The baseline profile at `10 ** 10` put `mapStoredInt32Binary` and
`expandOperand` at the top of named self-time samples, followed by integer
comparisons and broadcast addressing. The full Mac baseline spent 54.61 of
55.11 seconds in the search. The profile summary is in
`results/euler719/profile-before-summary.json`.

The compiler now constructs native tensor recipes directly from its own
captured deferred expressions. Recipes share producer structure within a demand;
computed cells are not cached between demands. Native consumers emit checked
Number loops through broadcast layouts, fixed reshapes and rank-one gathers
with multidimensional selectors. Masks and selected values can be consumed
without allocating their intermediate matrices. Completed integer inputs can
be unboxed for a dense traversal; those temporary buffers are refreshed on
every demand. Published Boolean results use packed storage.

The frontend preserves captured frames, binding checks and ordinary completion
boundaries. Every gather index is validated before selected source cells are
read, including indices later excluded by a mask. Arbitrary host plan ASTs and
opaque readers are excluded. Unsafe integers, unsupported operations, inspection
and cancellation scopes use the existing exact evaluator. Code generation
failure also falls back. Compilation observers receive generated code, and
entry guards recheck inputs after observers run.

Earlier compiler steps also add fixed numeric/Boolean reshapes, Boolean `and`/
`or`, and full-shape multidimensional mask selection to Number loops. Private
Boolean vectors use byte buffers. The reusable vector pool keeps numeric and
byte capacities separate; otherwise alternating masks evicted numeric buffers
and caused a large Euler 715 regression. A regression test bounds allocation
counts as the number of alternating stages grows.

## Measurements

Baseline: `4ae58918`, original demo, one fresh process on each host. Final:
three fresh processes per host after integration of `200fcffb` and `43e4ecfb`
from `main`. Node v24.15.0 ran on Mac arm64 and Intel x64 (`jack.lan`). Runtime
JavaScript and demo hashes matched between hosts (471 files). Intel used the
JavaScript built on the Mac. The available Intel dependency snapshot could not
type-check the repository's existing `Array.at` uses with its ES2020 typings.

No other benchmark or test ran concurrently on the measured host during the
final series. Diagnostics and CPU profiling were disabled. RSS is peak process
RSS, including parsing, setup and the search. The baseline has one sample, so
these data do not estimate baseline variance.

| Host | Baseline, s | Final median, s | Final range, s | Speedup | Baseline RSS, MiB | Final median RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mac arm64 | 55.11 | 16.91 | 16.86–16.98 | 3.26x | 5020 | 676 |
| Intel x64 | 115.23 | 38.20 | 37.72–39.39 | 3.02x | 4542 | 697 |

All six runs returned `128088830547982`. Peak RSS fell by about 87% on the Mac
and 85% on Intel.

Euler 715 at `Limit = 10 ** 10` is a collateral control. Three fresh baseline
and candidate processes per host all returned `800568803`:

| Control | Baseline median, s | Final median, s | Baseline RSS, MiB | Final RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 2.730 | 2.764 | 311 | 313 |
| Intel x64 | 6.779 | 6.694 | 297 | 293 |

The median timing differences are about 1% in opposite directions. They do not
show a consistent slowdown across hosts.

## Alternatives measured

The original eager global frontier with the Number-loop improvements ran in
about 12.40 seconds / 4744 MiB on the Mac and 30.15 seconds / 3238 MiB on Intel.
Those were exploratory runs. Explicit batches of 4096 roots then gave final
medians of 17.42 seconds / 583 MiB and 41.88 seconds / 360 MiB. That demo was
replaced by the deferred global search at the user's request. Its timing files
are retained as `batched-*`; they are not the current final results.

Making every matrix stage deferred, including the shared frontier mask, took
about 34 seconds / 695 MiB on the Mac. Retaining the final mask avoids repeating
its arithmetic for all three state updates. Retaining `NewSum` too reduced an
exploratory run to 14.90 seconds but increased RSS to 1828 MiB, so it was omitted.
A selector interval-proof experiment added complexity without a measured speed
benefit and was dropped. A pool shrinking experiment was also dropped.

## Verification and reproduction

The selected tensor, plan, mask, vector-loop and helper suites ran 1528 checks:
1526 passed. Two `tensor-compound.test.ts` assertions also fail on local `main`
(`0c521055`): they expect three tensor executions, while an existing Number
loop executes the body. These failures were reproduced without this branch.
A subsequent repeated-demand regression test passes, including refresh after
external numeric-buffer changes and rejection of an unsafe replacement.

The demo has an independent decimal-cut oracle for 11 small bounds, checked
with compilation enabled and disabled. The full default Euler 719 and Euler
715 checks pass. The integrated matrix-product suites pass all 27 checks.
TypeScript build and `git diff --check` pass. No exhaustive audits or full
`npm test` were run.

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler719.mjs 1000000000000
node benchmarks/euler715.mjs 10000000000
```

Use checkout-local `@arrrank/*` links. `RANK_ROOT` selects a built runtime;
`RANK_SOURCE` selects a source variant. `DIAGNOSTICS=1`, `PROFILE=path` and
`SAVE_CODE=path` enable investigation modes. Raw timing data are in
`benchmarks/results/euler719/`; `final-*` describes the deferred global demo.
