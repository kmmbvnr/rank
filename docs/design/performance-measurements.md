# Performance measurements

Implemented changes and local measurements. Remaining work is in the
[performance roadmap](performance-roadmap.md).

The current step-by-step experiments are in the [optimization log](optimization-lab.md).
The [integrated results](optimization-results.md) compare the current worktree
with main and list the remaining host-array and scalar-addressing costs.

The [flat segment comparison](flat-segment-results.md) measures retained memory,
builds, queries, and updates with JavaScript and Rank combine functions.
The [speed follow-up](flat-segment-speed.md) measures scalar combine specialization.

## Benchmark commands

From a built checkout:

```sh
npm run build
node --expose-gc benchmarks/arrays.mjs --quick
node --expose-gc benchmarks/arrays.mjs
node --expose-gc benchmarks/arrays.mjs --json
node --expose-gc benchmarks/arrays.mjs --fusion --json
node benchmarks/runtime.mjs
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

Median milliseconds for `(A * 2 + B) + reduce` at 1,000,000 elements:

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
the command still compares infix min/max against calls through aliases. It
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
