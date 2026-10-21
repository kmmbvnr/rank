# 0003. Tensor Kernel Fusion and JIT Execution Planner

* **Status:** Accepted
* **Date:** 2026-09-11
* **Deciders:** @kmmbvnr
* **Consulted:** Rank Language Specification, Tensor Fusion Architecture, Tensor Benchmark Suite

## Context

Rank distinguishes computation plans from retained results. An ordinary binding
`A = Expr` completes its result before execution proceeds to the next statement.
An apostrophe binding `A' = Expr` captures a recipe; every demand recomputes it.
This includes scalar reductions. Neither unused names nor a single consumer
permit the compiler to discard an ordinary binding's completion boundary.

Readable pipelines can name deferred stages:

```rank
Difference' = A - B
Squared' = Difference * Difference
Mse = Squared mean
```

The compiler must compose supported stages without adding a second set of
binding, demand or type rules. Completing a result does not require allocating
every intermediate expression: `(A * A + 1) sum` may use a single scalar loop.

## Decision

### Bindings and source expressions

A source tensor kernel compiles exactly one assignment or return expression.
It never skips following statements or substitutes other bindings' expressions.
Ordinary array outputs pass through the shared `materializeValue` binding path.
Typed function kernels and compiled loops use that same completion contract.
A proved element type alone does not establish that an array is completed.

A function body executes when called. Its ordinary locals complete during that
call. Bare `return` passes the result through without adding completion;
an explicit `copy` requests independent writable storage. Deferred assignments
use the reference plan-capture and binding path.

A scalar reduction inside a deferred expression may enter the source kernel
at demand. It runs in the captured frame and returns through normal binding
checks. Array-valued plans retain their native result. Boolean reductions use
the native graph below to preserve selection validation and early termination.

### Native composition

Normal demand creates a stage's native result and applies its binding contract.
Native array maps publish their operator and actual operands independently of
the source AST. Scalar views publish their source and address mapping. The
compiler lowers these capabilities into the same tensor IR and emitter used by
source expressions. Captured plan ASTs are never inlined into consumers.

The native graph covers supported arithmetic, numeric comparisons, boolean
logic and unary signs. Signatures come from the shared operator catalogue.
Slices, index-array selections and axis permutations compose through address
nodes. Checks around a source run in source coordinates; checks around its view
run in result coordinates. Duplicate and reordered indices retain visit order.
Opaque readers and unsupported operations retain canonical traversal.

Completed storage ends graph traversal. Arithmetic while constructing a plan,
or over an escaped native plan result, avoids allocating a dense intermediate
merely because the operands happen to be stored. An ordinary receiving binding
still completes the final value. Reshape retains its source completion boundary.

The native graph supports `sum`, `mean`, `min`, `max`, `count`, `any` and `all`.
Boolean terminals stop as soon as their answer is known; unvisited contracts do
not run. Selection validates indices before producing its result, so an early
answer cannot hide an invalid index. Named masks reject numeric reductions;
`count` reads their boolean cells. Empty means and extrema preserve their errors.

### Guards, ownership and fallback

Every demand checks compilation policy, builtin identity, input storage, shape
and numeric domains. Reader, revision and address guards are checked again after
compilation callbacks. If a selection detaches, fallback uses its current
snapshot. An unproved reader is not invoked merely to make a guard pass.
Unsupported domains decline before observable guest computation. A failed kernel
does not publish a partial eager binding or replay completed guest effects.

A demand owns its graph, checks and address closures. Expression sites may retain
a bounded cache of generated code, with fresh data, checks and routes for each
run. Escaped native arrays retain their compiler capability. No plan result or
prefix is retained across demands. Parser and code caches are separate from
value retention.

Interruption and demand budgets apply to warm as well as cold code. Inspection
uses the reference paths. `InterpreterOptions.tensorFusion = false` disables
this optimization without changing binding semantics.

## Consequences

Ordinary names explicitly pay for retained storage. Apostrophe bindings name
recomputable stages and expose supported native composition. A missing apostrophe
may allocate more storage; the compiler does not infer retention intent from
consumer counts.

Integer kernels preserve arbitrary precision. Real kernels preserve expression
and accumulation order. Shape/type guards and code generation have costs;
compilation coverage alone proves neither a speedup nor lower memory use.
Measurements must separate these outcomes and include the cost of completion.

Source-specific operations and unsupported graph nodes keep their canonical
capabilities. This IR does not imply that every deferred stage has a specialized
kernel, or that another backend may bypass the shared demand/binding contract.
