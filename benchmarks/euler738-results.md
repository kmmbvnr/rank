# Euler 738: compile derived-selector updates

Issue [#542](https://github.com/kmmbvnr/rank/issues/542) requests a several-fold
speedup and a profile of `738_orderedfactorisations.ra`. The change is entirely
in the compiler. The Rank program, algorithm and default arguments are unchanged.
The full answer remains **143091030**.

## Cause and compiler change

The full Mac baseline CPU profile puts 51135 self-time samples in `privateArrayCopy`,
followed by 15589 in garbage collection and 5392 in stored Int32 arithmetic.
The original loop repeatedly gathers table cells and writes selected cells.
Those live selections cause repeated copies of the large tables. At Limit=10^8,
diagnostics already record 7767 COW copies / 2097299709 copied cells.

The whole loop was representable in the private numeric backend, but its copy
cost proof could not follow `Target = Row + Keys`. It knew the completed length
of `Keys`, then lost it when constructing the derived selector. The destination
snapshots exceed the 262144-cell probe cap, so the loop stayed on the publishing
backend despite doing enough selected-cell work to pay for those snapshots.

The shared entry-work proof now preserves lengths through pointwise integer
`+`, `-`, `*`, `//` and `mod`. A known vector and a proven scalar retain the
vector length; two known vectors must have the same length. Unknown operands
prove no work. Existing rebinding invalidation, branch handling and bounded
entry sampling remain in force. The proof function is selected during
preparation, keeping the ordinary range/name evaluator unchanged.

This changes cost admission, not arithmetic precision or mutation permissions.
The copy thresholds, Number guards, exact replay, selection snapshots and
observable-budget paths remain. It introduces no new syntax or task primitive.
The default run now uses one Number loop, with zero COW copies and no overflow.

## Full measurements

Baseline: `9769664c`. First compiler step: `a18207ee`. Final compiler:
`f6b3a0f8`. Integration `da8999bd` also includes upstream `8a21aac3`
(Euler 423 / prime completion) and local main `050eb534` (ACMP 0990).
Both builds use checkout-local compiled language packages. Node v24.15.0.
Imports are excluded; parsing, compilation and execution are included.
Peak RSS is the process high-water mark, not retained heap.

| Mac Apple M5 / arm64 | Baseline median, 3 processes | Final median, 3 processes |
| --- | ---: | ---: |
| Execution time | 193.477 s | 7.750 s |
| Peak RSS | 1014.7 MiB | 537.0 MiB |

The median time ratio is **24.97x**; median peak RSS decreases by **47.1%**.
Baseline time samples: 145.535, 197.940, 193.477 s. Final time samples:
7.750, 7.700, 7.845 s. Baseline RSS: 1813.7, 979.6, 1014.7 MiB; final RSS:
541.1, 537.0, 536.6 MiB. All six runs return 143091030.

| Intel i7-10750H / Linux x64, normal CPU affinity | Baseline, one process | Final median, three processes |
| --- | ---: | ---: |
| Execution time | 620.734 s | 20.498 s |
| Peak RSS | 912.3 MiB | 407.0 MiB |

This is an observed **30.28x** ratio and **55.4%** lower peak RSS.
Final times are 20.938, 20.498, 20.132 s; final peak RSS values are
407.0, 369.5, 408.2 MiB. All four runs return the full answer.
The one Intel baseline does not establish baseline variance. No other task
benchmark or test ran concurrently in this default-affinity series.

The Mac baseline samples vary substantially. Other host load was not controlled;
early observations overlapped focused verification. Every final default time
and RSS sample is below every baseline sample. Profiled and diagnostic runs are
kept separately and do not enter the timing summary.

## Regression controls

The existing `general-runtime.mjs` checks independent exact totals for nested
passes, branch slices, plain passes and repeated short calls. Six alternating
fresh-process samples per revision isolate ordinary compiled execution.

| Mac control | Baseline median, ms | Final median, ms | Median peak RSS before / after, MiB |
| --- | ---: | ---: | ---: |
| Nested passes | 22.686 | 22.715 | 156.51 / 156.65 |
| Branch slices | 18.915 | 19.027 | 155.06 / 155.01 |
| Plain passes | 20.072 | 20.076 | 149.06 / 149.07 |
| Short calls | 45.415 | 45.546 | 180.06 / 179.90 |

All four final Mac time medians differ by less than 1%; RSS differences are
below 0.2 MiB. An earlier five-sample plain-pass control suggested a 3.2%
slowdown. Preparing the derived-selector closure separately removes that branch
from ordinary proof evaluation; the final six-sample check does not reproduce
the slowdown. Initial observations overlapped focused tests and are retained
as `controls-mac-initial.json`; the later initial-implementation check is
`controls-mac.json`. Final controls are `controls-closures-mac.json`.

Intel default-affinity cold controls (six samples per version) gave medians:

| Intel control | Baseline, ms | Candidate, ms | Median peak RSS before / after, MiB |
| --- | ---: | ---: | ---: |
| Nested passes | 55.983 | 53.940 | 146.36 / 145.80 |
| Branch slices | 41.360 | 41.270 | 143.32 / 143.71 |
| Plain passes | 47.590 | 49.302 | 133.04 / 143.67 |
| Short calls | 159.345 | 160.369 | 168.53 / 168.82 |

The plain-pass cold control is a limitation: its 3.6% time increase repeated
in twelve more samples (43.894 → 45.412 ms, 3.5%). The repeat's median peak
RSS was 142.69 → 143.81 MiB, with overlapping ranges 131.29–144.30 and
133.94–147.96 MiB. Retained buffers were identical; retained heap medians
were 31,337,996 and 31,341,792 bytes. The original 10.6 MiB RSS median gap
is not stable, but identical cold-process memory is not claimed.

A separate warm control imports both runtimes, warms each twice, forces GC
before each timed execution, and alternates sixteen samples per version.
It asserts that the generated loop source hashes are identical. Intel wall
medians are 6.634 → 6.273 ms and CPU medians 19.432 → 18.654 ms; retained
buffer counts are identical. This does not show a steady-state loop regression.
It does not erase the small cold-control difference. Compilation diagnostics
also show nearly identical preparation time; the cold difference appears in
execution of identical generated sources. The cause of the cold difference is not established. No speculative code
change was retained to chase it. This patch is not a universal cold-start
speedup; its full-input gains and memory savings are much larger.

The warm driver is `experiments/euler738-control.mjs`. Cold, repeated and warm
observations are all retained rather than selecting only favorable results.

## Correctness and verification

- 311 tests across 11 focused files pass on the final compiler. They cover
  vector/scatter bounds, integer slices, aliases, replay, budgets and interrupts.
- The full default test passes, requiring the exact answer, one Number loop,
  zero COW copies and zero Number overflow.
- 78 tests across four focused files also pass on Intel.
- After integrating main at `da8999bd`, 105 tests across six files pass,
  including the full Euler 423 answer and prime-completion tests. The full
  Euler 738 test passes again; a separate default run retains the answer in
  8.565 s / 537.1 MiB. On Intel, all 470 compiled interpreter/language JavaScript
  files match this integrated build; a diagnostic default run returns the
  full answer in 19.089 s / 371.2 MiB, with one Number loop, zero COW copies
  and zero overflow. These checks supplement the isolated timing series.
- The 38 Euler 738 tests run in both compilation modes. Their independent
  oracle enumerates nondecreasing tuples including ones for each allowed
  length, without the quotient-table dynamic program. They include square
  boundaries and the [published D(10,10)=153 and D(100,100)=35384 examples](https://projecteuler.net/problem=738).
- New proof tests cover scalar broadcasts, matching vectors, unknown operands,
  shorter replacements, prior stores before an index error and budgeted failure.
- TypeScript build, semantic-boundary checks (65 owners) and application-form
  checks pass. Full npm test and exhaustive audits were not run.

Three existing compiler-count expectations fail on both the baseline and the
candidate: two in `boolean-scatter.test.ts`, one in `vector-slice-work.test.ts`.
Their behavior/state comparisons pass; they expect zero Number loops where the
baseline already reports one. Baseline failure logs are included. These tests
were left unchanged; the selected suite is not claimed to be entirely green.

No algorithm rewrite was needed to meet the issue's performance target.

## Reproduce

Build both checkouts with their own `@arrrank/language` links:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler738.mjs
RANK_ROOT=/path/to/built/baseline node benchmarks/euler738.mjs
DIAGNOSTICS=1 PROFILE=/tmp/euler738.cpuprofile node benchmarks/euler738.mjs
node benchmarks/general-runtime.mjs --baseline=/path/to/built/baseline --cases=work-nested,work-branch,work-passes,work-short --engines=compiled --samples=6
node --expose-gc benchmarks/experiments/euler738-control.mjs /path/to/built/baseline
npm test --workspace @arrrank/interpreter -- test/euler738.test.ts test/range-entry-work.test.ts
npm test --workspace @arrrank/interpreter -- test/full-scale-demos.test.ts -t 738
```

Use `/opt/rank-bench-node/bin/node` for Intel. Primary timings use normal Node
CPU affinity. A separate CPU-4 series is retained as a configuration experiment:
all four V8 workers and the main thread were restricted to the same CPU. That
GC-heavy baseline completed in 1294.393 s and returned the correct answer, but
it does not describe unrestricted execution. The CPU-2 diagnostic overlapped
that baseline and is not a paired timing. Neither experiment enters the primary
default-configuration comparison.

Raw timings, controls, profile summaries and validation logs are in
[`results/euler738`](results/euler738).
