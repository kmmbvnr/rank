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
