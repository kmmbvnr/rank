# Euler 451: modular inverses

The full answer at N = 20000000 remains **153651073760956**. The coprime
factor-split algorithm is retained. The main cost was the execution of its
array stages and temporary publication, rather than a wrong search bound.

The demo now uses the existing broadcast `powmod` instead of an explicit
binary-power loop. A function owns its fresh result table and has one loop
over the small factor. Large factors retain their native `indices` filter; a direct Boolean
filter prototype was slower in reference execution, materializing about
81 million mask cells across a full run. The result table B
is still available to callers. The S = 1 split is initialized once with
array stores: its nontrivial maximum is n/2 + 1 exactly for multiples of four
n >= 8; all other entries retain the initial 1. The general loop starts at
S = 2, reducing its largest temporary vectors. N = 0, 1 and 2 now return zero without writing
past its end. The two long root expressions deliberately keep multiplication,
subtraction and modulus together; splitting them into named arrays increased
peak RSS in a full-scale probe.

Three general compiler gaps blocked the function's private execution region:

- Boolean `count` can now consume completed numeric predicates and private
  masks directly. This supports every cell of multidimensional masks as well
  as rank-one masks. Existing external packed Boolean arrays and Boolean-only
  stages retain their native word-wise consumers.
- `Mask Keys indices` preserves the immediate receiver of the postfix
  operation. Flattening the entire application had lost this array gather.
- Array `odd` and `even` predicates now lower to guarded Number vector cells,
  including multidimensional inputs and negative integers.

A completed-range powmod kernel was also investigated and rejected: it did
not repair the reference regression. No changes to native powmod are shipped.

Builtin identity and operand-domain guards remain in force. Work budgets
retain native count accounting, including after a function was previously
called without a budget. Failed numeric speculation replays the ordinary
region. Ordinary `=` completion and saved array snapshots are unchanged.

## Measurements

Three fresh-process pairs alternate before/after order in each mode. The
baseline is commit 2d0930f1, with its original demo and interpreter; the
candidate uses the new source and compiler. Both hosts use Node 24.15.0.
The timer includes parsing and execution; RSS is the process high-water mark.
Raw observations include source hashes, diagnostics and pre-run host load.

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / compiled | 42551.39 | 7899.40 | 1622.16 | 465.44 |
| Mac / reference | 39518.09 | 30675.03 | 1698.50 | 1090.55 |
| Intel / compiled | 67173.56 | 12164.98 | 1470.79 | 454.47 |
| Intel / reference | 64096.19 | 46966.77 | 1454.91 | 934.96 |

Intel load is checked with the second `vmstat 1 2` sample before every run;
the first sample is a historical average. Before the macro samples Intel
idle ranged from 91% to 100%, with no active swap-in or swap-out. Most were
99-100%; the final reference candidate sample followed the 91% observation
and was the slowest candidate reference run (50.51 s versus 46.81-46.97 s).
Mac load averages were elevated and timings varied: compiled candidates
6.41-8.48 s and reference candidates 25.68-34.02 s. All samples are retained. The first Mac baseline overlapped the end of the
small baseline cost-test reproduction. Intel timing runs were isolated;
subsequent measurements on each host were sequential. Absolute times can still vary; the saved distributions
are preferable to comparing one best run with one slow run.

## Verification

The independent oracle searches every x < n-1 for each n through the selected
limits, and compares every B cell and the sum on three execution backends
(default, exact loops, and compilation disabled). Cases include 0, 1, 2,
prime powers, square boundaries, 100 and 1000. The imported Rank fixture runs
all three cases, including N = 200000, on all backends with repeated helper
captures. The full answer is checked separately, with one private Number
region, zero numeric overflows and no destination-copy probe.

Compiler regressions cover empty/changing masks, numeric gathers followed by
postfix consumers, real/multidimensional predicates, negative and wide parity,
constructor-backed Boolean mutation and saved snapshots, builtin rebinding,
cancellation, budgeted reuse, error boundaries and unused lazy names. Packed
external masks retain their native path.

The expanded suites also exposed an older vector-slice cost test failure,
reproduced unchanged on 2d0930f1. Its five-entry vector has enough actual slice
work to pay for the snapshot under the existing bounded-entry proof. That
case now asserts admission instead of incorrectly requiring fallback; the
reference state/error comparison remains. No copy-cost policy was changed.

548 focused tests in 18 files pass on Mac and Intel. The Intel checkout
initially lacked the CSES fixture used by packed-booleans.test.ts; after
copying that unchanged demo, its 51 tests pass alongside the other 497. Source/test TypeScript
builds, the execution-exclusion checks and semantic boundary checks pass.
Exhaustive type, name-fact and differential audits were not run locally.
The default 451 demo is no longer excluded from those execution audits.

Reproduce a full run from the repository root:

```sh
node benchmarks/euler451.mjs compiled
node benchmarks/euler451.mjs reference
```

Set `RANK451_RUNTIME` to another interpreter's absolute `out/index.js` to run
that runtime against an explicitly selected source. `compiled-mask-count.mjs`
separately probes numeric mask consumption and native packed-mask controls.

## Compiler isolation and packed-mask controls

Medians of three fresh processes per side; the numeric case counts 128-cell
predicates in 100000 loop iterations. The controls count completed million-cell
bitmaps twenty times, directly or after a Boolean-only stage.

| Host / workload | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / numeric | 2159.95 | 157.72 | 489.19 | 173.59 |
| Mac / bitmap | 285.13 | 262.67 | 172.97 | 172.77 |
| Mac / boolean | 141.34 | 140.17 | 152.05 | 175.88 |
| Intel / numeric | 7682.97 | 451.51 | 473.38 | 160.96 |
| Intel / bitmap | 262.14 | 269.72 | 151.27 | 149.57 |
| Intel / boolean | 289.24 | 313.08 | 160.90 | 153.41 |

Both packed-mask controls keep zero Number loops, retaining native execution.
Their short-run timing ranges overlap, so these observations do not establish
a speed improvement there. Mac Boolean-control RSS has a higher median
(152.05 -> 175.88 MiB), but overlapping peak ranges (151-177 / 173-177 MiB);
Intel moves in the opposite direction. No packed-mask expansion is admitted.

A single additional full control runs the final source on the old runtime:
38.88 s / 1080.59 MiB on Mac and 59.69 s / 926.70 MiB on Intel, with zero
Number loops. It confirms that the source rewrite alone does not provide the
compiled improvement. These are illustrative single samples, not paired
medians. The candidate's full default uses one Number region with no overflow
or destination-copy probe on every saved macro run.

Retrieve the original demo with
`git show 2d0930f1:demos/euler/451_modularinverses.ra` when reproducing a
baseline; do not run the new source as the old-source control.

Raw data: `baselines/2026-11-07-euler451.json` (24 full runs, 36 micro controls,
and two source/runtime isolation runs). Rejected direct-filter and range-power
probes are described above and are excluded from the accepted medians.

## Integration with concurrent main changes

The paired measurements above were collected before the independent compact
GCD changes (d31dada7, incorporated by main 709f87e3) arrived. Delivery retains
those changes. After rebasing, source/test TypeScript builds and 110 focused
tests in six files pass on both hosts, covering the compact GCD kernels,
Euler 748, mask count/indices, slice cost accounting and the full Euler 451
answer/private region. The recorded pairs are not relabeled as measurements
of that subsequently integrated runtime.
