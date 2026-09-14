# Runtime diagnostics and stable tensor readers

Diagnostics are an optional TypeScript API for compiler development and future
CLI/editor inspection. They introduce no Rank syntax, output or evaluation step.

```ts
import { Interpreter, RuntimeDiagnostics } from '@rank/interpreter';

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
`tensor:entry-guard`. These count attempts, not unique statements: one variant
can fail before another succeeds. They are not runtime errors, and do not claim
to describe every compiler in Rank or mid-loop deoptimization.

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
