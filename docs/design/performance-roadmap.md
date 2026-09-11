# Performance roadmap

Only remaining work is listed here. Completed changes, benchmark commands and
raw-result links are in [performance measurements](performance-measurements.md).

## Next: benchmark and profile unchanged demos

Extend the [judge-scale suite](judge-scale-benchmarks.md) with numerical demos.
Keep their source unchanged; vary inputs or call existing functions from a
benchmark harness. Microbenchmarks explain costs; real programs decide priorities.

- **Euler 006, sum square difference:** increase `Limit`. Its range, `** 2`,
  named `Squares` intermediate and builtin `sum` check whether optimization
  reaches ordinary source code rather than only `+ reduce`.
- **DeepML 004, matrix mean:** measure row and column modes on large matrices.
  Separate strided reads and cell creation from numeric summation.
- **DeepML 009, matrix multiplication:** increase matrix dimensions. Its triple
  loop measures scalar dispatch and multidimensional indexing.
- **DeepML 015, gradient descent:** vary rows, features and iterations. Profile
  builtin `matmul`, transpose and temporary arithmetic across iterations.
- Keep the CSES restaurant, rooms, playlist, books and bounded-sum workloads,
  plus the sum control. Separate sorting and container work from input/output.

Check results independently; record cold end-to-end and warm compute time where
applicable at several sizes. Alternate version order without concurrent heavy
work. Save raw samples, memory measurements and revisions. Investigate small-input
and named-intermediate timing regressions in the fusion report before widening it.

Why: the current inline arithmetic reduction does not match existing demos.
A repeatable benefit in unchanged programs is the acceptance criterion.

## Extend fusion to the forms used by demos

Start with builtin `sum` on arithmetic results. Consider single-use named
temporaries and range readers if profiles justify them. Euler 006 also needs a
guarded power operation; supporting `sum` alone will not accelerate it.
Preserve shadowed functions, sum's seed, lazy read timing and repeated-use caches.
Fuse named values only after proving the relevant use and effect boundaries.

Why: this can remove temporary-array work from ordinary programs without asking
users to rewrite them into a special benchmark form.

## Add compact numeric storage where profiles justify it

Prototype real and boolean storage against the numerical demo profiles. Measure
conversion costs, strided access and temporary buffers, including small and mixed
arrays. Design integer storage separately: `Float64Array` loses large-integer
precision and `BigInt64Array` cannot hold arbitrary-size integers. Bounded
integer storage needs checked overflow and promotion.

Why: reduced memory traffic can help array kernels. Storage alone cannot remove
the interpreted triple-loop overhead in DeepML 009.

## Optimize measured scalar and container costs

Use CSES and DeepML 009 profiles to choose one hot path at a time: indexing,
record fields, container methods or loop dispatch. Retain recursion, tail-call
and memo benchmarks as regression controls.

Why: array reductions do not cover most scalar CSES algorithms.

## Try generated JS after simpler optimizations

Prototype guarded generated numeric loops if reader/callback overhead remains
visible. Compare cold compilation plus execution with cached warm runs.
Revalidate inputs at each call. Expand to user loops/functions only when demo
profiles justify it. Preserve deep recursion, tail calls, closures, resource
cleanup and Rank diagnostics.

Why: code generation adds startup and maintenance costs. WASM/SIMD and internal
parallel kernels remain conditional experiments after suitable storage and
measured workloads exist.

## Last: broader mutation and alias analysis

Add conservative analysis after parsing, initially within one function. Track
writes through aliases such as `B = A` and escapes through calls, containers,
returns and closures. Unknown calls and host values need a checked contract or
ordinary execution. No new keyword is planned.

Use these proofs for optimizations across expressions, retained validated facts
and buffer reuse. Reusing a buffer additionally requires proof that no live alias
can observe overwritten contents.

Why: these transformations span places where writes may occur. Whole-function
analysis is unnecessary for the operation-local cases below.

## Safety and acceptance rules

Rank execution is sequential. A synchronous read-only kernel may treat inputs as
stable for that call if it invokes no effectful lazy readers, user callbacks or
host hooks and uses no externally shared mutable storage. An alias alone does
not cause a write. This can support fusion and hoisting proven shape/storage
checks out of loops; it does not prove numeric element types.

JS getters and proxies can execute writes during reads. Preserve that behavior
or use a validated access contract. Revalidate facts between calls. Preserve
error timing, floating-point order, BigInt precision and resource lifetimes.
Internal parallelism must retain observable sequential behavior; it may not
silently reassociate floating-point reductions.

Test empty/mixed inputs, aliases, mutations, effects and Rank positions. Run all
JS and demo tests plus relevant benchmarks. Report regressions alongside gains.
If a targeted unchanged demo shows no repeatable benefit, revise or defer the
optimization.
