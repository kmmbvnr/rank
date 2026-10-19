# Performance measurements

Implemented changes and local measurements. Remaining work is in the
[performance roadmap](performance-roadmap.md).

The current step-by-step experiments are in the [optimization log](optimization-lab.md).
The [integrated results](optimization-results.md) compare the current worktree
with main and list the remaining host-array and scalar-addressing costs.

The [flat segment comparison](flat-segment-results.md) measures retained memory,
builds, queries, and updates with JavaScript and Rank combine functions.
The [speed follow-up](flat-segment-speed.md) measures scalar combine specialization.
The [Arrow table experiment](arrow-titanic-experiment.md) compares retained
memory and feature preparation on synthetic Titanic rows.

## CI execution budget

Type and differential audits execute the demo corpus. Default-scale workloads
that exceed the regular CI time or memory budget are listed with reasons in
[`scripts/demo-execution-exclusions.json`](../../scripts/demo-execution-exclusions.json).
Both audits and the differential coverage gate read that same explicit list.
New full-workload exclusions keep the corresponding small `_test.ra` fixtures;
existing exclusions from issues #311 and #316 are retained. This policy applies
to execution audits only: parsing, static analysis and CLI source checks still
inspect the excluded programs. Full-scale performance runs remain manual
benchmarks and must be reported separately from CI correctness coverage.

## Benchmark commands

From a built checkout:

```sh
npm run build
node --expose-gc benchmarks/arrays.mjs --quick
node --expose-gc benchmarks/arrays.mjs
node --expose-gc benchmarks/arrays.mjs --json
node --expose-gc benchmarks/arrays.mjs --fusion --json
node benchmarks/runtime.mjs
node benchmarks/slice-arithmetic.mjs --quick
node benchmarks/slice-arithmetic.mjs --quick --real
node benchmarks/slice-arithmetic.mjs
node benchmarks/dense-writes.mjs --baseline=/path/to/built/baseline
node benchmarks/memo.mjs
node benchmarks/extrema.mjs --baseline=/path/to/built/baseline
node benchmarks/numerical-demos.mjs --baseline=/path/to/built/baseline
node benchmarks/cp-compute.mjs --size=200000
node benchmarks/cp-compute.mjs --only=rooms --checkout=/path/to/built/baseline
```

`--quick` checks all workloads with integer, real and mixed inputs at 100 elements with two
samples. The full run uses 100, 10,000 and 1,000,000 elements, two warmups per case
and five samples (63 cases). `--json` emits metadata and every sample for future comparisons.
`--fusion` adds named intermediate and twice-consumed intermediate reductions
(81 cases in a full run), to check that their existing caches remain useful.
Use the same harness against another built checkout:

```sh
node --expose-gc benchmarks/arrays.mjs --module=/path/to/checkout/packages/interpreter/out/index.js --json
```

Build that checkout first: the recorded Git revision does not prove compiled
output is current. Run comparisons on the same machine and Node version, without
other CPU-heavy work. Repeat runs before drawing conclusions.

Dense array writes and the four DP controls are described in
[dense write regression](dense-write-regression.md). Run that comparison when
changing execution composition or addressing; the judge-scale timeout alone
does not detect moderate regressions.

## What the measurements mean

Inputs and independent JS expected results are built outside the timer. Parsing
and correctness assertions are excluded. Each timed call gets the same eager
input arrays and produces a fresh result; every result array is fully materialized
inside the timer. Assertions compare all output elements and shape after every
warmup and sample. Real inputs use exact quarter fractions to permit exact checks.
Mixed inputs alternate integers and reals, including an integer-to-real transition
inside reduction and scan. The initial baseline below predates these mixed cases.

The timer includes function dispatch, computation and output materialization.
These are warm-operation benchmarks, not parser, startup or input-generation tests.
Sorting uses deterministic repeated keys rather than presorted input. The row
case uses ten columns. Broader sort distributions and axis layouts are future cases.

Memory samples report changes in `heapUsed`, `arrayBuffers` and RSS immediately
around each timed call, with the result still live and validation not yet started.
With `--expose-gc`, GC runs before each sample, outside the timer. These deltas are
**not peak memory or total allocated bytes**; GC can run during a call and deltas
can be negative. RSS includes allocator reuse. Inputs and expected outputs remain
live throughout each case. Do not add array-buffer bytes to RSS.

## Initial local baseline

Measured on 2026-09-11, Apple M5, macOS arm64, Node 24.15.0 / V8
13.6.233.17-node.48, with `--expose-gc`. Runtime source revision:
`f7e10034ea147224e0faa001590835f017f69a7c`. The harness was still uncommitted
at measurement time; its recorded Git revision is the base checkout revision.
The harness and raw results are saved together in this change.

Median milliseconds for 1,000,000 elements (five samples after two warmups):

| Operation | Integer | Real |
| --- | ---: | ---: |
| Sum | 29.6 | 29.9 |
| Array addition | 189.2 | 168.8 |
| Multiply then add | 240.6 | 230.5 |
| Multiply, add, reduce | 243.7 | 250.5 |
| Prefix scan | 65.6 | 61.8 |
| Sort | 197.3 | 185.1 |
| Row sum (10 columns) | 80.7 | 75.0 |

[Raw results, all sizes and memory samples](../../benchmarks/baselines/2026-09-11-arrays.json)
are the baseline for later comparisons. The run started after unit tests finished;
other machine activity was not controlled. These are local observations, not
performance guarantees or speedup measurements. In this workload, the arithmetic
chain plus reduction costs much more than a plain sum; profiling is still needed
to separate dispatch, allocation and traversal costs.

## First numeric-kernel batch

Runtime commits: `07a2b71` and `f5ca982`. This batch covers `+`, `-` and `*` in array arithmetic,
reduction and scan. Scalar expression dispatch is unchanged. Array reductions use
indexed loops, including trailing rank-selected cells. Equal-shaped array pairs
skip broadcast-coordinate conversion but retain the existing per-index cache.
Other operators and nonnumeric values use the general implementation.
Kernel selection lives in the collection helper so the scalar binary dispatcher
retains its previous body.

The numeric callbacks guard each consumed pair. There is no whole-array type
prepass or cached type assumption: inputs can mix types, lazy readers can have
effects, and backing arrays can change. Integer arithmetic remains arbitrary-size
BigInt; mixed pairs convert to real at the same point as scalar evaluation.
Reduction starts with the first item, while builtin `sum` keeps its integer-zero
seed. Floating-point operations are not reassociated.

Axis traversal uses strides without allocating coordinate arrays per item.
Builtin `sum` reads eager cells directly, with an identity check to preserve
shadowed functions. Lazy cells still materialize before numeric validation, so a
later read error is not replaced by an earlier type error. Other axis reducers
keep their existing cell inputs. Packed storage and fused loops are not included.

The added JS tests compare collection results against scalar execution, including
large integers, mixed types, NaN, infinities and signed zero. They also cover
empty cells, rank-selected cells, broadcasting, shadowed `sum`, lazy read order,
partial consumption, cache behavior after mutation, fallback and Rank positions.

### Array measurements

Compared baseline `5bdacc2` with `f5ca982` on the same Apple M5 / Node 24.15.0
machine. Both checkouts were built first. Two sequential baseline/candidate pairs
ran after unit tests, with no assistant-launched tests or other benchmarks running
alongside them. Unrelated machine activity was not controlled. Each process used
the same 63-case harness, two warmups and five samples per case, with `--expose-gc`.

First pair, median milliseconds at 1,000,000 elements (before → after):

| Operation | Integer | Real |
| --- | ---: | ---: |
| Sum reduction | 25.9 → 7.9 | 25.3 → 8.0 |
| Array addition | 127.0 → 94.0 | 104.5 → 93.3 |
| Multiply then add | 173.3 → 125.5 | 153.7 → 106.8 |
| Multiply, add, reduce | 175.9 → 96.0 | 180.9 → 88.1 |
| Prefix scan | 53.2 → 25.4 | 55.3 → 20.5 |
| Sort | 158.9 → 168.2 | 157.0 → 159.0 |
| Row sum (10 columns) | 68.7 → 19.9 | 64.2 → 18.4 |

Both pairs showed faster million-element arithmetic and reductions. Sum reduction
was 3.1–3.9× faster for homogeneous numeric inputs; row sums were 3.3–3.5× faster.
Mixed-input reduction was 2.4–2.6× faster, scan 2.7–2.9× and row sums 3.4–3.5×.
This is not a claim that every array operation or size improved:

- Sort was about 1–6% slower across the million-element comparisons. Its algorithm
  was not changed; these runs do not establish the cause of the difference.
- At 100 elements, mixed sum reduction rose from 27/33 microseconds to 33/41
  microseconds (about 22–24% slower). This short-call cost remains unresolved.
- At 10,000 elements, real addition was 4% faster in one pair and 12% slower in
  the other. The per-sample spread is too wide to claim a gain there.

Heap deltas also moved in both directions. For example, integer sum reduction
fell from 57.6 to 37.7 MiB, but integer row sum rose from 19.5 to about 50 MiB;
real scan rose from 41.6 to about 80 MiB. These are retained heap changes around
the call, not allocation totals or peaks. A loop allocating less can trigger fewer
collections and leave a larger end-of-call delta. No blanket memory improvement
is claimed. The report retains RSS and array-buffer deltas as well.

[Raw array and scalar comparisons](../../benchmarks/baselines/2026-09-11-numeric-kernels.json)
contain both pairs, all sizes, per-sample timings and array memory measurements.
All 394 JS tests and the demo tests passed for this batch.

### Scalar checks

The unchanged `runtime.mjs` and `memo.mjs` ran twice against each version, in
separate Node processes, with each baseline followed by the candidate. Counted
summation measured 7.8/7.9 ms before and 7.8/7.7 ms after. Recursive tree calls
measured 37.6/37.9 ms before and 37.9/37.9 ms after. Across the scalar scenarios,
individual paired changes ranged from about 4% faster to 5% slower; this does not
establish a consistent scalar slowdown or guarantee identical speed.

The manual memo-cache workload measured 121.3/118.2 ms before and 123.7/119.5 ms
after (about 1–2% slower). Fresh memo functions stayed around 78 ms. Cached calls
rounded to 0.1 ms in both versions; that resolution is too low for a useful ratio.
These results do not show a scalar speedup, nor is one expected from this batch.

## First fusion batch

The first batch covers inline trees of `+`, `-` and `*` immediately followed by
an unranked `+`, `-` or `*` reduction. Leaves can be names or numeric literals.
Eager equal-shaped arrays and numeric scalar operands use a single reduction
loop with prepared per-element readers. The readers still call numeric kernels;
this is not generated JS. Ordinary lazy wrappers are constructed at entry to
preserve scalar errors and shape validation, but their per-element caches are
not populated on the fast path.

Reads retain left-to-right tree order, including when eager JS array elements
have getters. BigInt arithmetic, mixed conversions and floating-point operation
order are unchanged. There is no numeric type prepass. Unsupported scalar pairs
use the existing operator implementation.

Lazy inputs, broadcasting between different shapes and nonnumeric scalar leaves
use the already-constructed ordinary result without replaying evaluation. Calls,
nested modifiers and explicit rank reductions retain their original execution
path. Named lazy intermediates keep their existing caches; this batch does not
fuse across assignments or reuse input buffers.

Nine added JS tests cover arithmetic trees and reducer order, scalar and empty
results, large integers, mixed values, floating-point edge cases, broadcasting,
nested arrays, lazy failures, getter order, mutation between calls, cached named
arrays, explicit rank, effectful calls and Rank error positions.

### Fusion measurements (2026-09-11)

Compared baseline `ac0b56a` with candidate `b3ad182` (implementation `e445c92`)
on Apple M5, Node 24.15.0. Main `cd85983` has the same interpreter/language
sources as the baseline; the candidate includes main's additional Euler demos.
Both runtimes were built first. Two sequential baseline/candidate pairs used
the same 81-case harness, two warmups and five samples per case. No tests or
other assistant-launched benchmarks overlapped; other machine activity was
not controlled.

Median milliseconds for `(A * 2 + B) reduce +` at 1,000,000 elements:

| Input | Pair 1 before → after | Pair 2 before → after |
| --- | ---: | ---: |
| Integer | 93.7 → 34.4 | 127.7 → 33.1 |
| Real | 87.1 → 35.9 | 115.3 → 33.6 |
| Mixed | 89.0 → 39.0 | 115.7 → 38.5 |

The target workload was 2.3–3.9× faster. First-pair heap deltas fell from 91.1
to 50.1 MiB (integer), 94.2 to 38.2 MiB (real) and 97.9 to 41.9 MiB (mixed).
These are end-of-call deltas, not peaks or allocation totals.

Small inputs did not consistently improve. At 100 elements, first-pair calls
rose from 47 to 58 microseconds (integer), 37 to 46 (real), and 29 to 47 (mixed).
The second pair was faster. At 10,000 mixed elements the first pair rose from
0.65 to 0.82 ms; the second fell from 0.78 to 0.71 ms. Plan binding remains overhead.

Named and twice-consumed intermediates kept their ordinary path and memory
behavior. First-pair million-element named reductions were 23–38% slower.
In pair 2, integer and real were 24–28% faster, but mixed remained 25% slower.
These noisy runs do not establish the cause or guarantee no regression.

First-pair scalar workloads were 8–21% slower; the second ranged from about
9% faster to 6% slower. Three additional short scalar pairs alternated version
order; differences ranged from about 5% faster to 7% slower. Manual memo calls
rose from 124.1 to 140.7 ms, then fell from 131.1 to 129.4 ms in pair 2.
No consistent scalar speedup is claimed.

### Existing demos

No existing demo uses the supported inline arithmetic/unranked numeric reduction
form. Euler 008 uses explicit rank; Euler 020 reduces a range. Numerical demos
commonly use `sum`, named intermediates or loops. This batch therefore does not
establish a fusion speedup for an existing demo.

All six judge-scale cases passed at N = 200,000 in both versions, twice.
Restaurant measured 3.44/3.27 s before and 3.01/3.02 s after; rooms measured
2.19/2.14 s before and 1.98/1.97 s after. Neither enters the new fast path, so
these differences cannot be attributed to fusion. The sum control changed
direction (165 → 177 ms, then 196 → 174 ms). Cold runs include startup and I/O.

[Raw array, scalar and memo pairs](../../benchmarks/baselines/2026-09-11-fused-reductions.json)
and [additional scalar and judge checks](../../benchmarks/baselines/2026-09-11-fused-reductions-checks.json)
retain every sample. After incorporating main's additional Euler tests, the
build, all 424 JS tests and all 154 demo files passed (including Euler 21–30
from main `7e2e4ed`).

## Direct infix min/max (2026-09-11)

Review follow-up: [ordinary extrema calls and shadowing](extrema-calls.md)
records a refactoring branch, its added semantic tests and its scalar regression.
The measurements below describe the earlier syntax-only fast path.

The infix syntax introduced in `9f57f7d` always entered the resumable application
evaluator, even for two scalar names. It bypassed the existing synchronous path
used by simple calls through an alias. Correctness tests covered the new syntax,
but the scalar suite did not compare spellings. The judge suite's 30-second
timeout could not detect a subsecond regression in playlist.

Implementation `65db244` prepares simple min/max chains in the direct-expression
compiler and uses the existing binary evaluator. Operand reads and operations
remain interleaved in left-to-right order. Compilation caches readers, not values
or numeric types. Array broadcasting, module checks and errors retain the binary
evaluator's behavior. Calls in operands, selectors and postfix reductions retain
the application path; the change does not remove stack-safe recursion.

The runtime change adds 20 lines rather than a separate arithmetic engine. Five
JS tests cover the direct execution boundary, changing argument types, lazy
arrays, selectors, reductions, effect order, skipped branches and 10,000 nested
recursive calls in an operand. The execution-path check observes three calls to
the slow expression compiler before the change and zero after it, with the same
answer. It does not depend on timing or expose a new public diagnostics API.

### Repeatable regression check

```sh
npm run bench:extrema -- --baseline=/path/to/built/baseline
```

This builds the candidate; build the baseline separately. Without `--baseline`,
the command still compares direct min/max against calls through aliases (since
Issue #21 the direct cases use the postfix form `Best I max`). It
measures six scalar loops and the unchanged playlist demo at N = 200,000.
Scalar sources are parsed once, warmed up three times at N = 10,000, then run
five times at N = 1,000,000. Versions and scalar case order alternate. Playlist
runs in separate cold CLI processes, including parsing and I/O, with the same
source and input in both versions. Every timed result is checked independently.

The command emits raw JSON with sources or hashes, revisions, dirty state and
all samples. It exits nonzero if an infix/alias median ratio exceeds 1.5 or any
candidate/baseline median ratio exceeds 1.25. These are deliberately broad
initial regression budgets, not a calibrated statistical significance test.
Repeat a failure on an idle machine before diagnosing it. Smaller regressions
can pass; inspect raw samples as well. The deterministic JS test protects the
specific execution-path property on ordinary test runs; timing gates run only
when this benchmark command is invoked.

### Measurements

Baseline `94f9c28`, candidate implementation `65db244`, Apple M5 / Node 24.15.0.
Both checkouts were built before timing. No assistant-launched tests or other
benchmarks overlapped the paired runs; unrelated machine activity was not
controlled. First run median milliseconds:

| Workload | Before | After |
| --- | ---: | ---: |
| Infix max, 1,000,000 iterations | 1074.3 | 173.7 |
| Infix min, 1,000,000 iterations | 1079.7 | 173.8 |
| Max through alias | 216.9 | 219.1 |
| Min through alias | 220.2 | 220.0 |
| Arithmetic control | 170.5 | 168.9 |
| Conditional control | 173.4 | 171.2 |
| Playlist, 200,000 elements | 770.6 | 486.8 |

Infix min/max were about 6.2 times faster; playlist used 37% less elapsed time.
Control medians moved by roughly 1%. This supports a gain for this demo and
input, not for every program. The first candidate playlist run had an outlying
582.6 ms sample; raw results retain it.

[First raw comparison](../../benchmarks/baselines/2026-09-11-extrema-first.json)
was recorded before committing the implementation, so its candidate revision is
the base revision with `dirty: true`.

The [second comparison](../../benchmarks/baselines/2026-09-11-extrema-second.json)
used clean candidate `65db244`. Max measured 1070.1 → 171.1 ms, min
1085.7 → 167.8 ms, and playlist 775.9 → 478.3 ms. Thus the two runs show
6.2–6.5 times faster infix loops and 37–38% less time for playlist. Control
median changes across both runs ranged from 4.4% faster to 1.0% slower.
Both runs passed all ratio gates; this is not a guarantee against smaller
regressions or different workload behavior.

Verification: build, 429 JS tests, 154 demo files and all six judge-scale cases
at N = 200,000 passed. The judge timeout results alone are not used to claim
unchanged performance.


## Deep lazy concat (#274, 2026-10-15)

Repeated same-axis array concatenation now uses a persistent AVL rope. Leaves
share source arrays; balanced joins copy only the affected tree paths. Indexed
lookup descends iteratively. Binding checks travel with their ranges, and shared
dependency nodes retain revision and copy-on-write proofs without retaining
obsolete concat readers and their cell caches. Nested sequence concatenation
uses an explicit traversal stack instead of recursive generator delegation.
Different-axis concat inputs remain opaque; this does not promise stack safety
for arbitrarily deep chains of other operations or alternating axes.

Reproduce after building:

```sh
npx tsc -b tsconfig.build.json
node --expose-gc benchmarks/concat.mjs --require-success=true
node --expose-gc benchmarks/concat.mjs --kind=sequence --require-success=true
```

Apple M5, macOS, Node v24.15.0. Baseline: `212e495f`; candidate: the #274
implementation accompanying this report. Each table entry is the median of
three separate cold Node processes. Construction includes parsing and runtime
execution. Each later operation is separately parsed; these are end-to-end
timings, not isolated tree lookup costs. No assistant-launched test or benchmark
overlapped the final candidate runs; unrelated machine activity was uncontrolled.

Each array contains distinct integers from 0 to N-1. The benchmark checks length,
first and last cells, 1,000 deterministic indexed reads, and the full traversal
sum. Traversal follows the indexed reads, so some cells are already cached.
`--require-success=true` rejects any failed operation or incorrect result.
Baseline failures are retained in the raw data; a failure is not a usable timing.

| Parts | Mode | Build before → after (ms) | First after (ms) | Last after (ms) | 1,000 reads after (ms) | Traverse after (ms) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | Reference | 172.8 → 176.9 | 1.73 | 0.51 | 37.2 | 2.2 |
| 1,000 | Compiled | 177.7 → 179.1 | 1.74 | 0.52 | 38.6 | 2.4 |
| 10,000 | Reference | 351.7 → 405.1 | 1.82 | 0.51 | 37.1 | 17.2 |
| 10,000 | Compiled | 359.1 → 405.6 | 1.86 | 0.52 | 38.8 | 17.5 |
| 100,000 | Reference | 2095.0 → 3060.2 | 2.08 | 0.57 | 49.9 | 188.0 |
| 100,000 | Compiled | 2094.9 → 3048.1 | 2.02 | 0.57 | 52.2 | 186.6 |

Before the change, all three first-cell reads failed at every tested size in
both modes. At 10,000 and 100,000 parts, indexed batches and full traversal also
failed. At 1,000, later reads happened to succeed after the failed first access;
the stack threshold depends on execution state. Length and last-cell reads
succeeded before and after. Candidate length queries took 3.2–4.1 ms.

| Parts | Mode | Heap after build before → after (MiB) | Heap after reads before → after (MiB) | Peak RSS before → after (MiB) |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | Reference | 12.4 → 9.9 | 31.6 → 10.9 | 208.8 → 154.5 |
| 1,000 | Compiled | 12.5 → 10.1 | 32.2 → 11.0 | 208.9 → 155.1 |
| 10,000 | Reference | 64.2 → 38.1 | 65.0 → 39.7 | 276.9 → 299.7 |
| 10,000 | Compiled | 64.3 → 38.2 | 65.2 → 39.9 | 252.2 → 300.2 |
| 100,000 | Reference | 603.0 → 320.8 | 605.0 → 326.1 | 945.3 → 904.8 |
| 100,000 | Compiled | 603.1 → 320.7 | 605.2 → 326.1 | 947.0 → 894.0 |

Heap is the increase over an initialized interpreter after explicit GC. Peak
RSS includes the entire process and transient allocations. The baseline's
post-read heap follows failed reads, whereas the candidate completed all reads;
these are different completed workloads. At 100,000 parts, retained build heap
fell about 47%, but construction became about 46% slower. Peak RSS fell only
4–6%, and increased at 10,000 parts. This fixes stack safety and avoids copying
an ever-growing parts vector; it is not an across-the-board speed improvement.

Sequence results (no baseline sequence timing was recorded):

| Parts | Mode | Build (ms) | First (ms) | Last (ms) | Traverse (ms) | Build heap (MiB) | Peak RSS (MiB) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | Reference | 152.1 | 1.73 | 1.75 | 4.6 | 7.4 | 128.2 |
| 1,000 | Compiled | 155.5 | 1.80 | 1.75 | 5.2 | 7.5 | 127.9 |
| 10,000 | Reference | 185.7 | 3.89 | 13.36 | 14.9 | 17.8 | 160.8 |
| 10,000 | Compiled | 188.5 | 4.00 | 13.94 | 15.9 | 18.0 | 160.6 |
| 100,000 | Reference | 457.1 | 32.03 | 141.86 | 148.6 | 129.5 | 419.8 |
| 100,000 | Compiled | 464.5 | 29.42 | 141.99 | 139.7 | 129.7 | 425.9 |

Sequences preserve stream behavior, including unknown lengths, infinite sources
and single-pass iterators. They do not acquire logarithmic random access:
reaching the first leaf of a left-nested concat still traverses its plan chain.

Raw samples: [baseline arrays](../../benchmarks/baselines/2026-10-15-concat-before.json),
[candidate arrays](../../benchmarks/baselines/2026-10-15-concat-after-array.json),
[candidate sequences](../../benchmarks/baselines/2026-10-15-concat-after-sequence.json).


## Queens: direct negated membership masks (2026-10-15)

The measured concat-based `queens.ra` starts with an 8-by-1 array and adds a
column per queen. Its source is preserved in `benchmarks/programs/queens-concat.ra`.
The same program was used on both runtimes for this comparison. Its `avail`
function evaluates `Cols not in Q hit` for each candidate placement.
Previously array `not in` constructed the positive membership mask, then mapped
unary `not` into another owned array. It now writes the final booleans directly,
using the same indexed right-hand lookup. Scalar, sequence-mask and SQLite
paths keep their existing behavior. This also applies to queue inputs.

A CPU profile of 30 searches showed substantial temporary-array overhead:
about 1.84 seconds in GC, 0.35 seconds in derived-cell type checking, and
0.28 seconds in owned-array construction. These are sampled totals including
startup and warmup, not isolated costs or evidence of a corresponding speedup.
The change targets the redundant mask allocation and negation pass.

Reproduce with two built runtimes:

```sh
node benchmarks/queens-membership.mjs --baseline=/path/to/baseline-checkout --source=benchmarks/programs/queens-concat.ra
```

Baseline `546a346e`, candidate is the accompanying operator change. Apple M5,
Node v24.15.0, five warmup runs per variant and 15 measured runs per mode.
Variant order alternates. Each execution uses a fresh interpreter; timings
include parsing, search and full materialization of the 92-by-8 result, but
exclude interpreter initialization, validation, display and printing. Every
result's shape and all cells are checked against the other implementation.
No assistant-launched tests or other benchmarks overlapped these comparisons;
unrelated machine activity was uncontrolled. GC causes visible outliers in
the raw samples, so the table uses medians.

| Comparison | Mode | Before (ms) | After (ms) | Time reduction |
| --- | --- | ---: | ---: | ---: |
| Initial | Reference | 244.5 | 228.1 | 6.7% |
| Initial | Compiled | 223.4 | 207.3 | 7.2% |
| Repeat | Reference | 246.4 | 224.1 | 9.0% |
| Repeat | Compiled | 225.9 | 209.9 | 7.1% |

This is a modest 7–9% reduction for this demo, not a claim that the interpreter
as a whole is that much faster. Retained and peak memory were not measured.
The optimization removes one temporary mask per array `not in` operation;
it does not remove the other allocation and validation costs visible in the
profile. A regression test covers single-pass right-hand consumption, left
cell read order, tensor/empty shapes, and writable output in both modes.

[Raw samples and benchmark source](../../benchmarks/baselines/2026-10-15-queens-membership.json).

Verification: TypeScript build and semantic-boundary checks passed. Interpreter
tests excluding `test/differential.test.ts` passed: 184 files, 3,910 tests passed
and 333 skipped, including the inferred-type demo audit. The full differential
demo suite was not run for this change; the paired benchmark checks this demo
in both execution modes.


## Queens: stored boolean mask combinations (2026-10-15)

The alternative queens helper accumulates three masks with `Mask and= ...`.
Its benchmark passes `Dy` explicitly through a loop-local single-expression
adapter, avoiding the caller-scope bug tracked in #276. Multiline declarations
inside loops remain a separate proposal (#277). After this comparison, the
main demo was switched to the explicit-distance mask helper.
The exact workload is [queens-masks.ra](../../benchmarks/programs/queens-masks.ra).

Profiling 30 searches showed repeated lazy-array and binding-wrapper work,
including approximately 4.0 seconds of GC, 0.38 seconds in derived-cell checking,
and 0.33 seconds in owned-array construction. These sampled totals include
warmup and startup. The new kernel combines same-shaped, runtime-owned stored
boolean arrays directly for `and`, `or`, and `xor`. It neither modifies its
inputs nor reads lazy/opaque host cells during eligibility checks. Other shapes,
non-boolean cells, scalar guards, and broadcasting keep the existing paths.

A second 30-search profile sampled about 1.57 seconds of GC and 0.21 seconds
in derived-cell checking after the change. Owned-array construction rose to
about 0.49 seconds, consistent with replacing lazy wrappers with stored results.
These separate profiles support the allocation explanation; the paired timings
below measure the user-visible performance difference.

The baseline already includes the preceding `not in` optimization. Thus the
following gains measure the additional boolean kernel, not both changes together.
Apple M5 / Node v24.15.0, five warmups and 15 measured executions per variant and
mode, alternating order. Every result is materialized and checked for the same
92-by-8 cells in the same order. Timing includes parsing and search, excluding
initialization, validation, display and printing. No assistant-launched heavy
jobs overlapped the benchmarks; unrelated machine activity was uncontrolled.

| Run | Mode | Mask before (ms) | Mask after (ms) | Concat control (ms) |
| --- | --- | ---: | ---: | ---: |
| Natural GC | Reference | 281.6 | 222.4 | — |
| Natural GC | Compiled | 289.0 | 226.9 | — |
| GC between runs | Reference | 312.0 | 239.4 | 243.5 |
| GC between runs | Compiled | 299.8 | 222.4 | 210.3 |

The first comparison reduced median time by about 21%; the repeat reduced it by
23–26%. Because natural GC caused substantial cross-run outliers, the repeat
explicitly collected before each run, outside the timed interval. Collection
inside the timed search remains included. Under that policy the candidate mask
variant was close to concat in reference mode and about 6% slower in compiled
mode. The explicit-argument adapter adds a call absent from the measured
concat demo; the earlier caller-scope-dependent mask example is not the exact
same workload. No retained-heap or peak-RSS improvement is claimed.

To compare a saved baseline build with the candidate (build both first):

```sh
node --expose-gc benchmarks/queens-membership.mjs \
  --baseline=/path/to/baseline-checkout \
  --source=benchmarks/programs/queens-masks.ra
```

The baseline option also accepts a directory containing an interpreter `out/`
build and its module dependencies. Without `--expose-gc`, the benchmark leaves
collection to the runtime. The JSON report records which policy was used.

[Raw samples](../../benchmarks/baselines/2026-10-15-queens-boolean-masks.json).

Verification: TypeScript build and semantic-boundary checks passed. The
interpreter suite excluding `test/differential.test.ts` passed: 185 files,
3,918 tests passed and 333 skipped. New tests cover aliases under compound
assignment, broadcasting, scalar guards, deferred type errors, empty tensors,
and refusal to force opaque or lazy inputs. Full differential demos were not
run; the benchmark compares every queens placement in both execution modes.

## Small tensor calls (issue #120)

Measured on 2026-10-18 against `cc3ca4de`, Apple M5, macOS arm64,
Node 24.15.0. A cached tensor layout reuses shape/slot planning while checking
current operands on every call. Owned arrays also retain the primitive type
counts already proved by their initial validation, avoiding a second scan for
return contracts. Results still receive fresh storage.

Three separate-process runs per variant, seven batches of 5,000 calls after
2,000 warmups per shape; all inputs are interpreter-owned. The table reports
the median of process medians in microseconds per call. The four variants were
run in alternating orders. No assistant-launched heavy jobs overlapped these
measurements; unrelated machine load was uncontrolled and produced outliers.
Raw samples include elapsed time, process CPU time, GC count and GC duration.

| Shape | Baseline | Layout only | Type counts only | Combined |
| --- | ---: | ---: | ---: | ---: |
| 1×32 | 16.28 | 13.42 | 15.05 | 12.98 |
| 8×32 | 25.20 | 22.75 | 22.34 | 19.49 |
| 128×32 | 196.12 | 205.37 | 158.29 | 154.27 |

The combined change reduced median time by 20%, 23% and 21%. Layout caching
alone did not improve 128×32. Median observed GC counts per 35,000 timed calls
fell from 19 to 14 at 1×32 and from 18 to 15 at 8×32. This is not a claim of
smaller retained results or lower peak memory.

Separate whole-process CPU profiles used 301,000 timed 1×32 calls plus warmups
and setup. Selected self-time shares were:

| Profile entry | Baseline | Combined |
| --- | ---: | ---: |
| All `tensor-kernel.js` functions | 12.37% | 2.66% |
| `arrayElementTypes` | 2.15% | 0.47% |
| `storedScalarKinds` | 1.50% | 0.45% |
| `createOwned` | 2.72% | 3.19% |
| Garbage collector | 6.36% | 7.41% |

Shares have a smaller denominator after optimization: sampled `createOwned`
self time was 144 to 140 ms and GC time 338 to 325 ms. The improvement does
not come from reusing reachable outputs or eliminating their ownership wrappers.

Two alternating runs of the existing broadcast benchmark retained its result
checks. Fused medians for 4,096 rows were 7.56/8.81 ms before and 4.77/4.75 ms
after; for 32,768 rows they were 65.37/61.65 ms and 45.27/45.12 ms. The numerical
demo benchmark also passed its independent result checks. Initial matmul,
k-means and row-reduction outliers were repeated with five samples and reversed
starting order: large matmul was 525.1 versus 528.1 ms, large k-means 340.8 versus
346.7 ms, and large row reduction 66.6 versus 62.7 ms. These repeats did not
show the initial 10–18% slowdowns.

To reproduce against a separately built baseline:

```sh
CALLS=5000 node benchmarks/small-tensor-calls.mjs --baseline=/path/to/baseline --runs=3
node benchmarks/broadcast-fusion.mjs
node benchmarks/numerical-demos.mjs --baseline=/path/to/baseline --storage=snapshot
ROWS=1 CALLS=43000 node --cpu-prof benchmarks/small-tensor-calls.mjs
```

The small-call harness checks fusion and output shape/values, excludes validation
from timing, and drains asynchronous GC observations outside measured batches.
Profile separately from timing runs. `ROWS` selects comma-separated row counts;
`--checkout` runs the harness against another interpreter build.

[Small-call samples and profile summaries](../../benchmarks/baselines/2026-10-18-small-tensor-calls.json),
[numerical samples and repeats](../../benchmarks/baselines/2026-10-18-small-tensor-numerical.json).

The final change, including protection against reentrant host callbacks, was
also compared with updated main `f7670f23` in three alternating
baseline/candidate process pairs using the same batch sizes:

| Shape | Updated main (µs) | Final candidate (µs) | Time reduction |
| --- | ---: | ---: | ---: |
| 1×32 | 15.84 | 12.37 | 22% |
| 8×32 | 25.35 | 19.27 | 24% |
| 128×32 | 200.09 | 144.07 | 28% |

The repeated large-array guard measured 6.57 to 4.80 ms at 4,096 rows and
62.32 to 45.28 ms at 32,768 rows. These samples, final source hashes and fresh
profile summaries are included under `rebasedComparison` in the small-call
results file above. The earlier profile and separate-optimization tables retain
their original `cc3ca4de` baseline.

The final numerical suite also passed its result oracles. Short runs of the
smallest k-means and matmul cases were sensitive to warmup, so they were repeated
in three alternating process pairs with 15 samples each. Median-of-process
medians were 4.17 to 3.77 ms for k-means and 1.04 to 1.04 ms for matmul. The
numerical results file includes these controls and the full final comparison.

### Indirect gather and bitwise reduction (#121)

Measured against main `7139cd5b` on macOS arm64 / Apple M5, Node 24.15.0.
The workload scores a 1,455-element ciphertext with a repeating three-byte key
and a nonuniform lookup table. Each batch performs 1,000 iterations inside a
Rank function. The benchmark checks an independent expected score of 8,104,799
and records successful tensor-kernel executions. Three alternating process pairs
per selector mode each run 20 warmup iterations and five measured batches.

| Selector | Baseline median ms | Fused median ms | Baseline GC count | Fused GC count |
| --- | ---: | ---: | ---: | ---: |
| Lazy range/mod | 1,336.77 | 81.58 | 26 | 6 |
| Materialized indices | 1,234.06 | 51.29 | 18 | 4 |

These are medians across 15 batches per version and selector mode. Median CPU
time fell from 1,583.86 to 87.43 ms for lazy selectors and from 1,513.09 to
55.26 ms for materialized selectors. Median GC duration fell from 64.57 to
0.70 ms and from 58.00 to 0.52 ms respectively. Timing runs did not overlap
other assistant test or profiling jobs; unrelated machine activity was not
controlled. These results describe this workload, not general interpreter speed.

The existing tensor graph now lowers guarded `bxor`, `band`, and `bor` calls
using BigInt operators. Gather loads use the selector's broadcast frame and
then address the source table by the selected index. Runtime-created finite
integer ranges and range/mod selectors carry a private proof; their indices
are calculated inside the kernel without invoking sequence callbacks. This
proof does not authorize general sequence arithmetic to use array broadcasting.
The generated scoring kernel has one loop, direct array loads, and a scalar
accumulator, with no intermediate tensor data arrays. Per-call binding objects
and BigInt arithmetic still allocate. Arbitrary lazy readers, escaping locals,
filters mixed with broadcasting, invalid indices, and unsupported layouts retain
the reference path. Top-level observable assignments are not eliminated.

Raw timings, generated code, source hashes, and separate profiling summaries
are in [the gather-fusion results](../../benchmarks/baselines/2026-10-18-gather-fusion.json).
Reproduce from a built checkout; build the baseline checkout separately:

```sh
node benchmarks/gather-fusion.mjs --checkout=/path/to/baseline
node benchmarks/gather-fusion.mjs
node benchmarks/gather-fusion.mjs --selector=materialized
node benchmarks/gather-fusion.mjs --fusion=off
node benchmarks/gather-fusion.mjs --profile=cpu --iterations=5000 --output=/tmp/gather.cpuprofile
node benchmarks/gather-fusion.mjs --profile=allocation --output=/tmp/gather.heapprofile
```

CPU and allocation profiles run separately from ordinary timing samples.
Allocation sampling includes objects collected by minor and major GC; its byte
estimate is neither retained heap nor peak memory. The current Euler 59 demo
already searches each key position independently. Its update materializes each
reused strided slice once; it does not restore the historical 17,576-key search.

Three separate allocation samples for lazy selectors estimated median total
allocations of 1,143.65 MB before and 206.49 MB after fusion per 1,000 iterations
(decimal MB). The CPU profile covers 5,000 iterations; the baseline spends
substantial self-time in `readArrayItem` and `selectorIndices`, which the fused
loop bypasses. Allocation and CPU-profile runs are excluded from the timing
medians above.

Three fresh-interpreter Euler 59 runs kept the answer 129,448. Median execution
time, including parsing and module loading, changed from 368.64 to 303.06 ms;
the updated demo executed 78 fused scoring kernels rather than zero. This small
end-to-end sample is a check on the current demo, not evidence for the issue's
historical 75-second baseline.

## Stored slice arithmetic (#307)

The [slice benchmark](../../benchmarks/slice-arithmetic.mjs) compares whole-array,
shifted range, `drop`/`take` and strided differences. It checks every total against
an independent BigInt formula. `--runtime=/absolute/path/to/out/index.js` runs the
same workload against another built checkout. Timings include the loop's parse
and execution, with setup and process startup excluded. Three trials are kept in
the [recorded samples](../../benchmarks/baselines/2026-10-18-slice-arithmetic.json).

Node 24.15.0, Apple M5; medians in seconds:

| Workload | Whole array | Range slices | `drop` / `take` |
|---|---:|---:|---:|
| Baseline `7139cd5b`, 10,000 integers / 668 iterations | 0.833 | 3.719 | 3.497 |
| Stored-view kernels, same workload | 0.781 | 1.031 | 0.987 |
| 65,537 integers / 668 iterations | 5.439 | 7.271 | 7.261 |
| 1,000,000 integers / 20 iterations | 2.556 | 3.391 | 3.405 |
| 10,000 Float64 values / 668 iterations | 0.129 | 0.148 | 0.128 |

The three spellings are within 1.5x at each measured size. The integer issue
workload improves by about 3.5–3.6x for slice operations. Background CPU load
varied during the larger run, so use its within-size ratios rather than treating
absolute differences between runs as changes to whole-array performance. The
strided case processes roughly half as many cells; compare cost per element.

Separate dispatch samples over 9,999 selected cells report zero computed lazy
cells, COW copies and selection-snapshot cells, compared with 29,997 computed
lazy cells for either slice spelling on the baseline. The output still allocates
storage. Retained selections and writes keep the existing COW protections.

Euler 125 now uses prefix sums and shifted slice differences, processing one
window length at a time. Its default answer is `2906969179`; the focused demo
test took 1.78 seconds, with the small-limit and strict-boundary tests also
passing. Three fresh CLI processes, including startup, parsing and execution,
took 2.83/2.53/2.47 seconds (median 2.53 seconds); each answer was checked.

After integrating main `e9c94e50` (#320), the 10K/668 quick check remained within
1.5x: integer whole/range/drop-take medians were 1.133/1.487/1.489 seconds;
Float64 medians were 0.195/0.207/0.218 seconds. The Euler 125 default-input test
still returned the same answer in 3.06 seconds. These runs had higher background
load than the first samples; their raw values are recorded separately.

## Stored mask materialization and compound arithmetic (#308)

`benchmarks/cuboid-layers.mjs` separates initialization from the layer loop and
checks every layer size against independent scalar enumeration. A separate
untimed run checks the sum of all generated layer values. Reproduce after build:

```sh
node benchmarks/cuboid-layers.mjs
node benchmarks/cuboid-layers.mjs --runtime=/path/to/base/packages/interpreter/out/index.js
node benchmarks/cuboid-layers.mjs --original-bound
node packages/cli/bin/cli.js benchmarks/fixtures/cuboid-layers.ra
node packages/cli/bin/cli.js benchmarks/fixtures/cuboid-layers-scalar.ra
node packages/cli/bin/cli.js test demos/euler/126_cuboidlayers_test.ra
```

The original issue's bound `R = (Half // 2) isqrt + 1` excludes valid cuboids,
including `(1,99,99)` at limit 20000. The corrected bound is `Half isqrt + 1`.
There are 334886 starting cuboids and 3954135 valid layer values, whose sum is
52548758960. The original bound visits 326019 cuboids and 3917148 layer values.
The committed scalar fixture and benchmark oracle cover the corrected domain.

Measurements on Node 24.15.0 / Apple M5, three trials per variant, base
`a140d906` versus the #308 implementation:

| Corrected repro | Baseline median | Candidate median |
| --- | ---: | ---: |
| Layer loop, including its parse | 2.535 s | 0.564 s |
| Initialization | 0.318 s | 0.317 s |
| Initialization plus loop | 2.844 s | 0.865 s |

The loop improved about 4.5x. Candidate loop samples were 0.684/0.547/0.564 s;
initialization plus loop took 1.326/0.865/0.829 s. With the original bound, the
candidate loop median was 0.573 s. Timings above exclude process startup and
capture the 71 output lines. Background CPU load varied; the artifact retains
all samples and process CPU times rather than treating them as a memory result.

Three fresh CLI processes took 1.743/1.706/1.721 s for the corrected layer-only
repro (median 1.721 s), including startup, parsing, initialization and output.
These cold timings are distinct from the issue's layer-loop criterion.

The full Euler 126 demo includes frequency counting. It returns 18522, and its
small cases return 154 for ten ways and 18 for two ways. Its fresh CLI median
was 9.902 s, versus 1.091 s for the scalar full-problem fixture. Full counting
therefore remains substantially slower than the scalar formulation; the
layer-only speedup must not be presented as full-problem parity. The demo uses
per-layer frequency batches so duplicate values contribute their multiplicity.

Diagnostics show 142 direct mask materializations, 57 position-plan reuses and
71 fused compound updates. A compound update produces one fresh result instead
of its intermediate arithmetic arrays. Both source COW and binding/domain
checks remain active. Mask positions and output storage still allocate; no peak
or retained heap reduction was measured.

Raw samples and diagnostics are in
`benchmarks/baselines/2026-10-18-cuboid-layers.json`.

After integrating main `065945b6` (#319, Euler 121–200), corrected-loop times
were 0.828/0.695/0.631 s; initialization plus loop took 1.484/1.012/0.966 s.
All layer counts/checksums still matched the independent oracle. The integrated
Euler 126 tests, including the upstream statement frequencies, passed with a
10.33 s default-input run. Raw integrated samples are recorded separately.

After also integrating main `9b01afa9` (#322, scalar helper entry), the loop
remained at 0.697/0.576/0.543 s, with initialization plus loop at
1.254/0.845/0.793 s. The combined scalar-entry, tensor, mask and cuboid tests
passed (125 tests); diagnostics still show all 71 fused updates.

## Euler 7: boolean fills and yielding loops

The Euler 7 demo implements a finite sieve as a user generator. It yields each
prime and marks its multiples with `Marked (P * P to Limit by P) = true`.

Boolean scalar selection writes now validate the binding once and commit to
owned boolean storage without constructing replacement arrays or an extra array
of offsets for type checking. Bounds validation, selection snapshots and
copy-on-write still precede the commit. Other element types, compound boolean
writes and arbitrary host polling callbacks keep their existing paths.

Iterable generator loops can compile their branches and yields into a native
JavaScript generator. Values stay in Rank bindings, so resuming does not reuse
stale array buffers or scalar registers. Nested loops, protected blocks and
ordinary statements use the existing prepared operations. Inspection retains
the reference path, as does `compilation: false`. Conditional loops and yields
hidden entirely inside protected blocks retain the existing loop dispatcher.

Reproduce the four-way comparison after building:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/sieve-generator.mjs
```

The benchmark compares both paths disabled, each enabled separately, and both
enabled. Each sample runs in a separate process after two warmups, includes
parsing and execution, and checks the answer `104743`. Run it without competing
tests. Its timings exclude process startup; it does not measure peak or retained
memory.

On 2026-10-19, Node 24.15.0 / Apple M5, five samples per variant gave:

| Enabled paths | Median |
| --- | ---: |
| Neither (previous execution paths) | 813.82 ms |
| Boolean fills only | 436.00 ms |
| Generator loops only | 577.61 ms |
| Both | 315.43 ms |

The combined speedup is 2.58x for this workload. Raw samples and switches are in
`benchmarks/baselines/2026-10-19-sieve-generator.json`. An earlier five-sample
pass before adding the host-polling fallback measured 709.55 → 331.77 ms
(2.14x); the timings vary between runs and are not a general interpreter claim.

Verification passed the main interpreter batch (221 files, 4382 tests), the
final focused suites (71 selection-write, 18 generator-loop and 8 reference-mode
tests), and both Euler 7 demo tests. Targeted type and differential audits passed
for Euler 7 and the queens demos (10 programs per audit). The unrestricted
demo-corpus audit was stopped during execution; it was not a completed full
suite run.

## Exact integer square roots (#333)

[The square-root measurements](../../benchmarks/integer-square-root-results.md)
separate forced array materialization, `isqrt sum`, input setup and cold process
cost. The implementation combines a BigInt-verified floating estimate below
`2^63` with checked stored scalar-array application; larger integers retain
Newton iteration. The report includes raw samples and the host-load limitation.

## Short stored arrays and modular subset counts (#335)

[The short-array measurements](../../benchmarks/short-array-updates-results.md)
cover the original 250250-step array update with and without `copy`, scalar
loops, cold startup, GC and peak RSS. Three explicit-copy runs meet the 20-second
criterion. A full no-copy run also succeeds with compilation disabled and a
256 MiB V8 old-space limit. The report distinguishes heap limits from total RSS
and records the raw observations and source provenance.
