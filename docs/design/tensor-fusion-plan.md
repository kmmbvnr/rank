# Tensor fusion improvement plan

Agreed priority, 2026-09-12. This is planned compiler work, not additional language
syntax. Stage delivery and measurements are recorded separately below.

The first [explicit copy implementation](array-output-fusion.md) covers equal-shaped
materialized inputs and safe private intermediates. The next
[broadcasting stage and workload profiles](fusion-domains.md) extend explicit
copy/reduction domains. [Window-cell folds](window-reduction-fusion.md) now
compose window geometry with ranked reductions. General axis-reduction fusion
and the final worker comparison remain pending.

The [worker experiment](tensor-workers-results.md) measured about 252 ms for
`(A * A + A * 2.0 + 1.0) copy` on one million real elements. Four workers reduced
that to 92 ms, including transport. A handwritten JS loop took about 1 ms.
The JS control lacks Rank's generic guards and is not a promised compiler result.
It provides evidence to investigate local fusion before scheduling more workers.

The existing [architecture](tensor-fusion.md) and semantic requirements apply.
Keep readable Rank source, ordinary temporary names and the current meaning of
`copy`. Automatic materialization and new numeric representations are not part
of this plan. Any required language change returns to the user for a decision.

## 1. Establish the missed execution path

Reproduce the polynomial on the current main revision in an isolated worktree.
Profile both the full call and forced result. Record parsing/preparation, generated
kernel counts, guard cost, materialization, allocation/GC and warm execution
separately where practical. Do not run instrumentation during timing comparisons.

Before the first stage, `compileTensorKernel` in `tensor-kernel.ts` accepted
only terminal reductions. `copy` was not one of those terminals. The polynomial
therefore cannot use that general fused plan, even though other specialized
compiler paths exist. Confirm the executed path before changing the compiler.

Compare equivalent return, assignment and private-named-intermediate forms:

```rank
return (A * A + A * 2.0 + 1.0) copy
```

```rank
Squared = A * A
Shifted = Squared + A * 2.0 + 1.0
return Shifted copy
```

Start with sizes 0, 1, 1000, 10000, 100000 and 1000000. Keep the JS control,
reference Rank execution and current optimized Rank execution in the benchmark.
Forces and output copies belong inside the timed region in every comparable case.

Done when a reproducible profile identifies the missed path and a benchmark
records both output correctness and compilation coverage for each source form.

## 2. Fuse explicit array materialization

Extend the existing tensor plan with an array-output terminal for explicit `copy`.
Start with eager numeric inputs of equal shape, scalar operands, and supported
arithmetic. Reuse shape binding, operation nodes, guards and code emission rather
than building a recognizer for this particular polynomial.

Allocate one fresh result array and emit one traversal of its cells. Entry
validation may still require separate scans: do not claim that all work is a
single pass unless measurement confirms it. Preserve the arithmetic tree, inferred
element types, BigInt precision and mixed numeric promotion. Do not rewrite the
formula to `(A + 1) ** 2` or use floating-point reassociation.

`copy` must still produce independent writable storage. Merely constructing a lazy
expression must not force it. If reordered validation or element evaluation could
change an observable error, retain the reference path until a proof handles it.
Guards must finish before any visible effect, with no fallback that replays work.

Done when generated-code/coverage tests prove the materialization path is used,
reference comparisons pass, and the 100K/1M fixtures improve in repeated paired
runs without a material regression on small inputs. Record any remaining gap to
the handwritten loop; do not choose a speculative speedup target as a release gate.

## 3. Cover readable expression forms

Apply the array terminal to safe private named intermediates using existing
use/definition analysis. A repeated read such as `Difference * Difference` should
share the expression plan where safe. Reused, escaped, captured or observable
intermediates keep their required caches and values. Never optimize away an
independent assignment because it is absent from the final expression.

Exercise assignments and returns, nested parentheses, repeated calls, closure
name collisions, shadowed builtins and mutation after `copy`. Keep scalar-only
calls as controls. Prefer extending existing expression/statement preparation
over another global cache or runtime search on every invocation.

Done when equivalent readable forms have matching coverage and results, while
observable intermediates deliberately retain ordinary execution.

## 4. Extend iteration domains from measured workloads

After the materialization path passes its gate, choose the next extension using
profiles of unchanged examples. Candidate workloads are Deep-ML 019's
standardization arithmetic, Deep-ML 015's prediction/error calculations, and
Euler 008's window/product/max pipeline. Measure these whole functions or programs;
operation-level worker timings are not a substitute.

Possible extensions, each delivered separately:

- Broadcasting: shape and stride planning outside the cell loop, using the
  existing language semantics; begin with layouts that an actual example needs.
- `axis`/`rank`: represent the frame and cell traversal in the plan. Preserve
  contracted-axis accumulation order and result shape.
- Windows followed by reductions: calculate window addresses without a matrix
  of intermediates, preserving overlapping reads and the specified reduction
  order. Benchmark both the original 1000 digits and larger inputs.
- Completed lazy caches and library outputs: consume existing materialized
  storage without silently forcing other lazy readers or changing snapshots.

Matrix multiplication can remain a library kernel. Optimize its dense inner loop
separately if profiles justify it; source fusion does not itself make matmul fast.
Do not expand all these areas before measuring the first array-output change.

## Validation and delivery for each stage

Use optimized-versus-reference tests plus an independent numeric oracle. Cover
empty dimensions, shape errors, integer/real/mixed values, large integers,
NaN/infinity/signed zero, competing error sources and positions, builtin
shadowing, partially forced lazy values, repeated reads, alias mutation and fresh
`copy` storage. Unsupported cases may use the reference path, but must agree with
it. Test disabled dynamic code generation and the reference fallback.

Run the TypeScript suite and all demo tests. Record repeated alternating before/
after measurements for the focused operations and unchanged affected demos, plus
full-suite timing separately. Include cold compilation cost and warm reuse; never
count lazy construction as completed output. Compare source hashes, answers and
shapes, not only elapsed time. Keep useful stage changes in separate commits.

## Revisit workers after local kernels

Rerun the worker benchmark against the improved local kernel. Cheap fused maps
may no longer justify any transfer. Consider a persistent worker scheduler only
for heavy independent operations with repeatable end-to-end gains. Residency,
materialization boundaries and the asynchronous host interface need a separate
design before integration. Do not parallelize real-valued reductions by changing
their order. Mobile/browser timing, memory and energy need measurements on those
devices; desktop crossover sizes are not defaults for phones.
