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

## Named integer-vector loop regions

Named stored integer vectors now join conditional and numeric-range loops in the
same generated region. The existing type-declaration prologue runs at each loop
entry. Native for-of iteration retains live item reads and an independent cursor;
optional ordinals advance exactly once, including on continue. Matrix rows, mixed
atoms, lazy inputs and rebinding the source retain reference execution.

Seven differential tests cover binder reassignment, continue, alias writes to later
cells, nested array/range loops, discarded bindings, empty-array index type errors,
value type errors, heterogeneous arrays and source rebinding. Verification passes
44 language + 752 interpreter tests.

On the unchanged CSES Increasing Array function with 200000 alternating one/zero
values, five alternating samples give medians of 36.673 ms off and 14.534 ms on,
about 2.52x. The independently known answer is 100000 increments. The toggle only
disables vector-loop lowering; the earlier direct scalar iteration path remains
active in the reference mode. A separate instrumented run confirms zero versus one
compiled region. Counters are disabled during timing; task times include parsing,
input construction and answer validation.

[Timings](../../benchmarks/baselines/2026-09-12-array-iteration-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-array-iteration-coverage.json).

Full-suite verification passes 306 files / 1054 tests in both modes. All result
digests match the preceding array-write baseline. One pair takes 27.942 s off and
27.991 s on; no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-array-iteration-suite.json).

## Compound integer-array updates

The integer compiler now lowers full-cell `+=`, `-=`, `*=`, `//=` and `%=`.
Coordinates are checked before evaluating the right operand; the previous element
is read afterward, and the update is committed immediately. The statement result
remains the right operand. Floor division and modulo preserve signed semantics and
zero-divisor diagnostics. Compound index updates still fall back before execution.

Ten new differential cases cover every operator with all operand-sign combinations,
aliased matrix updates in nested vector loops, partial writes before zero division,
address-versus-RHS error order and index fallback. Verification passes 44 language
and 762 interpreter tests.

Five alternating samples use the unchanged CSES Coin Combinations I function,
Target=100000 and coins 1 through 6. The independent six-predecessor full-table
oracle supplies the expected count. Median task times are 398.564 ms off and
100.360 ms on, about 3.97x. Only compound-array lowering is disabled in the reference
mode; all preceding compiler stages remain enabled. A separate instrumented run
confirms zero versus one compiled region. Timing includes input construction,
parse/load and validation, with counters disabled.

[Timings](../../benchmarks/baselines/2026-09-12-compound-array-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-compound-array-coverage.json).

Full-suite verification passes 306 files / 1054 tests in both modes; all digests
match the preceding vector-iteration baseline. One pair takes 27.820 s off and
28.033 s on, so no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-compound-array-suite.json).

## Guarded integer min/max

Integer extrema now compile through the interpreter's existing infix-chain
normalizer. Binary postfix calls and unary scalar extrema also lower. Guards check
original numbers-module function identity, preserving user shadowing and fallback
for noninteger operands. Syntax errors in skipped chains are not raised during
compiler preparation. Operand order, tie behavior and exact BigInt values remain.

Seven differential cases cover chained infix/postfix calls, addressed operands,
values beyond Number's exact range, both shadowed names, missing imports, RHS errors,
scalar unary extrema and skipped malformed chains. TypeScript verification passes
44 language + 769 interpreter tests.

Five alternating samples use unchanged Rank functions. Independent answers are
16667 for target 100000 with coins 1 through 6 (ceil(target/6)), and 400 for a
400-row all-ones triangle. Only extrema lowering is toggled; prior optimizations
remain enabled. Timing includes input construction, parse/load and validation with
counters disabled.

| Workload | Off median ms | On median ms |
| --- | ---: | ---: |
| CSES Minimizing Coins, target 100000 | 356.454 | 113.930 |
| Euler 18 function, 400 rows | 48.953 | 23.958 |

These are approximately 3.13x and 2.04x improvements. An instrumented run confirms
zero versus one compiled region for each function.

[Timings](../../benchmarks/baselines/2026-09-12-loop-extrema-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-loop-extrema-coverage.json).

The full suite passes 306 files / 1054 tests in both modes, with all result digests
matching the preceding compound-array baseline. One pair takes 27.989 s off and
28.039 s on; no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-loop-extrema-suite.json).

## Full scalar write offsets without selection plans

Compiled full-cell writes now call a checked row-major offset helper instead of
building tensor-selection axis objects, closures and an output shape. Existing
region guards establish full rank and integer selectors. Bounds remain in BigInt
space, checked in axis order before RHS evaluation. General selection is unchanged.
The address toggle retains the same compiled regions and only changes this helper.

Six differential cases cover rectangular rank-three layout, errors on later axes,
negative and huge coordinates, prior mutations, RHS error order and an empty axis.
TypeScript verification passes 44 language + 775 interpreter tests.

Five alternating samples keep all earlier compilation enabled in both modes.
Independent answers and unchanged Rank functions are the same as the preceding
stages; timings include parse/load, input construction and validation with counters
disabled.

| Workload | Selection median ms | Scalar offset median ms |
| --- | ---: | ---: |
| Minimizing Coins, target 100000 | 113.603 | 97.528 |
| Euler 18, 400 rows | 22.796 | 21.051 |
| Coin Combinations I, target 100000 | 88.849 | 63.204 |
| Dice Combinations, N=1000000 | 161.332 | 136.247 |

These samples reduce elapsed time by about 14%, 8%, 29% and 16%. A separate
instrumented run confirms one region for every task in both modes, so this gain
comes from cheaper address handling rather than newly covered loops.

[Timings](../../benchmarks/baselines/2026-09-12-scalar-address-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-scalar-address-coverage.json).

Full-suite verification passes 306 files / 1054 tests in both modes. All result
digests match the preceding extrema baseline. A single pair takes 28.127 s off and
28.755 s on; it does not establish a whole-suite improvement. Do not extrapolate
these focused gains to total test-suite timing.

[Suite verification](../../benchmarks/baselines/2026-09-12-scalar-address-suite.json).

## Integer writers bound to one region invocation

Compiled integer regions now create temporary write sites. A site's first executed
assignment calls the existing checked writer, then binds a direct store to the
owning local frame or mapped capture. Global values continue through the resource
map. Binding is lazy so skipped assignments do not raise type errors early.
Temporary writers are passed into the generated call and discarded afterward;
compiled AST caches do not retain old invocation frames. This specialization relies
on guarded integer results and synchronous regions without arbitrary user calls.

Six differential tests cover repeated calls with fresh frames, captured parent
variables, different parameter types in later calls, skipped writes, a late first
assignment failure and type preservation after returning from the region. Verification
passes 44 language + 781 interpreter tests.

Five alternating samples toggle only invocation-bound stores, keeping all preceding
compilation enabled. Existing independent answers are checked, and timing includes
parse/load, input construction and validation with counters disabled.

| Workload | Checked writer median ms | Bound writer median ms |
| --- | ---: | ---: |
| Minimizing Coins, target 100000 | 98.412 | 53.668 |
| Euler 18, 400 rows | 20.785 | 13.122 |
| Dice Combinations, N=1000000 | 123.363 | 65.447 |
| Branching recurrence, 200000 steps | 11.071 | 8.039 |

These reduce elapsed time by roughly 45%, 37%, 47% and 27%. Both modes enter one
compiled region per task in the separate coverage run.

[Timings](../../benchmarks/baselines/2026-09-12-bound-writes-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-bound-writes-coverage.json).

Short-loop preparation has a cost, so Collatz tests were measured separately over
three alternating pairs. Medians are 4276.043 ms off and 4305.070 ms on (about 0.7%
slower), with overlapping sample ranges. This is no evidence of a useful Collatz
speedup; it bounds the observed overhead in this control without claiming a stable
small regression.

[Short-loop control](../../benchmarks/baselines/2026-09-12-bound-writes-collatz.json).

The full suite passes 306 files / 1054 tests in both modes. Every result digest
matches the preceding scalar-address baseline. One pair takes 28.097 s off and
28.021 s on; no stable whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-bound-writes-suite.json).

## Boolean scalar state in numeric regions

The compiler now tracks integer versus boolean register types. It accepts boolean
literals/comparison results, incoming named conditions, boolean equality, and
`and=`/`or=`/`xor=`. Conflicting inferred types decline before execution; first writes
still use normal type checks and later bound stores preserve the established type.
Boolean operands retain eager evaluation. Boolean arrays are not covered yet.

Seven differential tests cover comparison flags, compound boolean operators,
incoming conditions, branch definitions and copies, first-write type errors,
operand error order, types after the region and incompatible branch assignments.
Verification passes 44 language + 788 interpreter tests.

Five alternating samples use unchanged CSES Array Description with 1000 unknown
positions and maximum value 100. A separate Number-based row recurrence supplies
an independent expected count; all sums remain exactly representable. Medians are
59.314 ms off and 14.414 ms on, about 4.12x. Only boolean-local lowering is toggled,
with preceding compiler stages enabled in both modes. Timing includes parse/load,
input construction and validation with counters disabled.

The coverage run changes from one compiled initialization loop to 1000 compiled
loop entries: the initialization plus 999 inner row loops. The outer loop remains
interpreted because it constructs a fresh array and rebinds the previous row.

[Timings](../../benchmarks/baselines/2026-09-12-boolean-locals-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-boolean-locals-coverage.json).

The complete suite passes 306 files / 1054 tests in both modes, with all digests
matching the preceding bound-writer baseline. One pair takes 27.693 s off and
27.855 s on; no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-boolean-locals-suite.json).

### Remaining dynamic-programming coverage candidates

Source inspection identifies these remaining boundaries; this is not a claim that
all other code in these examples is already compiled:

- Removing Digits creates a text-to-integer tensor pipeline inside its outer loop.
- Array Description constructs and rebinds row arrays inside its outer loop.
- Grid Paths and Edit Distance iterate text and compare characters.
- Rectangle Cutting calls a local helper from its outer loops; eligible loops in
  that helper compile independently.
- Minimal Grid Path constructs and iterates sets and builds text.
- Money Sums reads and writes boolean array cells.

These are existing Rank constructs. Extending compiler coverage does not require
changing the example algorithms or adding language syntax.

## Boolean array cell plans

Read/write plans can now require boolean cells, using conditions, known array uses,
assignment operands and boolean compound updates as constraints. Entry guards check
homogeneous materialized cells for each view, rejecting conflicting alias types
before execution. Scalar address checks and immediate writes remain unchanged.
Full matrix boolean writes support `and=`, `or=` and `xor=`. Plain index writes may
also hold boolean results; compound index updates remain on the reference path.

Eight differential cases cover alias-visible updates, all three matrix compound
operators, bounds-versus-RHS error order, mixed cells, conflicting alias expectations
and rejection of boolean values as integer iteration variables. Verification passes
44 language + 796 interpreter tests.

Five alternating samples run unchanged CSES Money Sums with 100 coins, each worth
1000. The independent expected result is exactly the 100 multiples of 1000 through
100000. Median task time is 1274.913 ms off and 148.788 ms on, about 8.57x. Only
boolean-array lowering is toggled; preceding compiler stages stay enabled. Timings
include input construction, parse/load and complete result validation with counters
disabled. A separate coverage run changes from zero compiled regions to two: the
nested reachability update and the result collection loop.

[Timings](../../benchmarks/baselines/2026-09-12-boolean-arrays-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-boolean-arrays-coverage.json).

Full-suite verification passes 306 files / 1054 tests in both modes. All result
digests match the preceding boolean-local baseline. One pair takes 27.479 s off and
27.555 s on; no whole-suite speedup is established. Boolean vector binding, unknown
alias inference, text operations and array creation/rebinding remain compiler gaps.

[Suite verification](../../benchmarks/baselines/2026-09-12-boolean-arrays-suite.json).

## Local array allocation and rebinding

Numeric regions now lower `array shape ... pad ...` with integer dimensions and
integer/boolean fills, plus aliases of known array bindings. Every constructor
execution creates fresh storage. Dimension validation is shared with the ordinary
interpreter and remains before fill evaluation; assignments commit afterward.
Array rank and cell type stay consistent in the plan, while dimensions can change.

Definite assignment distinguishes local arrays from guarded inputs. Alias edges
propagate write requirements back to inputs so a cached lazy source cannot become
writable through a local alias. Full scalar destination ranks are checked even for
new local arrays; partial selections and excess-address cases retain their normal
semantics. Unsupported array forms, unknown aliases and rank/type changes fall back.

Twelve tests cover fresh storage, old aliases after rebinding, varying dimensions,
boolean fills, dimension/fill errors, first-write type errors, conditional definitions,
a cached lazy alias, partial/excess addresses and the array-write toggle. Final
verification passes 44 language + 808 interpreter tests.

Five alternating samples run unchanged Array Description with 1000 unknown positions
and maximum value 100, using the existing independent Number row-recurrence oracle.
Median task times are 15.519 ms off and 11.978 ms on, about 1.30x. Only array-local
lowering is toggled; previous inner-loop compilation remains enabled in both modes.
Timing includes input construction, parse/load and validation with counters disabled.

The coverage run changes from 1000 compiled entries to two: initialization and the
complete outer update loop. Array creation and row replacement now stay inside the
outer region instead of preparing another inner kernel invocation for every row.

[Timings](../../benchmarks/baselines/2026-09-12-array-locals-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-array-locals-coverage.json).

The final full suite passes 306 files / 1054 tests in both modes, and every result
digest matches the preceding boolean-array baseline. One pair takes 27.682 s off
and 27.695 s on; no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-array-locals-suite.json).

## Function return edges inside numeric regions

Scalar values and known arrays can now leave nested compiled loops using the
existing ReturnSignal. This preserves function completion, enclosing finally blocks,
resource handling and prior mutations. Top-level/finally/generator/valueless cases
retain ordinary validation and diagnostics. Arbitrary call expressions still use
the reference return path and its tail-call support.

Six differential tests cover nested exits, returning a mutated local array,
enclosing finally execution, RHS errors, invalid top-level context and returns
inside finally. Verification passes 44 language + 814 interpreter tests.

A compiler fixture searches 200000 integer atoms for a single matching value.
Five alternating samples toggle return lowering only, retain all previous stages,
and validate independently known indices. Timings include input construction,
parse/load and validation; counters are disabled.

| Match position | Reference median ms | Compiled median ms |
| --- | ---: | ---: |
| First (index 0) | 5.939 | 6.778 |
| Last (index 199999) | 20.172 | 10.711 |

The long search improves about 1.88x, while immediate exit is about 14% slower in
these samples. Entry preparation and array validation remain costs to reduce; do
not describe this as a universal search speedup or as a result from an unchanged
contest demo. Separate counters show zero versus one compiled region for both
fixture cases.

[Timings](../../benchmarks/baselines/2026-09-12-loop-return-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-loop-return-coverage.json).

Full-suite verification passes 306 files / 1054 tests in both modes. All digests
match the preceding local-array baseline. One pair takes 27.463 s off and 27.517 s
on; no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-loop-return-suite.json).

## Reuse the integer vector proof at loop entry

Compiled vector iteration no longer collects element types after region guards
have already established homogeneous integer cells. Locally allocated vectors
have the same proof from their constructor and typed writes. This removes an
extra linear scan without caching mutable-array type information across runs.
Binding validation remains at the original loop entry, including empty vectors:
no element type is inferred, but the ordinal type is still checked.

Three differential regressions cover empty element bindings, empty ordinal
bindings, and a conflicting element type before the body. All 44 language and
817 interpreter tests pass. Existing tests retain mutation, aliasing and live
iteration coverage.

Five alternating samples toggle only `provenIterationTypes`, with counters off;
all previous compiler stages remain enabled. Times include input construction,
parse/load, compilation, execution and independent result validation.

| Task | Prior median ms | Reused proof median ms |
| --- | ---: | ---: |
| Search fixture, first of 200000 | 6.842 | 5.147 |
| Search fixture, last of 200000 | 10.837 | 9.174 |
| Unchanged Increasing Array, 200000 | 12.560 | 10.427 |

The fixture improves about 25% and 15% respectively; Increasing Array takes
about 17% less time. Coverage records one compiled region in both modes for each
case, so this measures entry overhead rather than expanded compiler coverage.

[Search samples](../../benchmarks/baselines/2026-09-12-iteration-types-focused.json),
[Increasing Array](../../benchmarks/baselines/2026-09-12-iteration-types-increase.json),
[coverage](../../benchmarks/baselines/2026-09-12-iteration-types-coverage.json).

Both full-suite modes pass 306 files / 1054 demo tests. Every result digest agrees
with the preceding return-edge baseline. One pair takes 27.729 s off and 27.878 s
on; this does not establish any whole-suite speedup.

[Suite results](../../benchmarks/baselines/2026-09-12-iteration-types-suite.json).

## Integer absolute values in numeric loops

Standard `abs` now lowers inside typed integer regions with a native identity
guard. Exact BigInt sign selection keeps large magnitudes and zero intact;
operand instructions run once before the sign test. Four differential tests
cover values beyond the safe Number range, destructive queue operands, user
function shadowing and missing imports. All 44 language + 821 interpreter tests
pass. Other numeric types retain reference execution.

Five alternating samples toggle only `absoluteLoopCompilation`, retaining all
previous stages. The unchanged CSES Stick Lengths solution receives 200000
alternating lengths 1 and 1001; its independently expected cost is 100000000.
Median task time falls from 51.046 ms to 25.350 ms, about 2.01x. This includes
input construction, sorting, parsing/loading, compilation, execution and result
validation with counters disabled. Separate coverage records zero versus one
compiled loop, identifying the newly covered accumulation region.

[Timing samples](../../benchmarks/baselines/2026-09-12-absolute-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-absolute-coverage.json).

Both full-suite modes pass 306 files / 1054 demo tests; every digest agrees with
the preceding proven-iteration-types baseline. One pair takes 27.552 s off and
27.600 s on, so no full-suite speedup is established.

[Suite results](../../benchmarks/baselines/2026-09-12-absolute-suite.json).

A remaining coverage gap is text iteration and text equality. For example,
Edit Distance iterates over two strings and updates numeric rows; its numeric
operations already fit the region model, but character values do not yet.

## Text iteration and guarded type variants

Text iteration can now join numeric array updates in one compiled region. The
compiler adds text literals, scalar assignment, equality/inequality and return
values. It reuses the reference Unicode code-point iterator and binding validation.
After numeric guards decline, a bounded cache specializes on which named iterable
inputs are text. Plans retain type signatures, not invocation values or frames;
required types are checked again on entry. Unsupported operations retain fallback.

Seven differential tests cover supplementary and combining code points, nested
loops, source reassignment, empty character/ordinal type errors, text return, and
reuse across text/array/text calls. All 44 language + 828 interpreter tests pass.

Five alternating samples toggle only `textLoopCompilation`, with counters disabled.
The unchanged Edit Distance demo receives 300 `a` characters and 300 `b` characters;
its independent expected distance is 300. Input construction, parsing/loading,
compilation, execution and result validation are included. Coverage changes from
zero to one compiled region: both nested character loops and numeric row allocation,
updates and replacement stay in that region.

| Task | Prior median ms | Text stage median ms |
| --- | ---: | ---: |
| Edit Distance, 300 characters each | 66.355 | 10.553 |
| Stick Lengths, 200000 values (control) | 25.434 | 25.633 |
| Increasing Array, 200000 values (control) | 11.029 | 10.922 |

Edit Distance improves about 6.29x. Numeric controls remain close in these samples;
this is not evidence that every program benefits from type specialization.

[Samples](../../benchmarks/baselines/2026-09-12-text-loops-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-text-loops-coverage.json).

Both full-suite modes pass 306 files / 1054 demo tests. All result digests agree
with the preceding integer-absolute baseline. One pair takes 27.476 s off and
27.692 s on (about 0.8% slower), so no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-text-loops-suite.json).

## Text vectors and nested inferred character loops

Materialized text vectors can now feed nested character loops in one region.
Every input cell is guarded before execution; signature selection alone is not a
type proof. Nested text iteration also accepts the type inferred from the outer
binding. Existing checked bindings, string snapshot behavior and immediate numeric
writes remain in effect. Five differential tests cover Unicode rows, empty-string
binding checks, mixed-vector fallback, local string reassignment and partial numeric
writes before a later bounds error. All 44 language + 833 interpreter tests pass.

The unchanged Grid Paths demo receives an open 500 by 500 field. Its independent
oracle uses the exact central binomial coefficient modulo 1000000007. Five initial
alternating samples toggle `textArrayLoopCompilation`; scalar text compilation stays
enabled in both modes. Timings include construction, parsing/loading, compilation,
execution and validation with counters off. A nine-sample repeat checks an initially
negligible result, with Edit Distance as an unchanged scalar-text control.

| Task | First off/on medians ms | Repeat off/on medians ms |
| --- | ---: | ---: |
| Grid Paths 500 by 500 | 19.676 / 19.862 | 17.295 / 17.145 |
| Edit Distance 300 each | 9.856 / 10.638 | 9.121 / 9.299 |

No material speedup is established. Coverage does improve: Grid Paths changes from
500 inner-region entries to one complete nested region; Edit Distance stays at one.
This stage is retained as compiler coverage for arrays of text, not as a performance
win. Text iteration still constructs code-point arrays and remains a candidate for
separate optimization.

[First samples](../../benchmarks/baselines/2026-09-12-text-arrays-focused.json),
[repeat](../../benchmarks/baselines/2026-09-12-text-arrays-repeat.json),
[coverage](../../benchmarks/baselines/2026-09-12-text-arrays-coverage.json).

Both full-suite modes pass 306 files / 1054 demo tests. Digests match the preceding
scalar-text baseline. One pair takes 27.696 s off and 27.736 s on; no whole-suite
speedup is established.

[Suite results](../../benchmarks/baselines/2026-09-12-text-arrays-suite.json).

## Direct string iteration without code-point arrays

Compiled loops now use the string iterator after ordinary binding validation,
avoiding allocation of a code-point array. Strings are immutable, so iteration
retains the original source on reassignment. Three differential cases cover
supplementary/combining characters, lone surrogates and empty strings against the
previous path and independently calculated code-point counts/last values. Existing
text-loop tests cover early return, source reassignment and validation errors.
All 44 language + 836 interpreter tests pass.

Five alternating samples toggle only `directTextIteration`; a nine-sample repeat
checks small and mixed full-traversal differences in the first run. Counters are
disabled and timing includes input construction, parsing/loading, compilation,
execution and validation. The first-match compiler fixture now also receives text
with a known first/last matching code point. It is not an unchanged contest demo.

| Task | First off/on medians ms | Repeat off/on medians ms |
| --- | ---: | ---: |
| Text first match, first of 200000 | 0.815 / 0.280 | 0.797 / 0.237 |
| Text first match, last of 200000 | 4.752 / 4.443 | 5.040 / 4.206 |
| Grid Paths 500 by 500 | 17.611 / 17.215 | 17.179 / 16.801 |
| Edit Distance 300 each | 9.095 / 9.493 | 9.027 / 8.969 |
| Integer first match, first (control) | 4.804 / 4.763 | 4.864 / 4.885 |
| Integer first match, last (control) | 8.968 / 9.085 | 9.048 / 9.036 |

The clear benefit is early text exit (about 3.36x in the repeat). Full text search
also improves in both runs, while the contest examples show small changes and
Edit Distance has no consistent direction. Coverage stays at one compiled region
per task in both modes; this change reduces iteration work, not compiler coverage.

[First samples](../../benchmarks/baselines/2026-09-12-direct-text-focused.json),
[repeat](../../benchmarks/baselines/2026-09-12-direct-text-repeat.json),
[coverage](../../benchmarks/baselines/2026-09-12-direct-text-coverage.json).

Both full-suite modes pass 306 files / 1054 demo tests. All digests agree with the
preceding text-vector baseline. One pair takes 27.788 s off and 27.791 s on;
no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-direct-text-suite.json).

## Integer text conversion composed with length

Standard integer `text` and `len` of known text/arrays can now stay inside a
compiled region. Decimal rendering carries an expression-local ASCII proof,
allowing its following length to avoid a code-point array. Other text keeps
Unicode counting and array length uses the current first dimension. Native
identity guards preserve overrides. Five differential tests cover negative decimal
chains, Unicode text vectors, reallocated matrix lengths, and shadowed text/len.
All 44 language + 841 interpreter tests pass.

Five alternating samples toggle only `scalarTextCompilation`, keeping earlier
stages enabled. The unchanged Euler 25 solution finds the first 1000-digit Fibonacci
index, validated against 4782. Median time drops from 24.800 ms to 18.882 ms, about
24% less time (1.31x). This includes parsing/loading, compilation, execution and
result validation with counters off. Separate coverage changes from zero to one
compiled region for the complete Fibonacci recurrence loop.

[Timings](../../benchmarks/baselines/2026-09-12-scalar-text-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-scalar-text-coverage.json).

Both full-suite modes pass 306 files / 1054 demo tests, with every digest matching
the preceding direct-text baseline. One pair takes 27.556 s off and 27.573 s on;
no whole-suite speedup is established.

[Suite verification](../../benchmarks/baselines/2026-09-12-scalar-text-suite.json).

Euler 30 remains a useful coverage target: its hot outer loop calls a helper that
converts text digits at rank 0, raises their powers and sums them. Compiling isolated
numeric statements cannot remove that call/pipeline boundary yet.

## Digit conversion inside composable tensor plans

The tensor IR now accepts exact integer `text` and `integer rank 0` on digit text.
Native identity and ASCII-digit guards precede execution. The emitter reads digits
from the string while applying maps and reduction, avoiding the intermediate
integer and mapped arrays. Named and literal inputs work, including inline chains.
Invalid characters (also trailing newline), signs, native overrides and observable
intermediates retain reference behavior. The surrounding user-function call is
still interpreted; arbitrary function calls are not part of numeric regions yet.

Twelve differential cases cover conversion/power/sum composition, large integers,
empty and leading-zero text, invalid signs/Unicode/space/newline, text and integer
overrides, escaping intermediates and an inline literal chain. Final verification
passes 44 language + 853 interpreter tests. The ASCII guard explicitly rejects
any nondigit rather than using a JavaScript end anchor that could accept a trailing
newline.

Five alternating final samples toggle only `tensorTextDigits`. The unchanged
Euler 30 fourth-power solution returns the known sum 19316. Median time falls from
210.483 ms to 148.089 ms, about 30% less time (1.42x). Timings include loading,
parsing, compilation, execution and validation with counters off. Separate coverage
records zero versus 39365 tensor-kernel invocations, one for each helper call.

[Timings](../../benchmarks/baselines/2026-09-12-tensor-digits-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-tensor-digits-coverage.json).

Both full-suite modes pass 306 files / 1054 tests and all digests match the preceding
scalar-text baseline. One pair takes 27.762 s off and 26.453 s on, about 4.7% lower
in this pair. This is a measured pair, not a repeated whole-suite speedup claim.
Final reports were rerun after tightening the newline guard and adding literal
input coverage.

[Suite verification](../../benchmarks/baselines/2026-09-12-tensor-digits-suite.json).

## Calls to proven scalar user functions from numeric regions

The compiler can now cross a restricted user-call boundary: a one-return function
using integer parameters and supported scalar arithmetic/comparisons. A separate
syntax proof excludes external reads, nested calls and mutations, and infers an
integer or boolean result. The compiled loop binds the current matching definition
on each entry and calls its existing runtime implementation. Frames, resource scope,
parameter checks, errors and call-depth limits remain authoritative. This is not
inlining and does not yet cover arbitrary functions or the Euler 30 helper.

Eight regressions cover two-argument calls, boolean results, error locations and
prior caller writes, captured-read rejection, effectful-helper rejection, separate
local declarations across invocations, replacement of a definition and recursion
limits. All 44 language + 861 interpreter tests pass.

Five alternating samples toggle only `scalarCallCompilation`, with counters off.
The unchanged Euler 45 solution computes the next common polygonal number after
40755 from indices 144 and 166, validated against 1533776805. Median time drops
from 16.494 ms to 7.962 ms, about 2.07x. Timings include loading/parsing, compilation,
execution and validation. Separate coverage records zero versus one compiled outer
region containing the hexagonal/pentagonal calls.

[Timings](../../benchmarks/baselines/2026-09-12-scalar-calls-focused.json),
[coverage](../../benchmarks/baselines/2026-09-12-scalar-calls-coverage.json).

Both full-suite modes pass 306 files / 1054 demo tests and every digest agrees with
the preceding tensor-digit baseline. One pair takes 27.094 s off and 26.424 s on;
this single pair does not establish a stable whole-suite speedup or attribute all
of that difference to this stage.

[Suite results](../../benchmarks/baselines/2026-09-12-scalar-calls-suite.json).
