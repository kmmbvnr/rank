# Tensor fusion as Rank's execution architecture

Accepted design decision, 2026-09-11.

Combining compatible tensor operations into a shared execution plan is a core
architectural direction of Rank. It is not a special optimization for one contest
problem. The reference interpreter and compiler will progressively implement this
model while the language continues to develop.

Readable pipelines name recomputable stages explicitly:

```rank
Squared' = Error * Error
Mse = Squared mean
```

An ordinary `Squared = Error * Error` completes and retains the array. The
compiler preserves that boundary regardless of consumer count. Supported native
plan stages can compose after normal demand and binding checks. Fusion remains
an implementation capability, not a guarantee that every plan uses one loop.

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
floating-point evaluation order, observable errors, lexical bindings, captured
values, mutation and resource ownership. Associativity must not be assumed for
floating-point reduction. Eager error checks must not disappear behind a
short-circuit reduction. Repeated plan demand repeats its effects. Opaque callbacks keep their canonical
execution and cannot acquire a native capability from a numeric annotation.

Guards must run before visible writes or other effects. A rejected plan uses
ordinary execution without replaying user effects. Browsers that prohibit dynamic
code generation must retain a working reference path. Debugger inspection uses reference statement execution.

## Delivery policy

Expand coverage incrementally and verify each step with reference-versus-optimized
semantic tests and representative unchanged demos. Report per-task timings and
full-suite timings separately, including compilation overhead and regressions.
The architecture is accepted now; coverage and measured gains remain properties
of each implementation revision, not promises of the language specification.

## Current implementation

The default interpreter now uses `tensor-kernel.ts` for compatible assignment
expressions. It lowers one statement into input,
binary, unary, selection, first-axis slice and default-axis concat nodes with a
terminal reduction or explicit `copy`. Ordinary assignments and returns containing
at least two arithmetic operations from `+`, `-`, `*`, `/`, `//`, `mod`, `**`
(including unary signs)
also use the array-output terminal without requiring a source-level `copy`:

```rank
Packed = (Numerator + Shift) * Width + Denominator
```

This path fuses one expression and keeps named bindings observable. It accepts
stored numeric arrays and scalar operands, including trailing-axis broadcasting.
It does not merge arbitrary statements or evaluate unread lazy inputs. Division,
remainder and powers retain the existing kernel's domain guards; rejection
returns to ordinary execution before publishing a result. Empty outputs with
these operations also retain ordinary execution so scalar errors are not skipped.
Function calls, inspection and observable host polling retain ordinary expression
execution.

Runtime binding
supplies shapes, scalar values and storage offsets before emitting a cached
JavaScript loop. Source kernels never eliminate or skip other assignments.
Typed input buffers are read in place rather than unpacked into ordinary arrays.
`benchmarks/tensor-expression.mjs` compares implicit expression fusion against
separate passes for integer polynomials, real arithmetic and matrix/vector
broadcasting, checking every result against an independent oracle.

Eligibility is cached on the existing prepared statement. Ordinary statements do
not perform a second optimizer-cache lookup on every execution. Successful
kernels assign their terminal value through the usual typed write site. Failed
guards execute the original statements through the existing resumable executor.
There is no experimental loop VM in this implementation.

Supported operations currently include `+`, `-`, `*`, `/`, exact integer `//`
and `mod`, guarded powers, first-axis `take`/`drop`, default-axis concat,
numeric comparisons, boolean operations, integer indexing of leading matrix
axes, vector masks, vector gathers and `sum`, `mean`, `min`, `max`, `any`, `all`,
`count`. Arithmetic arrays use ordinary trailing-axis broadcasting.
Elementwise reductions may traverse an entire multidimensional array; filtered
and gathered domains are currently restricted to vectors.

Unread lazy inputs, arbitrary sequences, explicit `axis`/`rank` reductions and
unsupported calls retain reference execution. Checked contiguous stored integer
views can be borrowed without forcing lazy cells. Deferred native maps and
scalar views also publish capabilities for the same IR. View addresses preserve
source coordinates and result-check coordinates separately. Completed storage
ends native graph traversal; eager bindings remain storage boundaries.

The [tensor kernel ADR](../adr/implementation/0003-tensor-kernel-fusion-and-execution-planner.md)
describes native composition, per-demand checks, early boolean terminals and
code-only caching. Unsupported sources retain their canonical capabilities.

Total numeric `+`, `-`, `*` and unary signs can fold before the array domain.
Other scalar operation subexpressions retain reference execution, so their
errors cannot disappear when the surrounding tensor or selection is empty.

Concat code variants and eligible input layouts have bounded caches containing
only code and metadata. Every execution rebinds current storage and validates its
kind, shape and offsets. Binding/cell validation runs only after all layout and
scalar guards accept the kernel; a declined candidate does not establish an
unread input contract. No old operand buffers or results are retained. Proven integer output kinds avoid a second type scan of copied results.

The compiler retains ordinary BigInt integers, mixed numeric promotion and the
original arithmetic tree and reduction order. It validates numeric and boolean
items without converting storage to another representation. It does not silently
materialize lazy inputs. Array storage must follow the interpreter's existing
protocol of tracked stable storage or checked stored views during synchronous
execution.

`InterpreterOptions.tensorFusion: false` selects reference statement execution.
The option propagates into imported modules and test interpreters. Diagnostic
callbacks `onTensorKernelCompiled` and `onTensorKernelExecuted` expose generated
code and successful executions. If browser CSP blocks `Function`, the candidate
is disabled and ordinary evaluation continues.

## Next extensions

The [2026-09-12 implementation plan](tensor-fusion-plan.md) records the initial
stages: explicit materialization through `copy`, readable expression forms and
measured iteration-domain extensions. The [worker experiment](tensor-workers-results.md)
provides the evidence for improving local fusion before automatic parallelism.

Use benchmark evidence to extend coverage: preserve explicit retention and recomputation while
supporting native readers, add range/sequence plans, describe `axis` and `rank` in
the iteration domain, and support further expression positions and library
operations. Existing inline arithmetic/reduction helpers remain available while
this representation grows. Each extension must justify its eligibility and
semantic boundaries rather than require programmers to rewrite clear examples.

See [fusion measurements](tensor-fusion-results.md) for reproducible timings,
coverage and known limitations of the current revision.

## Incremental implementation results

See [compiler progress](compiler-progress.md) for subsequent optimizations,
including queue type summaries and specialized array access. Computed arrays
can feed kernels without forcing a deferred input merely to establish eligibility.

See [explicit copy fusion](array-output-fusion.md) for the first array-output
implementation and its measurements.
