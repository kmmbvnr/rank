# Typed tensor specialization (#474)

Preserving the proved real type of completed Float64 results removes a full
array scan at each assignment. In the measured Rank loops this gives about
2.8-2.9x speedup. Removing primitive type dispatch alone had little effect.
Finite-value checks remain in the arithmetic loop. Int32 inputs still become
BigInt values so that intermediate arithmetic stays exact.

The worktree starts at `9099399f`, which includes destination reuse from #468.
The emitter uses physical input types and scalar types, already covered by the
kernel variant key. Boxed inputs and callback outputs retain dynamic checks.


The real-result proof comparison uses the same primitive-specialized emitter on
both sides. Only the proof supplied to `typedArray` differs. Five samples per
variant alternate their order, each in a fresh process. Each sample warms up
100 updates and times 1,000 updates of 50,000 cells. Vector shape is `[50000]`;
matrix shape is `[200, 250]`. `vector-execute` calls the interpreter separately
for every update; the other workloads execute one loop written in Rank.

| Workload | Without proof, median ms | With proof, median ms | Median paired speedup |
| --- | ---: | ---: | ---: |
| vector-execute | 584.8 | 279.9 | 2.09x |
| vector-loop | 486.3 | 170.0 | 2.86x |
| matrix-loop | 506.9 | 177.8 | 2.81x |

Every sample has 1,000 buffer reuses and the same result sum, 5,199,727.
Type scans fall from 1,000 scans / 50,000,000 cells to zero. Raw results are in
`baselines/2026-10-29-tensor-real-proof.json`. The change also preserves the proof
when shared input forces allocation of a new destination buffer.

A successful copy already checked every real result for finiteness. Publishing
that proof avoids repeating the classification in the binding contract. Failed
kernels still decline, and later writes update the stored type counts normally.
Tests cover both paths and a subsequent write of Infinity.

The following measurements describe the earlier primitive-dispatch change alone,
before real-result proof preservation was added.

Measured on Apple M5, Node v24.15.0: 50,000 cells, 500 updates per sample,
seven paired samples. The baseline and prototype kernels run in the same process,
with alternating order, 200 initial warmup updates, and 20 updates after each
reset. Input setup, reset and result summation are outside the timer. The kernel
benchmark records exclusive ownership explicitly, as the interpreter's binding
layer normally does. Each timed sample reuses its destination buffer 500 times.
All baseline/prototype result sums match exactly.

The table uses the median of the seven paired baseline/prototype time ratios.
It does not divide the separate medians, which can mislead when timings drift.

| Storage | Shape | Median paired speedup |
| --- | --- | --- |
| float64 | 50000 | 1.005x |
| float64 | 200 x 250 | 1.002x |
| int32 | 50000 | 1.037x |
| int32 | 200 x 250 | 1.041x |
| int64 | 50000 | 1.034x |
| int64 | 200 x 250 | 1.035x |

Float64 is effectively unchanged. Integer kernels show a small measured gain;
these runs do not establish a statistically significant improvement. Initial
interpreter-level measurements showed roughly 0-4% improvement, but a later
baseline run was much slower. Raw timings for all these runs are preserved in
`baselines/2026-10-29-typed-tensor-specialization.json`. A subsequent CPU profile
attributed about 48% of Float64 samples to `storedScalarKinds`, reached through
assignment binding checks, and about 24% to the generated arithmetic loop.

Validation: TypeScript build, 1,007 tensor, binding, storage and contract tests, semantic
boundary checks, and application-form checks pass. Seven new tests cover emitted
specialization, cache changes between storage/scalar types, mixed numeric
promotion, non-finite values hidden by comparisons, division by zero, and exact
integer results beyond int64. The full workspace test suite was not run.

Reproduce from this worktree:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run langium:generate
npx tsc -b tsconfig.build.json
node --expose-gc benchmarks/experiments/typed-tensor-paired.mjs
node --expose-gc benchmarks/experiments/typed-tensor-bench.mjs
node benchmarks/experiments/tensor-real-proof-bench.mjs
```

The paired script obtains the baseline emitter from Git and transpiles a temporary
module beside the built interpreter. Both versions use the same runtime/storage.
The second script measures `Interpreter.execute` on the currently built revision;
run it on both revisions in separate processes for an end-to-end comparison.
`STEPS` and `SAMPLES` can override the defaults. The real-proof script compares
the currently built emitter with a version that omits only proof publication.
It temporarily replaces `out/tensor-kernel.js`, starts child processes, and
restores the file in `finally`. Do not run it alongside another process using
this checkout's compiled output. The paired kernel script now compares the
combined change against the baseline; its historical table above predates the
proof change.

This is a partial implementation of #474. Removing all real-value checks requires
additional safety proofs; a Number-based integer path requires exactness checks
or range proofs. Neither should be inferred from homogeneous storage alone.
