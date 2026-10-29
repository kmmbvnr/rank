# Typed tensor specialization (#474)

Homogeneous pointwise arithmetic now uses direct typed-buffer loops after proving
that every intermediate stays in its numeric domain. Cached interval proofs and
published result-type proofs remove repeated array scans. Float64, Int32 and
BigInt64 vector and matrix updates measured 9–13x faster in Rank loops than the
emitter at `9099399f` (which already includes destination reuse from #468).

The bounded path supports unary signs and binary addition, subtraction,
multiplication and division on equally shaped contiguous typed arrays and scalar
operands. It scans each new storage revision once, propagates conservative bounds
before writing, and attaches new bounds to the result. Mutations invalidate the
cache. Int32 uses Number registers only when every integer intermediate is exact;
BigInt64 retains BigInt registers. Real intermediates must remain finite, and
divisor intervals must exclude zero. Mixed arithmetic preserves exact integer
subexpressions and the distinction between integer zero and real negative zero.

The emitted loop has direct arithmetic and typed stores, without per-cell type,
finiteness or output-range checks. The implementation supports source and native
copy plans. Exclusive destinations reuse their buffers only after the proof;
aliases force allocation. Compilation observers trigger proof and ownership
revalidation. The general emitter also avoids reusing real storage without a
proof, preventing partial writes followed by a fallback that repeats an update.

Unsupported graphs, callbacks, strided or broadcast inputs, missing values,
unproved numeric ranges, interruption and demand-polling modes retain the general
path. Fresh integer outputs below 4,096 cells retain existing boxed storage.
This does not claim to optimize all reductions or establish SIMD generation.

## Measurements

Apple M5, Node v24.15.0; 50,000 cells, 500 updates per sample. Vector shape is
`[50000]`, matrix shape `[200, 250]`. The baseline and final emitter share the
same runtime/storage code, isolating the emitter change. Baseline is `9099399f`.
Five whole-program samples alternate fresh baseline/final processes; each timed
program contains a Rank loop. The raw-kernel comparison uses seven paired samples
in one process, 200 initial warmups and 20 warmups after each reset. Setup, reset
and result summation are outside the kernel timer. Two long-running differential
audit shards were still active during measurement; timings are not idle-machine
measurements. Pairing reduces drift but does not eliminate system noise.

| Storage | Shape | Rank program baseline ms | Final ms | Median paired speedup | Raw kernel speedup |
| --- | --- | ---: | ---: | ---: | ---: |
| Float64 | vector | 338.29 | 35.79 | 9.43x | 13.73x |
| Float64 | matrix | 324.11 | 28.32 | 11.43x | 13.60x |
| Int32 | vector | 445.67 | 36.74 | 12.25x | 14.69x |
| Int32 | matrix | 448.39 | 35.21 | 12.76x | 13.89x |
| BigInt64 | vector | 286.36 | 31.11 | 9.29x | 11.31x |
| BigInt64 | matrix | 285.94 | 31.15 | 9.25x | 11.67x |

Times are separate medians; speedups are medians of paired ratios. All baseline
and final sums agree. Each timed sample reuses the buffer 500 times and performs
zero repeated range scans. Raw results and generated sources are preserved in
`baselines/2026-10-29-bounded-tensor-kernels.json` and whole-program results in
`baselines/2026-10-29-bounded-tensor-programs.json`.

Against the intermediate implementation `9dfe7784`, the additional bounded path
improves raw Float64 kernels by 4.66–4.67x, Int32 by 14.07–14.21x, and BigInt64 by
11.17–11.56x. See `baselines/2026-10-29-bounded-tensor-incremental.json`.

Earlier experiments found that removing primitive dispatch alone gave only
about 0–4%, while publishing completed real-result type proofs gave 2.8–2.9x
in Rank loops. Those historical measurements remain in
`baselines/2026-10-29-typed-tensor-specialization.json` and
`baselines/2026-10-29-tensor-real-proof.json`. A profile identified repeated
`storedScalarKinds` scans as a substantial assignment cost. Homogeneous storage
alone was not sufficient to remove arithmetic safety checks.

## Verification

The final TypeScript build, semantic-boundary checks and application-form checks
pass. The final focused run passes 1,047 tensor, binding, storage, mutation,
shape and return-contract tests across 38 files. This includes 28 bounded-kernel
cases covering all three buffer types, widening, exact wide intermediates,
nonfinite values, division by zero, atomic fallback, aliases, scalar changes,
mutation invalidation, signed zero and compilation-observer mutations.

The ordinary interpreter run passed 9,335 tests and hit 16 timeouts while heavy
audit shards were running. All affected cases passed on subsequent narrower
runs, including the last two Euler cases within their original 15-second limits.
The common package passed all 448 tests. The preceding implementation also passed
65 language test files, the eight-shard type audit (1,441 demos / 4,766 names),
11 compile-package tests (two optional Rust tests skipped), Nurikabe's six tests
and the Euler 001–015 CLI fixtures.

The full workspace audit is not green: the differential audit reports timeouts
and Euler 298/502 failures. Both substantive failures were reproduced unchanged
at pre-#474 main `228a0633`; they are independent of this optimization. The full
audit was run on `9dfe7784`, while final code received the focused and ordinary
checks above. These results do not constitute a clean full-workspace run.

## Reproduction

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run langium:generate
npx tsc -b tsconfig.build.json
BASELINE=9099399f node --expose-gc benchmarks/experiments/typed-tensor-paired.mjs
BASELINE=9dfe7784 node --expose-gc benchmarks/experiments/typed-tensor-paired.mjs
BASELINE=9099399f node benchmarks/experiments/typed-tensor-program-comparison.mjs
```

`STEPS` and `SAMPLES` override defaults. The paired runner transpiles the baseline
emitter into a temporary module alongside compiled output. The whole-program
runner temporarily replaces `out/tensor-kernel.js`, launches child processes,
and restores it in `finally`; do not run it concurrently with programs using
that checkout's compiled output. It verifies equal sums, buffer reuse and absence
of repeated range scans. Source files are not replaced.
