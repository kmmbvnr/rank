# Performance roadmap

The measured optimization pass and rejected prototypes are recorded in
[results](optimization-results.md) and the [experiment log](optimization-lab.md).
This page lists further work and the evidence needed to justify it.

## Current priority: array-output fusion

The [fusion improvement plan](tensor-fusion-plan.md), agreed on 2026-09-12, starts
with profiling the missed `copy` terminal and adding one traversal for explicit
array output. [Worker measurements](tensor-workers-results.md) show why local
kernel improvements take priority over automatic parallel execution. The stages
below retain their workload and semantic gates; earlier rejected narrow
prototypes do not rule out the accepted general tensor compiler.

## Named-intermediate fusion

The general tensor compiler already combines eligible private named intermediates
ending in reductions; see [current coverage](tensor-fusion.md). Observable named
values keep their lazy caches. Extend fusion to further terminals and bindings only
when a real workload spends enough time materializing a single-use temporary
to justify use/effect analysis. Preserve reused and partially forced caches.

Why: this could remove more temporary work without requiring source rewrites.
The small residual eager-validation cost does not justify another ownership
tracking system by itself.

## Scalar and container dispatch

The rooms compute profile points to execution-stack and statement overhead.
Condition composition was tried and rolled back: its small mixed-condition
gain did not justify extra machinery, and unifying the existing direct path
regressed playlist. A future attempt needs a different mechanism and a
repeatable gain on unchanged demos. Reprofile the current runtime first.

Why: numeric array kernels do not accelerate most container-heavy CSES loops.
Keep tree recursion, tail calls, memo and short scalar loops as controls.

## Compact storage and generated kernels

The compact real/boolean prototype reduced some retained memory but slowed
ordinary consumers. Revisit only with consumers that can keep values unboxed
or a long-lived boolean workload where memory is the measured limit. Bounded
integers need checked overflow and promotion.

The generated JS binary-sum prototype was also rejected: its narrow warm gain
and smaller cold gain did not justify dynamic code and duplicated arithmetic.
Consider a larger profiled kernel before revisiting code generation. WASM/SIMD
or internal parallel kernels need a suitable representation and workload first.

Why: storage and code generation have conversion, startup and maintenance
costs. A fast isolated kernel is insufficient if full demo execution regresses.

## Broader alias and effect analysis

The [diagnostics and optimization plan](analysis-and-optimization-plan.md)
now gives this work a staged consumer: first more precise REPL facts under
copy-on-write, then broader borrowing and retained compiler proofs. It does not
authorize general buffer reuse without a measured workload and a no-observer
proof. The older offline result below remains a limit on the reuse motivation,
not a reason to discard useful diagnostic analysis.

The offline prototype found no unaffected fresh-array candidate among its
51 array-syntax bindings in 249 parsed functions. Keep it offline until a
specific transformation benefits from better type/effect information.
Unknown application syntax cannot be assumed to be pure indexing merely
because a name has not been reassigned.

Why: cross-expression fusion, retained proofs and buffer reuse require more
than operation-local stability. Reuse also needs proof that no live alias can
observe overwritten contents. No immutable keyword is planned.
See [ADR-0004](../adr/implementation/0004-perceus-borrow-inference-and-compile-time-in-place.md)
for parameter borrow inference and [Open Questions](open-questions.md#copy-on-write-performance-cliff-static-diagnostics-lsp-linting)
for proposed static performance-cliff diagnostics in loops.

## Streaming recurrences with a ring buffer

Euler 186 generates six million integers before consuming calls. A 55-cell ring
can generate the lagged Fibonacci stream as calls are consumed and stop with the
network search. This reduces the generator buffer from 24,000,000 bytes to 220
bytes. Keep this as a memory-oriented option to revisit, rather than an accepted
speed optimization.

Two full-input prototypes were measured on Apple M5 / Node v24.15.0. With the
same final runtime, three fresh-process medians were 258.921 ms / 239.92 MiB peak
RSS for the full array, 304.730 ms / 189.13 MiB for modular ring indices and
267.308 ms / 188.42 MiB for wrapping cursors. The cursor variant reduced peak
RSS by 21.5% but had a 3.2% higher time median. One full reference validation of
the cursor variant took 34.200 s, compared with the full-array reference median
of 29.650 s. Neither ring was adopted.

The existing fixture observes the full `T` array, including `T 99`; a ring changes
that observable state. Revisit this approach for a workload where memory is the
limit and the full history is unnecessary. Any implementation needs an explicit
state contract, stream checks across wrap boundaries and complete-input time
and memory comparisons in both engines. Keep the existing fixture assertions
until that contract is agreed.

See the [Euler 186 report](../../benchmarks/euler186-connectedness-results.md),
[modular prototype](../../benchmarks/fixtures/euler186-ring.ra) and
[cursor prototype](../../benchmarks/fixtures/euler186-ring-cursors.ra) for raw
measurements, correctness checks and reproduction commands.

## Acceptance rules

A small speedup does not justify extra complexity unless the change also
simplifies code. Measure real unchanged demos, small cases and named/reused
controls. Roll back unsuccessful prototypes and retain their results.

Rank execution is sequential. Synchronous numeric operations may use stable
eager storage, but Rank callbacks, lazy readers and writes between calls remain
observable. Our JS objects are an internal protocol; arbitrary Proxy traps,
effectful eager-host properties and concurrent host writes are not supported.
See the [current boundary](array-storage.md). Do not reintroduce a public
embedding compatibility layer without a demonstrated need.

Preserve floating-point order, BigInt precision, errors and source positions,
closures, recursion, tail calls, file lifetime and mutable aliases. Do not
silently reassociate reductions for parallel execution.

Run all JS and demo tests plus relevant before/after benchmarks. Cold
judge-scale timeout checks complement repeated warm measurements; passing a
timeout does not establish unchanged performance. Compare equivalent syntax
forms with `benchmarks/extrema.mjs`. Use deterministic execution-path tests
where a completed expression must avoid extra generator tasks.
