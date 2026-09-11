# Compiler progress

## Queue loop entry: cached type summaries

2026-09-11, based on `1fa5816`, Apple M5, Node v24.15.0.
The interpreter used to copy and classify the entire queue on each loop entry.
A queue now retains a type-summary snapshot until push, pushfront or pop changes
its contents. A new snapshot never mutates the set retained by a loop variable.
Iteration remains live, including appends during breadth-first traversal.

Euler 23 unchanged demo tests, three fresh interpreter samples per version:
median **7403 ms → 1311 ms (5.65x)**. Complete test-result digests match.
The baseline first sample overlapped the unit test run; the other two baseline
samples were 7403 and 7350 ms, and all candidate samples were 1299–1312 ms.
This is a runtime improvement, not additional tensor compiler coverage.

The TypeScript suite passes: 44 language and 580 interpreter tests. Three added
tests check reuse, snapshot stability, mutations, aliasing and loop type errors.

[Raw measurements](../../benchmarks/baselines/2026-09-11-queue-type-summary.json)

Next: let compiled tensor pipelines reuse already materialized lazy caches.
This must not force inputs or bypass their per-element cache semantics.

## Reusing completed lazy caches in tensor kernels

The compiler now has an internal storage lookup for runtime-owned lazy values.
The first producer is `round`: once all its elements have already been evaluated,
the kernel can read a private snapshot of those cached values. Lookup never forces
an uncached element. Unknown readers still decline; there is no automatic
materialization and no attempt to compile an arbitrary callback.

The snapshot adds one shallow array allocation when the compiler first uses a
complete cache. It is separate from public `items`, because host edits to that
array do not change the values returned by the existing `round.itemAt` cache.
Further uses reuse the snapshot. This is an incremental storage protocol, not
yet fusion through unevaluated lazy expressions.

Five alternating samples per mode, unchanged programs, fresh interpreters:

| Task | Fusion off ms | Fusion on ms | Kernels |
| --- | ---: | ---: | ---: |
| Stick Game 100000 x 100 | 1884.547 | 335.288 | 100000 |
| Jacobi 128 x 128, 10 iterations | 21.788 | 5.909 | 1271 |
| Linear SVM 32 x 64, 3 iterations | 27.741 | 8.639 | 3072 |

Only Jacobi gains coverage from this step: previously 128 kernels and about
19 ms with fusion. Nine later iterations use the ordinary path for their first
row, which fills the cache; the remaining 127 rows then fuse. Stick Game and SVM
remain controls for the already existing tensor compiler. Backprop, Euler 6 and
Linear Equations still execute no generated tensor kernels; their timing changes
in the raw report are not attributed to fusion.

The TypeScript suite passes 44 language and 584 interpreter tests. New tests
cover unknown getters, partial caches, source mutation after caching, public
array edits, matching results and actual compiled execution.

[Raw task measurements](../../benchmarks/baselines/2026-09-11-cached-tensor-tasks.json)

The next compiler stages remain: other cache-owning producers, expression
terminals beyond assignment/reduction, explicit axis/rank domains, and scalar
loop control. A complete program compiler is not yet implemented.

Full demo-suite verification: both modes pass all 306 files / 1054 tests,
with matching complete result/output digests, also matching the queue-only
revision. Single-run wall times (not a stable small-speedup estimate):
- Fusion off: 35.189 s.
- Fusion on: 36.655 s.

[Full suite report](../../benchmarks/baselines/2026-09-11-cached-tensor-suite.json)

## Return terminals

Tensor pipelines may now end in a function return as well as an assignment.
The same IR, numeric guards, builtin identity checks and storage binding serve
both. A successful terminal uses the existing return signal, so enclosing finally
blocks and resource cleanup still run. Invalid top-level/finally/generator returns
retain their reference diagnostics. Unsupported inputs fall back before execution.

The unchanged `square_sum` helper from CSES Four Squares is benchmarked with
200000 integer values. Five alternating samples give **17.341 → 12.446 ms
(1.39x)** with one generated kernel per call. The expected result is independently
checked against the sum-of-squares formula. This scales the helper, not the entire
Four Squares solver; its ordinary four-value tests are correctness coverage.

TypeScript tests: 44 language + 590 interpreter, all passing. Six new cases cover
named pipelines, inline return, finally, illegal returns and reducer failures.
An older inline-only optimization test explicitly disables tensor fusion so it
continues to test its original reference-vs-inline distinction.

The full 306-file / 1054-test demo suite passes in 35.838 s. Complete
result/output digests match the preceding reference-mode suite. This one run
is a correctness check, not evidence of a whole-suite speedup.

[Task report](../../benchmarks/baselines/2026-09-11-tensor-return-tasks.json) · [Suite report](../../benchmarks/baselines/2026-09-11-tensor-return-suite.json)

## Scalar expression compilation

Compound expressions now compile to straight-line JavaScript with guarded
operators. The initial set is arithmetic `+ - * // %`, integer comparisons and
unary signs/not. This reaches arithmetic inside scalar loops without requiring a
tensor or changing Rank source. Unsupported operand types call the reference
operator at that exact point, using already-read operands; execution never replays
a failed expression. Floor division/modulo preserve negative integer semantics.

The generated factory is weakly cached by AST identity, while readers remain
specific to each local function declaration. CSP failure retains ordinary prepared
handlers. Compilation starts at two supported operations and limits expression
size; unsupported syntax stays on the existing path.

Twelve focused tests cover numeric edge cases, collection fallback, first-error
order, fixed variable types, closure separation/code reuse and CSP. The full
TypeScript suite passes 44 language and 602 interpreter tests.

To compare this backend while retaining tensor fusion in both modes:

```sh
node benchmarks/tensor-fusion.mjs suite compare 3 '.*' scalar
```

In scalar reports the historical `kernels` field counts entries into generated
scalar expressions, including those whose operators fall back. It does not count
compiled loops: loop control flow is still interpreted.


Three alternating full-suite comparisons (Apple M5, Node v24.15.0), with tensor
fusion enabled in both modes, pass all 306 files / 1054 tests in every run. Full
result/output digests also match the preceding return-compiler revision.

| Measurement | Scalar compiler off | Scalar compiler on |
| --- | ---: | ---: |
| Full suite median | 37.668 s | 36.729 s |
| Sum of Divisors tests | 1650.560 ms | 1333.891 ms |
| Christmas Party tests | 379.836 ms | 349.765 ms |
| Collatz tests | 9031.156 ms | 9024.093 ms |

The compiler is entered in 121 demo test files. Sum of Divisors executes 6000081
compiled expressions per run; Christmas Party 1000008; Collatz 793752. Collatz
still spends most of its time outside compound arithmetic.

The full-suite median is 2.5% lower, but ranges overlap: off 35.684–37.754 s,
on 36.440–37.328 s. This is a modest local improvement, not a guarantee for every
program. Modes alternate within one process, so shared V8 warmup/GC can affect
individual measurements. Counter callbacks are enabled for the measured backend.

[All six runs and per-file results](../../benchmarks/baselines/2026-09-11-scalar-compiler-suite.json)

Next work should target compiled block/loop control and arithmetic addressing,
while retaining suspension, error locations and ownership behavior. This scalar
stage does not yet constitute a complete program compiler.

## Compiled block dispatch and resumption

Command sequences now use generated fall-through dispatch and lazily bound
handler slots. Suspension has explicit re-entry positions; tensor groups can skip
commands they replace. This removes repeated statement-cache lookups inside loop
bodies while retaining the execution stack and all existing control signals.

Seven added tests cover loop break/continue, repeated calls and finally, generator
catch/finally, tensor-group jumps, file cleanup/error location, lazy preparation
and CSP fallback. The TypeScript suite passes 44 language + 609 interpreter tests.

An initial benchmark included a callback on every block entry and resumption;
Collatz entered over 13 million times. A backend timing comparison
should not charge only the optimized mode for those diagnostic callbacks.
The timing harness now supports `RANK_BENCH_COUNTERS=0`. Removing redundant
continuation generators also avoids overhead after suspended commands.

Three alternating focused comparisons, counters disabled, identical test digests:

| Task | Block compiler off ms | Block compiler on ms | Speedup |
| --- | ---: | ---: | ---: |
| Sum of Divisors | 953.39 | 748.12 | 1.27x |
| Christmas Party | 282.30 | 235.96 | 1.20x |
| Collatz | 7737.64 | 7597.75 | 1.02x |

The small Collatz difference is not a substantial acceleration. These compare
block dispatch only; scalar and tensor compilation are enabled in both modes.
The initial block-size limit is 2–64 commands; loop control remains in the existing
for handler even when its body dispatch is compiled.

```sh
RANK_BENCH_COUNTERS=0 node benchmarks/tensor-fusion.mjs \
  suite compare 3 '.*' block
```


Six full-suite runs (three per mode, alternating order, counters disabled) all
pass 306 files / 1054 tests. Complete results/output match both modes and the
preceding scalar-compiler revision.

| Full-suite measurement | Block compiler off | Block compiler on |
| --- | ---: | ---: |
| Median total | 36.673 s | 35.552 s |
| Sum of Divisors | 1282.466 ms | 1032.300 ms |
| Christmas Party | 361.216 ms | 301.259 ms |
| Grid Paths | 2616.532 ms | 2442.719 ms |
| Lights | 4572.025 ms | 4540.261 ms |
| Collatz | 8916.361 ms | 8783.065 ms |

The total median is 3.1% lower. The first off run was faster (35.123 s), while
later off runs were 36.673 s; on runs were 35.500–35.580 s. Shared-process V8
warmup affects the comparison: the first pair appeared to regress Lights and
Grid Paths, but their repeated medians do not. These remain local measurements,
not a universal guarantee or judge timing. The backend is enabled by default;
`blockCompilation: false` keeps an independently selectable reference dispatcher.

[Focused comparison](../../benchmarks/baselines/2026-09-11-block-compiler-focused.json) · [Full comparison](../../benchmarks/baselines/2026-09-11-block-compiler-suite.json)

## Preparing loop bodies once per invocation

A loop now retains the compiled body and its execution context after the first
actual iteration. Later iterations need neither a block-cache lookup nor a fresh
context. A loop with no iterations leaves its body unprepared. Iterator-return
cleanup ordering and conditional-loop tail-call policy remain unchanged.

Three focused comparisons, counters disabled, all output/result digests matching:

| Task | Preparation off ms | Preparation on ms | Speedup |
| --- | ---: | ---: | ---: |
| Sum of Divisors | 785.01 | 743.56 | 1.056x |
| Christmas Party | 238.10 | 213.53 | 1.115x |
| Collatz | 7679.25 | 7682.76 | unchanged |

These isolate loop-body preparation with scalar and block compilation enabled in
both modes. They are not a comparison against an early interpreter revision.
TypeScript verification passes 44 language + 612 interpreter tests. Three new
cases compare zero iterations, repeated function invocations and returning through
a suspended callee before generator/iterator cleanup.

This remains a preparatory step for loop lowering: iteration and conditions still
run through the existing loop handler.

```sh
RANK_BENCH_COUNTERS=0 node benchmarks/tensor-fusion.mjs \
  suite compare 3 '(006_sumdivisors|014_christmasparty)_test' loop
```

Both full-suite modes pass 306 files / 1054 tests with identical output/result
digests, also matching the preceding block-compiler revision. One integration
comparison took 34.438 s off and 34.824 s on. A single pair is not
a stable estimate of whole-suite performance.

[Focused report](../../benchmarks/baselines/2026-09-11-loop-preparation-focused.json) · [Full-suite check](../../benchmarks/baselines/2026-09-11-loop-preparation-suite.json)

## Conditional-loop fast path: experiment not enabled

A prototype ran completed conditional-loop iterations in an ordinary function,
creating a continuation only on the first suspended body. One continuation handled
all later suspensions, avoiding unbounded stack growth. A second version removed
per-loop state closures and hoisted condition/control callbacks.

The prototype passed 44 language + 618 interpreter tests, including six added
cases for synchronous completion, 20000 suspensions with bounded execution-stack
depth, break/continue after suspension, cleanup and error equivalence.

Three alternating focused comparisons of the revised prototype, counters disabled:

| Task | Existing loop ms | Prototype ms |
| --- | ---: | ---: |
| Sum of Divisors | 728.246 | 729.698 |
| Christmas Party | 217.727 | 219.685 |
| Collatz | 7560.622 | 7405.345 |

There is no useful improvement in the arithmetic-loop target. Collatz's median
is about 2% lower, but sample ranges overlap and that is insufficient evidence to
justify another default execution path. Christmas Party is predominantly a counted
loop and serves as a control. The prototype is removed from the active runtime;
no new interpreter option remains.

The existing generator loop already executes completed bodies directly. Merely
changing its outer control wrapper leaves most work intact. The next substantial
step is lowering loop-body arithmetic and slot reads/writes together, with guarded
entry and correct state restoration on errors, rather than adding more wrappers.

The experiment is archived as a patch against `b3d1c26` for independent reproduction:

```sh
git worktree add --detach /tmp/rank-loop-experiment b3d1c26
# In that checkout, with dependencies installed:
git apply /path/to/conditional-loop.patch
npm test
RANK_BENCH_COUNTERS=0 node benchmarks/tensor-fusion.mjs \
  suite compare 3 '(014_collatz|006_sumdivisors|014_christmasparty)_test' control
```

[Prototype patch](../../benchmarks/experiments/conditional-loop.patch) · [Raw measurements](../../benchmarks/baselines/2026-09-11-conditional-loop-experiment.json)

## Whole-loop integer lowering

The compiler now emits an entire conditional loop, including its condition,
arithmetic and register reads. Assignments remain immediate calls to the standard
writers. This substantially reduces dispatch while preserving type errors and
all writes completed before a failure. No execution is replayed after failure.

Ten focused tests compare results, variable state and exact diagnostics, including
integer accumulation, signed floor division/modulo, partial writes, type mismatch,
zero iterations/missing values, fresh function calls, syntax modifiers and CSP.
The TypeScript suite passes 44 language + 622 interpreter tests.

Final focused benchmark, three alternating samples, counters disabled:

| Task | Integer loop off ms | Integer loop on ms |
| --- | ---: | ---: |
| 006_sumdivisors_test.ra | 751.225 | 332.938 |
| 014_christmasparty_test.ra | 205.709 | 205.815 |

The Sum of Divisors source is unchanged. Christmas Party remains an iterable-loop
control, outside this pass. A separate instrumented Mathematics-section run found
five compiled loop entries, all in Sum of Divisors tests. There is no task-name or
function-name recognition in the compiler; focused tests use different expressions
and names. Other loop shapes remain reference execution.

The next scope extension is numeric range iteration, followed by structured body
branches. This pass is limited to guarded integer loops, not yet arbitrary programs.

[Focused timings](../../benchmarks/baselines/2026-09-11-integer-loop-focused.json)

The full suite passes 306 files / 1054 tests in both modes and in a final enabled
verification after adding the modifier-spelling guard. Complete output/result
digests match each other and the preceding committed runtime. The integration
pair took 36.345 s off and 35.187 s on; a single pair does not establish a stable
whole-suite speedup. The final enabled verification took 34.574 s.

[Full-suite comparisons and final verification](../../benchmarks/baselines/2026-09-11-integer-loop-suite.json)

## Numeric range loop lowering

The same whole-loop compiler now handles inline `to`/`until` numeric ranges,
including `by`, descending steps, an optional index and `#` discards. Bound values
are captured once. A separate cursor preserves progression if the body changes
the visible variable, the source bound or the step variable. All writes still use
the normal typed writers. Range module checks and error timing retain fallback
where needed; non-range iterables remain on the reference path.

Seventeen new cases cover inclusivity, empty/descending ranges, index bindings,
discards, changed variables and range/module/type errors. TypeScript verification
passes 44 language + 639 interpreter tests.

Three alternating focused samples with counters disabled:

| Task | Integer compiler off ms | Integer compiler on ms |
| --- | ---: | ---: |
| 006_sumdivisors_test.ra | 805.534 | 365.803 |
| 014_christmasparty_test.ra | 226.745 | 107.615 |
| 028_spiraldiagonals_test.ra | 1.944 | 1.984 |

Christmas Party is new coverage: about 2.11x faster on its unchanged solution.
Sum of Divisors retains the earlier conditional-loop optimization; its improvement
is not new range-pass coverage. Euler 28 remains a non-fusing control because its
body contains power, which this integer-loop pass does not yet lower.

[Focused measurements](../../benchmarks/baselines/2026-09-11-range-loop-focused.json)

The full suite passes 306 files / 1054 tests in both modes, with matching complete
output/result digests, also matching the prior committed implementation. One
integration comparison took 35.283 s off and 34.933 s on. This toggles the
whole integer-loop pass, including conditional loops; it does not isolate the
range extension or establish a stable whole-suite speedup.

[Full-suite verification](../../benchmarks/baselines/2026-09-11-range-loop-suite.json)


## Constant integer powers in whole loops

The integer loop compiler now lowers `**` with a nonnegative integer literal
exponent, including a parenthesized literal. It preserves `-X ** 2` versus
`(-X) ** 2`, exact bigint results and checked writes. Dynamic, negative and real
exponents fall back before loop execution. No sample or language syntax changed.

Ten differential cases cover precedence, large results, unsupported exponents
and partial writes on type errors. TypeScript tests: 44 language + 649 interpreter.

Euler 28, calling the unchanged `spiral_diagonal_sum` with Size=200001:

| Measurement | Compiler off | Compiler on |
| --- | ---: | ---: |
| Median of five alternating samples | 31.172 ms | 8.285 ms |

This is about 3.76x faster. Timings include parsing, module loading, compilation,
execution and result validation; counters were disabled. The answer is also
checked against an independent closed form. A separate instrumented run confirms
one compiled loop. The ordinary Size=1001 sample is too small for this larger
benchmark's gain to imply a meaningful whole-suite improvement.

[Timings](../../benchmarks/baselines/2026-09-11-integer-power-focused.json),
[coverage](../../benchmarks/baselines/2026-09-11-integer-power-coverage.json).

### Next candidates from the preceding suite profile

The range-loop enabled baseline puts Euler 14 Collatz at 8.9 s, AoC 2015 Day 6
Lights at 4.7 s and Euler 30 Digit Powers at 3.2 s. These are priorities to
investigate, not measured promises of future acceleration:

- Collatz needs branches, container reads/writes and stack operations in loops.
- Lights needs nested loops, branches and multidimensional index updates.
- Digit Powers needs fusion across text-to-digit conversion, power and reduction.

Keep the existing samples and compare observable results and error behavior
while widening compiler coverage. These stages require no new language syntax.

Full-suite verification passes 306 files / 1054 tests in both modes.
Complete result digests match the preceding committed range-loop baseline.
One pair took 35.017 s off and 38.349 s on; it does not establish a
stable whole-suite speedup. A short independent coverage probe overlapped the
off run, so this pair is primarily correctness evidence.

[Full suite](../../benchmarks/baselines/2026-09-11-integer-power-suite.json).


## Branches inside whole integer loops

`if`/`elif`/`else` now lower inside conditional and numeric-range loops, including
nested branches. Conditions retain their evaluation order and only selected
bodies run. Definite assignments merge by intersection, preventing an assignment
in one branch from suppressing the input guard for another path. Missing inputs
still decline before writes. Checked writers and nested source locations remain
in use; empty branch results match reference execution.

Ten differential tests cover merged and partial assignments, conditional loops,
untaken errors, nested diagnostics, fixed-type failures and empty branches.
TypeScript verification passes 44 language + 659 interpreter tests.

The dedicated integer-branches fixture performs 200000 Collatz steps, restarting
at 837799 whenever it reaches one. An independent JavaScript oracle checks its
sum. Five alternating samples with counters disabled give medians of 35.437 ms
off and 11.545 ms on, about 3.07x. A separate probe confirms one compiled loop.
The benchmark includes parse/load/compile/evaluation and validation.

[Measurements](../../benchmarks/baselines/2026-09-11-integer-branches-focused.json),
[coverage](../../benchmarks/baselines/2026-09-11-integer-branches-coverage.json).

This is compiler coverage, not a claim that Euler 14 became faster. Existing
sample loops with branches also need calls, container operations, suspension or
control flow that this pass does not yet handle. Those remain on the reference
path; samples were not rewritten to fit this pass. Next, specialize guarded
container reads/writes and then loop control and calls to expand real coverage.

Full suite: 306 files / 1054 tests pass in both modes. Complete result digests
match the preceding committed power-loop baseline. One comparison took
35.168 s off and 35.252 s on. This toggles all integer-loop lowering,
not only branches; no new sample or stable whole-suite speedup is claimed.

[Suite verification](../../benchmarks/baselines/2026-09-11-integer-branches-suite.json).


## Guarded stack, queue and index loops

Whole-loop lowering now handles integer `push`, `pop`, `len`, index membership
and plain indexed writes. `even`/`odd` are specialized only under native-function
identity guards. The two loops inside the unchanged Euler 14 `collatz_length`
now compile. Mutation uses existing deque methods and resource-aware index maps.
Fixed scalar types, aliasing, binding stability and error locations remain checked.

Twelve new cases cover queue/stack/deque order, the Collatz walk, aliases,
multidimensional index writes, partial mutations on errors, mixed deque values,
shadowed functions and bindings reassigned inside branches. Differential tests
now compare container contents as well as scalar state. TypeScript verification
passes 44 language + 671 interpreter tests.

The first approach reused `iterationTypes` for the integer-content guard. Its
three-sample Collatz medians were 7691.951 ms off / 7812.957 ms on. Replacing the
allocation of a type set and array with a direct read-only traversal reduced
that entry overhead. Do not keep caches merely because a cache API exists.

| Final measurement | Compiler off median ms | Compiler on median ms |
| --- | ---: | ---: |
| Euler 14 tests, three alternating pairs | 7715.676 | 7572.262 |
| Stack to index, 200000 entries, five pairs | 249.840 | 83.966 |

The long-container fixture improves about 2.98x and checks its result against an
independent arithmetic formula. Collatz's approximately 1.9% median difference
is small relative to run variation; no robust Collatz speedup is claimed. A
separate instrumented run confirms 2000020 compiled loop entries across its tests.
All timing samples above disable callbacks and include parsing/loading and result
validation. Existing Euler code is unchanged.

[Initial approach](../../benchmarks/baselines/2026-09-11-container-loops-initial.json),
[Collatz](../../benchmarks/baselines/2026-09-11-container-loops-collatz.json),
[long loops](../../benchmarks/baselines/2026-09-11-container-loops-long.json),
[coverage](../../benchmarks/baselines/2026-09-11-container-loops-coverage.json).

The result distinguishes two workloads: long loops benefit from fused execution,
but two million tiny loop invocations still pay entry guards and function-level
runtime overhead. Compiling a larger function region is the next useful direction
for Collatz; blanket speedup claims from the long-loop fixture would be misleading.

The full suite passes 306 files / 1054 tests in both modes. Complete result
digests match the preceding branch-loop commit. One full-suite comparison took
36.826 s off and 37.364 s on; this toggles all integer-loop compilation
and is not evidence of a stable whole-suite gain from container support alone.

[Suite verification](../../benchmarks/baselines/2026-09-11-container-loops-suite.json).


## Function body completion without a terminal control exception

The resumable block compiler now prepares an entire eligible function body and
returns its terminal value directly to the call frame. It reuses existing
statement preparation, tensor groups, tail-call handling and resource scopes.
This removes ordinary terminal `ReturnSignal` throw/catch overhead while keeping
signals for early returns and existing tensor-return kernels. It is a general
function-level stage, not a Collatz-specific rewrite. Inner loop guards remain.

Fourteen new differential tests cover false/zero/empty results, early returns,
finally, lexical captures, tail and non-tail recursion, both forms of terminal
tensor fusion, file ownership, errors and CSP fallback. TypeScript verification
passes 44 language + 685 interpreter tests.

The benchmark runner accepts backend `function`, independently toggling
`functionBodyCompilation` while other optimizations stay enabled. Timing runs
turn callbacks off; comparisons include parsing, loading and result validation.
The unchanged Euler 14 sample is the main target. Christmas Party and Jacobi are
controls for a loop-heavy numeric function and a tensor-heavy function.


Three alternating full-suite pairs pass 306 files / 1054 tests in every run.
Complete result digests match the preceding container-loop commit.

| Full suite | Function-body stage off | Function-body stage on |
| --- | ---: | ---: |
| Pair 1, seconds | 30.838 | 29.244 |
| Pair 2, seconds | 32.073 | 29.626 |
| Pair 3, seconds | 32.105 | 33.498 |
| Median, seconds | 32.073 | 29.626 |

The median improves about 7.6%, but the third pair regresses and the ranges
overlap. This is useful evidence of broad potential, not a stable per-run speedup.
Full-suite order and VM warmup also change individual task timings relative to
isolated runs; keep those measurements separate.

Largest absolute median reductions within this full-suite workload:

| Test file | Off ms | On ms |
| --- | ---: | ---: |
| demos/euler/030_digitpowers_test.ra | 3299.265 | 2627.012 |
| demos/euler/014_collatz_test.ra | 5365.422 | 4796.884 |
| demos/euler/004_palproduct_test.ra | 1260.433 | 1004.327 |
| demos/cses/intro/024_gridpath_test.ra | 2531.431 | 2367.034 |

[Full-suite measurements](../../benchmarks/baselines/2026-09-11-function-body-suite.json).

Final isolated focused measurements, three alternating pairs:

| Test file | Off median ms | On median ms |
| --- | ---: | ---: |
| demos/cses/math/014_christmasparty_test.ra | 98.548 | 99.546 |
| demos/deepml/011_jacobi_test.ra | 3.638 | 4.243 |
| demos/euler/014_collatz_test.ra | 7739.790 | 4445.822 |

Small control timings are noisy; the large Collatz result is the focused target.
[Focused measurements](../../benchmarks/baselines/2026-09-11-function-body-focused.json).


## Direct scalar iteration without entry wrappers

The reference `forEntries` adapter creates `{value, indices}` for each scalar
and an extra array for each index. Ordinary scalar iteration now bypasses that
adapter, sharing the same once-per-loop binding/type preparation and underlying
iterator. Tensor-axis, matrix-row and object-key traversal retain the old path.
Only an actually used index requires ordinal increments.

Thirteen differential tests cover live array/queue mutation, changed visible
indices, all discard forms, Unicode code points, empty-source validation,
incompatible bindings, break/continue, generator cleanup after a return callee
and on an error, and ranked tensor fallback. TypeScript verification passes
44 language + 698 interpreter tests.

Five alternating focused samples, counters disabled, run unchanged demo functions:

| Workload | Wrapper path median ms | Direct path median ms |
| --- | ---: | ---: |
| CSES Increasing Array, 200000 alternating values | 37.925 | 34.105 |
| Euler 42 word_value, 200000 characters | 35.387 | 31.218 |

These are about 10.1% and 11.8% lower elapsed time respectively. Independent
expected results check both workloads; timing includes parse/load, evaluation
and validation. No sample rewrite or arithmetic representation change was needed.
The benchmark backend `iteration` toggles only `directIteration`.

[Focused measurements](../../benchmarks/baselines/2026-09-11-direct-iteration-focused.json).

Full-suite verification passes 306 files / 1054 tests in both modes. All result
digests match the preceding function-body commit. The single pair took
28.677 s off and 28.644 s on; this does not establish a stable whole-suite
speedup.

[Suite verification](../../benchmarks/baselines/2026-09-11-direct-iteration-suite.json).


## Compiled coordinate routing for tensor cells

Tensor iteration now compiles the repeated coordinate decoder and offset
expression for each cell-axis configuration. The compiler keeps dimensions and
storage dynamic, preserving reads from mutable or lazy host arrays. This is a
copy kernel for array-valued cells, not a new indexing rule or numeric format.

Eleven new cases cover shape mutation between and during cells, independent
copies, accessor read counts/errors, changed coordinate rank, mixed values and
CSP fallback. The independent coordinate-grouping test now runs both modes for
all its axis permutations, ranks, empty shapes and source forms. TypeScript
verification passes 44 language + 709 interpreter tests.

Five alternating samples use unchanged DeepML functions on 1024x1024 matrices.
Counters are off and results are checked against independent expected vectors.
Timings include parsing, loading, input construction, evaluation and validation.

| Workload | Reference median ms | Compiled median ms |
| --- | ---: | ---: |
| Matrix Mean, row | 36.741 | 27.924 |
| Matrix Mean, column | 34.550 | 28.845 |
| Matrix-vector product | 45.827 | 35.285 |

These measurements reduce elapsed time by approximately 24%, 17% and 23%.

[Focused measurements](../../benchmarks/baselines/2026-09-12-tensor-cell-focused.json).

A scalar-cell control (512x512, `rank 0`) did not benefit: median task times were
50.763 ms reference and 52.066 ms compiled. The final implementation therefore
does not invoke the copy kernel for scalar cells. Keep this evidence when later
compiling the complete tensor traversal; do not infer a scalar-loop speedup from
larger-cell results.

[Rejected scalar-copy specialization](../../benchmarks/baselines/2026-09-12-tensor-cell-scalar-experiment.json).

Final full-suite verification (after excluding scalar cells) passes 306 files /
1054 tests in both modes. All result digests match the preceding direct-iteration
commit. The single pair took 28.558 s off and 31.970 s on; this does not
establish a stable whole-suite speedup.

[Final suite](../../benchmarks/baselines/2026-09-12-tensor-cell-suite.json).


## Break and continue as compiled control edges

The integer compiler now emits direct `break`/`continue` edges and accepts a bare
`for`. Definite assignments merge only across paths that reach subsequent code.
The last completed iteration result is separate from current partial writes, so
control exits preserve both result semantics and mutations. `finally` retains
reference validation; unsupported nested-loop regions still run normally, while
eligible inner loops may compile independently.

Eleven new differential cases cover interrupted results, register-free loops,
fallthrough-only assignment merging, unreachable code, descending indexed ranges,
finally diagnostics, errors after continue, container writes and nested-loop exits.
TypeScript verification passes 44 language + 720 interpreter tests.

The trial-divisors fixture visits candidates until their square exceeds 10^10,
using continue for nondivisors. Its independently known answer is 121: 10^10 is
2^10 times 5^10. Five alternating samples give median task times of 234.668 ms
reference and 6.429 ms compiled, about 36.5x. A separate instrumented run confirms
one compiled loop. Timing includes parse/load, evaluation and validation with
callbacks disabled.

This is a control-heavy compiler benchmark, not a claimed 36x improvement for
existing demos. It shows the cost of repeatedly throwing and routing continue
signals through the ordinary driver. Arithmetic and the algorithm are unchanged.

[Timings](../../benchmarks/baselines/2026-09-12-loop-control-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-loop-control-coverage.json).

Full-suite verification passes 306 files / 1054 tests in both modes. All result
digests match the preceding tensor-cell commit. One pair took 32.126 s off
and 29.247 s on. This toggles all integer-loop compilation, not only the new
control edges, and does not establish a stable whole-suite gain from this stage.

[Suite verification](../../benchmarks/baselines/2026-09-12-loop-control-suite.json).


## Nested numeric loop regions

Nested conditional, bare and numeric-range loops now share one generated region.
Each loop keeps an independent cursor and last completed iteration result; inner
range bounds are captured on each entry. Definite assignments from a possibly
empty inner loop do not leak into the following command. Existing checked writes,
nearest-loop control edges, module guards and source error locations remain.
Unsupported regions fall back before execution. The existing 32-command budget
counts nested commands too.

Nine additional differential tests cover dependent ranges and ordinals, descending
loops, inner/outer continue, bare loops, interrupted results, empty loops, missing
modules and errors in bounds, conditions and bodies. Verification passes 44 language
and 729 interpreter tests.

The new benchmark toggle disables only nested-region compilation, leaving inner
integer kernels enabled. On the dependent-range fixture (200000 outer iterations,
three inner values), five alternating samples give medians of 42.035 ms before
and 26.289 ms after, about 1.60x. The independent expected sum is
3*N*(N+1)/2 + 3*N. An instrumented run confirms 200000 kernel entries become one.
This is a compiler fixture, not a claim that every nested demo becomes 1.6x faster.
Timings include parse/load and result validation; counters are disabled.

[Timings](../../benchmarks/baselines/2026-09-12-nested-loops-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-nested-loops-coverage.json).

The full suite passes 306 files / 1054 tests in both modes; all result digests
also match the preceding committed control-edge baseline. One pair took
28.340 s off and 28.605 s on, so no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-nested-loops-suite.json).


## Integer array reads in compiled regions

Complete scalar addresses now lower to the existing checked array reader inside
integer loops. The compiler flattens application chains but preserves parenthesized
index expressions. It guards receiver identity through stable bindings, exact rank,
and materialized integer atoms before any body execution. Array writes, incomplete
addresses and lazy inputs retain ordinary execution. Entry guards currently scan
all atoms; storage mutation/type summaries are needed before safely caching them.

Nine new tests cover matrix coordinates, negative/large/out-of-bounds addresses,
reads in conditions and dependent bounds, real inputs, partial indexing, rebinding,
and an unread lazy input. Verification passes 44 language + 738 interpreter tests.

Five alternating samples of an explicit integer dot product over 200000 atoms give
medians of 49.134 ms off and 12.851 ms on (3.82x). The independent result is 1200000.
The toggle disables only array reads in integer regions; earlier optimizations
remain enabled. Counters are disabled during timing; a separate run confirms zero
versus one compiled region. Timing includes input construction, parsing and checks.

[Timings](../../benchmarks/baselines/2026-09-12-array-loop-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-array-loop-coverage.json).

An unchanged real-demo control, Euler 11 tests, shows no meaningful gain across five
pairs: medians 11.513 ms off and 11.590 ms on. This illustrates the remaining cost
of entering short kernels and scanning arrays; do not extrapolate the dot-product
gain to arbitrary matrix programs.

[Euler 11 control](../../benchmarks/baselines/2026-09-12-array-loop-grid.json).

The complete suite passes 306 files / 1054 tests in both modes, with every result
digest matching the preceding nested-loop baseline. One pair takes 27.989 s off
and 28.280 s on; no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-array-loop-suite.json).

## Stored integer array writes

Plain indexed assignments now accept guarded stored integer arrays as well as
indexes. Array targets must have full scalar addresses and stable bindings. The
compiler validates the selection before evaluating the right operand and writes
immediately, preserving aliases, partial mutation on errors and the assignment's
right-operand result. Index writes retain their undefined result. Lazy destinations,
partial selectors, compound assignments and noninteger arrays retain reference
execution. Selection reuses the existing checked tensor helper.

Seven new differential tests cover aliases, matrix writes, assignment results,
negative/out-of-bounds error ordering, failing right operands, break and partial-row
fallback. The differential helper now compares stored array contents and shapes,
not only scalar variables and indexes. Verification passes 44 language and 745
interpreter tests.

The unchanged CSES Dice Combinations solution runs at N=1000000 in five alternating
samples. A separate full-table recurrence (six explicit predecessors per state,
exact Number integer sums below 2^53) supplies an independent expected result.
Median task time is 310.603 ms off and 150.970 ms on, about 2.06x. The toggle disables
only array writes, retaining preceding read, scalar, loop and tensor optimizations.
One instrumented run confirms zero versus one compiled whole loop. Timings include
parse/load and result validation, with counters disabled.

[Timings](../../benchmarks/baselines/2026-09-12-array-write-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-array-write-coverage.json).

The complete suite passes 306 files / 1054 tests in both modes, with all result
digests matching the preceding array-read baseline. One pair takes 27.968 s off
and 28.160 s on; no overall speedup is established from this pair.

[Suite verification](../../benchmarks/baselines/2026-09-12-array-write-suite.json).
