# Tensor fusion as Rank's execution architecture

Accepted design decision, 2026-09-11.

Combining compatible tensor operations into a shared execution plan is a core
architectural direction of Rank. It is not a special optimization for one contest
problem. The reference interpreter and compiler will progressively implement this
model while the language continues to develop.

Readable source remains the priority. Short lines and named intermediate values
must not inherently require temporary arrays or additional passes:

```rank
Squared = Error * Error
Mse = Squared mean
```

When use analysis and runtime guards establish that `Squared` is private to this
calculation, the implementation may combine multiplication and reduction. Values
that escape, are reused or are observable through mutation/capture must retain
their specified behavior. Fusion is an implementation freedom, not a guarantee
that every expression runs in one pass.

## Common execution representation

The compiler should describe reads, elementwise operations, comparisons,
selection, indexed gathers and reductions in a composable intermediate
representation. Shape, cell rank, axes and traversal order belong to that model.
Unsupported ranks, layouts or operations may continue through the reference
runtime until their lowering is implemented. New operations should extend this
representation rather than introduce task-specific recognizers.

A compiled plan can apply inside or outside a loop. Compiling the surrounding
control flow is a separate decision. Library kernels such as matrix multiplication
may remain optimized calls with surrounding elementwise work combined where safe.

## Semantic requirements

Optimizations must preserve inferred types, exact integer arithmetic,
floating-point evaluation order, observable errors, lexical bindings, lazy
snapshots, mutation and resource ownership. Associativity must not be assumed for
floating-point reduction. Eager error checks must not disappear behind a
short-circuit reduction. Impure calls form boundaries unless a stronger analysis
proves otherwise.

Guards must run before visible writes or other effects. A rejected plan uses
ordinary execution without replaying user effects. Browsers that prohibit dynamic
code generation must retain a working reference path. Debugger inspection of
eliminated intermediates will require reconstruction or disabling that optimization.

## Delivery policy

Expand coverage incrementally and verify each step with reference-versus-optimized
semantic tests and representative unchanged demos. Report per-task timings and
full-suite timings separately, including compilation overhead and regressions.
The architecture is accepted now; coverage and measured gains remain properties
of each implementation revision, not promises of the language specification.

## Current implementation

The default interpreter now uses `tensor-kernel.ts` for compatible assignment
expressions and groups of consecutive assignments. It lowers them into input,
binary, unary and selection nodes with a terminal reduction. Runtime binding
supplies shapes, scalar values and storage offsets before emitting a cached
JavaScript loop. `tensor-use.ts` provides lexical read/definition counts and
conservative barriers for escaping or multiply defined intermediates.

Eligibility is cached on the existing prepared statement. Ordinary statements do
not perform a second optimizer-cache lookup on every execution. Successful
kernels assign their terminal value through the usual typed write site. Failed
guards execute the original statements through the existing resumable executor.
There is no experimental loop VM in this implementation.

Supported operations currently include `+`, `-`, `*`, `/`, guarded powers,
numeric comparisons, boolean operations, integer indexing of leading matrix
axes, vector masks, vector gathers and `sum`, `mean`, `min`, `max`, `any`, `all`,
`count`. Arithmetic arrays must have matching shapes or scalar operands.
Elementwise reductions may traverse an entire multidimensional array; filtered
and gathered domains are currently restricted to vectors.

Lazy inputs, arbitrary sequences, broadcasting between different shapes,
explicit `axis`/`rank` reductions and unsupported calls retain reference
execution. Named intermediates are eliminated only inside functions, after
checking their definitions, uses and existing lexical bindings. Top-level names
remain observable; inline assignment expressions can still be fused there.
Private temporary names may have multiple reads within the fused calculation,
for example `Difference * Difference`.

Scalar operation subexpressions currently retain reference execution, so their
errors cannot disappear when the surrounding tensor or selection is empty.

The compiler retains ordinary BigInt integers, mixed numeric promotion and the
original arithmetic tree and reduction order. It validates numeric and boolean
items without converting storage to another representation. It does not silently
materialize lazy inputs. Array storage must follow the interpreter's existing
protocol of ordinary stable data properties during synchronous execution.

`InterpreterOptions.tensorFusion: false` selects reference statement execution.
The option propagates into imported modules and test interpreters. Diagnostic
callbacks `onTensorKernelCompiled` and `onTensorKernelExecuted` expose generated
code and successful executions. If browser CSP blocks `Function`, the candidate
is disabled and ordinary evaluation continues.

## Next extensions

The [2026-09-12 implementation plan](tensor-fusion-plan.md) prioritizes explicit
array materialization through `copy`, followed by coverage of readable expression
forms and measured iteration-domain extensions. The [worker experiment](tensor-workers-results.md)
provides the evidence for improving local fusion before automatic parallelism.

Use benchmark evidence to extend coverage: preserve observable caches while
supporting lazy readers, add range/sequence plans, describe `axis` and `rank` in
the iteration domain, and support further expression positions and library
operations. Existing inline arithmetic/reduction helpers remain available while
this representation grows. Each extension must justify its eligibility and
semantic boundaries rather than require programmers to rewrite clear examples.

See [fusion measurements](tensor-fusion-results.md) for reproducible timings,
coverage and known limitations of the current revision.

## Incremental implementation results

See [compiler progress](compiler-progress.md) for subsequent optimizations,
including cached queue type summaries and compiled access to completed lazy
`round` caches. These extend the initial eager-input coverage without forcing
previously unevaluated values.
