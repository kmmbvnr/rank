# Performance roadmap

Only remaining work is listed here. Completed changes, benchmark commands and
raw-result links are in [performance measurements](performance-measurements.md).

## Finish the remaining measurements

The unchanged numerical suite, independent oracles, sizes, profiles and gradient
feature/iteration variants are implemented. Keep them as controls. CSES compute
is now measured separately: the rooms profile points to statement/task overhead,
while restaurant has substantial event-construction work before its sort.
The condition-composition experiment was rejected: its mixed-condition gain was
small, and unifying the direct path regressed playlist. Do not repeat that
transformation without a different cost model.
Keep small-input and named-intermediate controls when widening fusion. The
latest isolated real snapshot controls retained a 3–4% cost with explicit GC;
do not add complex producer tracking solely for that gain. Recheck aggregate
demo performance against main before delivery.

Why: timeout smoke checks alone cannot identify a bottleneck or establish that
an optimization preserves performance elsewhere.

## Extend fusion to the forms used by demos

The worktree's private storage contract repairs the descriptor-probe bug and
enables the sum experiment without probing unknown host objects. Finish its
acceptance checks before merging: snapshot matvec improves, but named snapshot
reductions still have measured costs. Shared evaluation composition improves
lazy k-means; composing operand collection and unary extrema removed its initial
bounded-sum regression. The short-vector cache
prototype was rejected: its small gain did not justify added complexity. The coordinate-copy
change removed the ordinary mean regression and made row/column means about
three times faster at 512 square. Revise or remove the remaining responsible
parts and repeat the controls. See
the [optimization log](optimization-lab.md#4-private-storage-correctness-repaired-performance-costs-remain).

Builtin `sum` on inline arithmetic and Euler's guarded sequence power have been
implemented and measured. Consider single-use named temporaries and private
readers if profiles justify them.
Preserve shadowed functions, sum's seed, lazy read timing and repeated-use caches.
Fuse named values only after proving the relevant use and effect boundaries.

Why: this can remove temporary-array work from ordinary programs without asking
users to rewrite them into a special benchmark form.

## Revisit compact storage after private consumers exist

The real/boolean prototype was measured and rolled back: matvec and row/column
means became slower, while boolean storage used fewer retained bytes. Results
and the rejected patch are in the [log](optimization-lab.md#5-compact-realboolean-buffers-rejected-and-rolled-back).
Revisit only after ordinary numeric consumers can avoid exposing and boxing each
temporary. A long-lived boolean workload may justify a separate memory tradeoff.
Bounded integer storage remains conditional on a matching workload and checked
overflow/promotion; the log records the constraints.

Why: reduced memory traffic can help array kernels. Storage alone cannot remove
the interpreted triple-loop overhead in DeepML 009.

## Optimize measured scalar and container costs

Use CSES and DeepML 009 profiles to choose one hot path at a time: indexing,
record fields, container methods or loop dispatch. Retain recursion, tail-call
and memo benchmarks as regression controls.

Tensor row/column copying and matrix transpose coordinate reuse have been
measured and improved. Shared completed-result composition also made scalar
matmul more than twice as fast; completing the same mechanism for unary extrema
also improved bounded-sum. Reprofile before specializing multidimensional
selectors; previous measurements included the now-removed suspension cost.

Why: array reductions do not cover most scalar CSES algorithms.

## Reconsider generated JS only for a larger measured bottleneck

The private binary-sum loop prototype was measured and rolled back: its limited
warm gain and smaller cold gain did not justify dynamic code and duplicated
arithmetic. See the experiment log. Revisit only if profiles show a larger
candidate than this narrow fold, and compare cold compilation with cached runs.
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

A small speedup does not justify extra implementation complexity. Keep a small
gain only when the change also simplifies the code. Specialized paths need a
repeatable benefit large enough to justify their added maintenance and tests;
otherwise roll them back and record the experiment.

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
For syntax changes, compare equivalent spellings and the affected demos against
the previous runtime using identical sources and inputs. Add a deterministic
execution-path test when a synchronous form must avoid generator tasks. Use
`benchmarks/extrema.mjs --baseline=/path/to/built/checkout` as the first such
comparison; extend the workloads when introducing other forms. A passing
judge-scale timeout alone is not evidence of unchanged performance.
If a targeted unchanged demo shows no repeatable benefit, revise or defer the
optimization.
