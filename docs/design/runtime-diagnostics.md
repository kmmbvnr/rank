# Runtime diagnostics and stable tensor readers

Diagnostics are an optional TypeScript API for compiler development and future
CLI/editor inspection. They introduce no Rank syntax, output or evaluation step.

```ts
import { Interpreter, RuntimeDiagnostics } from '@arrrank/interpreter';

const runtime = new Interpreter();
const diagnostics = new RuntimeDiagnostics();
diagnostics.run(() => runtime.execute(source));
console.log(diagnostics);
```

`run` scopes synchronous execution only. Nested scopes restore the previous
collector, including after exceptions. Use it around direct function calls too.
Derived arrays created in a scope retain that collector for later lazy reads,
including reads after `run` returns. Arrays created outside a scope are not
retroactively instrumented. Dropping the arrays releases these references.
Without a collector, no counts or event objects are collected; small conditional
checks remain. Timing benchmarks should run separately from diagnostic runs.

## Counters and scope

| Counter | Meaning |
| --- | --- |
| `validationRequests` | Calls to a derived array's cache validation gate, including epoch fast paths |
| `dependencyValidations` | Gate checks that consult the revision graph after a write epoch changes |
| `cacheHits` | Indexed reads served from a derived cell cache |
| `cacheMisses` | Indexed reads that invoke a cell reader, including failed reads |
| `cellsComputed` | Cell readers that returned successfully |
| `invalidations` | Previously known revisions discarded at the next cache validation |
| `hoistedReaders` | Prepared readers of validated tensor caches at safe loop entry |
| `compiledLoops` | Entries into compiled integer loops |
| `compiledTensors` | Executed statement-group tensor kernels |

Cell counters currently cover `derivedArray`, not every producer in the runtime.
Whole-materialization reuse and raw compiled reads do not increment cell hits.
`dependencyValidations` does not count individual DAG nodes: revision traversal
has its own shared epoch memoization. A source write alone increments none of
these counters; observing metadata does not compute cells.

`fallbacks` groups optimizer refusals. `loop:unsupported` and `tensor:unsupported`
mean an attempted preparation found no supported plan, including ordinary scalar
statements. `loop:disabled` means compilation was explicitly disabled. Loop entry
checks distinguish `control-context`, `builtin`, `callee`, `input-type`,
`writable-storage` and `storage-or-cell-type`; tensor entry refusal is currently
`tensor:entry-guard`. Scalar-function, scalar-expression, loop and tensor
preparation also report the rejected operation or node; generated tensor and
scalar-expression guards name the operation that declined. See
[compiler rejection reasons](runtime-execution.md#typed-builtin-calls-in-loops).
These count attempts, not unique statements: one variant
can fail before another succeeds. They are not runtime errors, and do not claim
to describe every compiler in Rank or mid-loop deoptimization.

`compilerRejections` additionally retains up to 64 distinct scalar-function
proof failures, including cached failures. Each contains the reason, AST node
kind, enclosing function, relevant name, source expression (at most 160
characters), and available 1-based line/column. These are syntax snapshots:
they do not retain ASTs, frames, or runtime values. Existing `fallbacks` counters
still count repeated attempts independently of this bounded detail list.

## Fallback categories and execution costs

`fallbackCategories` provides a second view of the same attempts as `fallbacks`.
The latter keeps its existing keys for callers. Categories are `effects`,
`representation`, `aliasing`, `proof`, `cost`, and `unclassified`. `cost` means
policy rejected a specialization, not that its semantics were unsafe. Number
loop admission and entry guards give explicit categories. Known legacy compiler
reason details map to categories; unknown details remain `unclassified` rather
than being guessed. Shared keyed folds report a generic-path decision as an
effect/operator or representation limitation. A fallback can be followed by
another successful backend; counts are not numbers of failed programs.

Before adding an admission exception, identify the missing general proof about
effects, ranges, ownership, escape, or work. The reminder also lives beside
`prepareNumberLoop`. Eligibility checks and policy thresholds remain unchanged.

`costs` is a sparse map of stage names to `ExecutionCost`. Absent entries mean
that stage was not observed, not that the runtime performed no work. Timings
are inclusive milliseconds and count invocations, including ones that throw.
Nested stages must not be summed as disjoint costs.

| Stage | Scope |
| --- | --- |
| `program.parse` | Parsing through `Interpreter.execute`; excludes the standalone `parse` API |
| `program.execute` | `executeProgram`, including contracts, declarations and execution, in both engines |
| `input.prepare` | Checked-input contract preparation, including the no-contract scan, in both engines |
| `loop.prepare` | Integer loop compilation entry, including lowering and initial backend preparation; excludes later specialization |
| `number-loop.attempt` | Number backend invocation, including guards, snapshots, late compilation, execution and publication |
| `number-loop.execute` | Generated numeric body and publication, including failed attempts |
| `number-loop.replay` | `discardedAttempts` and `discardedMilliseconds` for numeric overflow: generated execution through rollback, excluding entry preparation |
| `number-loop.snapshot` | Allocated Int32/Float64 entry buffers and successful Fenwick snapshots; copied bytes for typed copies; cells converted into Float64 entry buffers |
| `number-loop.dirty` | Allocated byte masks for entry destinations |
| `number-loop.publish` | Scalar Number-to-BigInt conversions during binding/result publication |
| `array.cow` | Typed array copy-on-write payload and validity-buffer bytes, shared by both engines |
| `array.unpack` | Cells expanded into the boxed array representation, shared by both engines |
| `keyed-fold.execute` | Shared keyed-fold dispatch and execution, including errors and generic fallback |

`allocatedBytes` counts known typed-buffer payloads allocated at these sites;
`copiedBytes` is the subset copied byte-for-byte. Conversions use `unboxedCells`
or `boxedCells`, not an estimated JS object size. Allocation and copy totals are
cumulative traffic: a freed or replaced buffer still counts. Borrowed buffers
and cache hits add no allocation. Partial entry conversions count only completed
cells; an allocated destination still counts when conversion later fails.

This is not a heap profiler. It does not estimate JS arrays, Maps, BigInt sizes,
ASTs, object headers, all vector temporaries, or allocations inside V8. The
`typedArrayPublications` counter describes ownership transfer, not allocation.
Replay counters measure discarded work in elapsed time, not executed instruction
or iteration counts. They do not force counted code generation, change admission,
add checkpoints or include the subsequent exact re-execution time. Existing
`numberLoopOverflows` remains available. These limits apply equally when comparing
reference and compiled runs; zero counters do not imply allocation-free code.

Without a collector there are no diagnostic timers, stage records, reason
classification or per-iteration instructions added to generated loops. Ambient
collector checks and a few call boundaries remain. Enabled measurements include
collector and clock overhead; use separate runs for timing comparisons.

Run `node benchmarks/execution-cost.mjs --baseline=/path/to/built/baseline` to
compare five fresh-process observations per case in both engines, alternating
baseline-off, candidate-off and candidate-on. The harness checks answers and
reports execution time with parsing excluded. `peakRssBytes` is the process high
water mark. `retainedHeapBytes` and `retainedArrayBufferBytes` are process totals
after explicit GC while the runtime and its bindings remain reachable; their
deltas subtract the post-parse baseline. They are not the program's isolated
live-object graph and must not be added to RSS or cumulative allocation bytes.
See [the #509 measurements](../../benchmarks/execution-cost-results.md).

## Hoisting cache validation

The first implementation covers compiled integer loops reading already-computed
numeric/boolean/text tensor caches. Preparation checks cell types and revisions;
a safe entry then prepares a direct reader of private cached storage. It never
materializes an input merely to make compilation possible.

The compiler requires all of the following:

- Every array input has a known revision and already-readable storage.
- The region has no indexed writes, array definitions, container operations,
  iterators or function calls.
- Existing entry guards still accept the values and execution context.

This deliberately excludes even writes to apparently unrelated arrays and calls
to currently pure functions. A loop with an alias writing into a dependency keeps
ordinary checked reads. A stale or incomplete cache falls back without evaluating
cells at entry. A later invocation checks again. Index bounds and error locations
remain checked; there is no global period in which mutation tracking is disabled.

`InterpreterOptions.tensorReadHoisting = false` disables just this optimization
for comparisons. It propagates to imported programs and tests.

Future extensions can prove that specific writes do not alias dependencies, and
can compile cold lazy expressions without allocating intermediate caches. Those
extensions are not part of this initial proof.

## Measurements

On Apple M5, Node v24.15.0, a loop reading a precomputed 10,000-cell tensor one
million times took 61.67 ms without hoisting and 32.15 ms with it (1.92x).
An earlier run measured 51.24 and 26.41 ms (1.94x); absolute timings vary.
These are nine-sample medians with warmup and alternating order, diagnostics off.
Separate instrumented runs show 1,010,002 versus 10,003 validation requests,
including the initial 10,000-cell materialization. Both computed exactly 10,000
cells and performed one revision-graph validation. The reduction is in repeated
cache-gate calls and cell-cache lookups, not a million deep graph traversals.

The final full-suite pair took 32.08 s off and 30.08 s on. An earlier pair took
30.80 s off and 30.44 s on. All 1193 tests in 341 files produced identical
result digests across both pairs. The suite difference ranges from about 1% to
6%; these sequential off/on pairs are not enough to claim a stable suite-wide
speedup. The targeted cached-read workload is the demonstrated benefit.

```sh
node benchmarks/tensor-read-hoisting.mjs
RANK_BENCH_COUNTERS=0 node benchmarks/tensor-fusion.mjs suite compare 1 '' readhoisting
```

[Raw measurements](../../benchmarks/baselines/2026-09-12-tensor-read-hoisting.json)
include both initial and final runs. The final build and `npm test` passed
46 language, 1053 interpreter and 37 CLI tests. Regression cases cover cold
caches, invalidation between invocations, alias writes inside compiled loops,
unknown host storage, call boundaries and nested diagnostic scopes.
