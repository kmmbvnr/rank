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

Stored vector gathers can feed these arithmetic expressions in the same loop:

```rank
Va = W * Pv Tg mod Md
```

Boolean filters keep ordinary execution on this implicit path. Explicit copy
and reduction kernels retain their existing selection support.

This path fuses one expression and keeps named bindings observable. It accepts
stored numeric arrays and scalar operands, including trailing-axis broadcasting.
It does not merge arbitrary statements or evaluate unread lazy inputs. Division,
remainder and powers retain the existing kernel's domain guards; rejection
returns to ordinary execution before publishing a result. Empty outputs with
these operations also retain ordinary execution so scalar errors are not skipped.
Function calls, inspection and observable host polling retain ordinary expression
execution.

### Integer array statement regions

Inside compiled integer loops, eligible chains of local array assignments can
feed a unique linear rank-1 destination slice without materializing the intermediate
arrays. Supported chains include +, -, *, //, mod, comparisons, min/max,
tracked integer gathers and choose. Common subexpressions are shared per cell;
choose reads only its selected branch. Index and divisor bounds must also prove
that eliminating an earlier named intermediate cannot hide its ordinary error.

Only local names without readers or writes outside the chain can disappear.
Pre-existing bindings, escaping results, lazy inputs, inspection and observable
polling keep ordinary execution. The destination is computed into a private
buffer before any stores, preserving overlapping reads and writes. Unsafe
integer arithmetic, invalid indices or zero divisors decline before mutation
and replay the original statements. Compound updates are computed once and
committed through the existing checked assignment path with unique selectors.

`tensorFusion: false` disables these regions too. CLI `--diagnostics` prints
`fusedArrayRegions` and `fusedArrayRegionCells`; both count completed updates.
See [Euler 642 region measurements](../../benchmarks/euler642-fusion-results.md).

Runtime binding
supplies shapes, scalar values and storage offsets before emitting a cached
JavaScript loop. Source kernels never eliminate or skip other assignments.
Typed input buffers are read in place rather than unpacked into ordinary arrays.
Fixed-size copy outputs with a proved integer or real domain write directly to
`BigInt64Array` or `Float64Array`. Integers below the existing packing threshold
stay boxed; an Int64 overflow preserves exact values by switching to boxed
storage. Layout and executable caches distinguish physical input backing types.
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
Native outer maps preserve the Cartesian domain, including all operand axes,
and compose mapped operands and nested products. Unproved sequence operands and
named outer callbacks continue through their existing runtime readers.

Native text-to-integer conversion at rank zero also publishes a map recipe.
Named deferred conversion and arithmetic stages can feed one reduction loop
without completing digit or arithmetic arrays. The text kernel accepts decimal
digits and retains ordinary conversion for other characters or a replaced
builtin. Plan construction reuses syntax preparation, result facts for matching
input metadata, and kernel preparation; every capture still binds its own values
and every demand recomputes its result and runs binding checks. Compiling an
enclosing scalar function or loop remains a separate capability.

The scalar-function compiler also carries explicit recipes for fresh local
deferred stages. Supported pure scalar/vector arithmetic, decimal-character
integer conversion and text conversion can feed a `sum` or an ordinary local
completion directly in generated code. Separate consumers recompute; an
ordinary array assignment emits and retains its own completed storage. A helper
returning a plan may join a compiled caller at a proved ordinary assignment,
so the helper's stages and the caller's control flow need no interpreter frames.
Escaping plans, stage rebindings, captured-slot reassignments, mutable containers,
array writes and unsupported layouts or callbacks retain ordinary execution.
Native implementations are checked at entry, inspection disables the path, and
integer powers with parameter exponents require propagated nonnegative entry
guards. Negative exponents retain their ordinary integer/real result behavior.

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

### Integer producers into grouped consumers

Native recipe construction is shared by tensor compilation and the interpreted
integer reader. The reader does not generate JavaScript or compile Rank control
flow. Both execution engines can feed integer producers directly into `reduce`,
`sum`, `min`, `max` and `scan` with `by`. The existing tensor IR represents stored
inputs, native views, unary signs, broadcasting and outer arithmetic (`+`, `-`,
`*`, `//`, `mod`, `min`, `max`, and integer powers with a captured
nonnegative scalar exponent). No array is allocated for each arithmetic stage.
Native integer shifts and concatenations also stream on any axis, using the same metadata-only layout
proofs as generated tensor kernels. A shift reads only its selected source or
fill; concatenation reads only the selected segment. Empty segments are skipped
and many-segment reader lookup uses binary search.
The reader keeps exact BigInt intermediates even when the final key fits Int32.
The grouped consumer accepts these readers alongside its existing Int32 storage
path; it does not use a producer's output width to limit intermediate arithmetic.

An ordinary assignment still completes its result. A deferred binding can expose
its native recipe after normal plan demand and capture checks. Each consumer
prepares its own readers; no computed-cell cache is shared between demands.
Stored arrays terminate graph traversal even if they once had a recipe. This
preserves completed values and alias snapshots when inputs later change. The
consumer reads and validates a key before reading its value, visits duplicates
in source order, and publishes only the completed result. Integer group state
retains exact arithmetic; the Int32 path widens individual groups when necessary.

The existing capabilities were audited before extending this path:

| Consumer | Existing execution and current limit |
| --- | --- |
| Materialization and ordinary fold | Native tensor graph and generated kernels; stored assignments remain boundaries. |
| Integer prefix scan | Existing native tensor scan; grouped scan now also consumes interpreted integer recipes. |
| Grouped fold/scan | Shared native graph and ordered integer reader in both engines; effectful reducers retain ordinary reads. |
| Scatter/`.accumulate` | Existing selection validation, RHS snapshot and private integer update reduction. This change does not move key or RHS computation across those mutation boundaries. |

Unsupported combinations keep ordinary execution for specific reasons:

- Opaque host arrays, user callbacks and effectful reducers lack a native,
  immutable-input proof. A scalar type annotation alone cannot grant it.
- Real/mixed producers lack the exact-integer domain required by this reader.
  Existing materialized real folds retain their own ordered implementation.
- Powers with array, negative or real exponents and arbitrary scalar-call nodes
  retain ordinary reads, even when another tensor consumer supports them. The
  integer reader admits powers only when the captured scalar exponent proves
  a nonnegative integer domain without reading producer cells. Unsupported
  nodes decline the whole reader.
- Scatter still needs a proof that consuming computed indices and values preserves
  selection validation, RHS completion, error order and alias snapshots. Grouped
  consumers have private results and do not require that mutation proof.
- Debug inspection, observable host polling and demand budgets retain ordinary
  producer reads. Their observable work and state must not be replaced by graph
  preparation or fewer internal checkpoints.

A native reader is a shared runtime kernel, so `compilation: false` still uses it;
statement and control-flow compilation remain independently disabled. The
`keyedNativeReaders` and `integerKeyedFolds` diagnostic counters therefore apply
to both engines. Reference execution continues to supply ordinary control and
fallback semantics rather than acting as an oracle for the shared arithmetic;
producer tests also compare results with independent BigInt calculations.

### Implicit integer bitwise arithmetic

Ordinary assignment completion can fuse native `band`, `bor` and `bxor`
with arithmetic and integer gathers. For example,
`Counts = (Prev (Ix bxor B) + Older (Ix bxor A)) mod Mod`
executes as one tensor pass when the existing shape, storage and builtin
guards hold. No explicit `copy` is required. The implicit path still requires
at least two operations and does not combine separate ordinary bindings.
Integer cells retain exact arithmetic, including values outside signed 64-bit
storage. Unsupported values, changed builtins and failed selector/domain
guards retain ordinary execution and error locations. This does not introduce
row-buffer reuse or fuse a subsequent `concat` assignment.

### Shared inputs in function-plan consumers

A compiled function-plan consumer canonicalizes repeated references to the same
protected array slot, including references through named lazy stages. Its inline
emitter can then reuse one cell temporary at the same address in one generated
loop body. Different input slots, indices, loop bodies and consumers remain
separate. This adds no result arrays or runtime cell cache.

The existing function-entry and linked-call proofs require completed, tracked
storage and protect captured inputs against rebinding. Opaque or deferred inputs
still pass through their ordinary completion and eligibility checks. Ordinary
assignments remain completion boundaries; a helper's deferred return is still
consumed at its original demand boundary. Cancellation, budgets and arithmetic
error locations retain their existing paths.
