# Euler 417: smaller order tables and compiled numerical helpers

Baseline `43e4ecfb`, Node v24.15.0, 2026-11-06. This completes the
[initial investigation](euler417-investigation.md). The old approximately
44-second exclusion is not the measured baseline of this checkout.

## Delivered changes

The demo keeps the multiplicative-order algorithm. Both tables use odd
indices; even factors of p-1 are handled explicitly. Zero factor entries denote
primes. The order table is local to an ordinary function, allowing existing
ownership handling to avoid its entry snapshot and dirty bitmap. Smooth
multipliers are constructed with array operations. A monotone boundary replaces
per-denominator binary searches. Native `lcm` replaces a handwritten gcd loop.
Small numerical functions give every function at most one loop, with no nested
source loops; the main loop tests a cached boundary before calling its updater.

The compiler now supports reverse traversal of finite bounded prime plans.
Traversal normalization preserves the reverse expression; loop generation
checks both native bindings, snapshots bounds, consumes the finite values before
the first body iteration, and walks them in reverse order. Unbounded and
unsupported plans retain ordinary errors. Entry guards keep budget, inspection
and cancellation observations on the existing ordinary reverse path, including
a cached function reused under guards.

Scalar Number functions now support integer `powmod` for safe inputs,
nonnegative exponents and positive moduli up to 2^30. Other domains replay exact
execution, preserving native errors and preceding writes. This allows short
order/lifting functions to retain Number execution. Demand budgets, callback
polling and inspection keep ordinary native calls; opaque atomic cancellation
uses the same safe modular-power checks. Private leaf calls with three/four
parameters get fixed-arity entries. Nested private leaves can reuse those
entries, retaining hooks, live binding checks and the call-depth limit.

No new public language operation or enlarged factorization cache is introduced.

## Full default measurements

N=100000000, answer **446572970925740** in every full observation. Three
alternating fresh-process pairs on each host, parsing included and phase logging
disabled. Other host load was not controlled. Diagnostics are enabled in these
pairs; an additional uninstrumented control is reported below.

| Host | Before seconds | Delivered seconds | Median before → after |
| --- | --- | --- | --- |
| mac | 8.415 / 8.340 / 9.591 | 6.312 / 7.250 / 6.269 | **8.415 → 6.312 s** |
| intel | 24.866 / 23.703 / 24.895 | 17.270 / 17.758 / 17.996 | **24.866 → 17.758 s** |

| Host | Before peak RSS range | Delivered peak RSS range |
| --- | ---: | ---: |
| Mac arm64 | 2386.1–2885.7 MiB | 609.0–609.3 MiB |
| Intel Linux | 1633.5–1634.6 MiB | 593.2–593.8 MiB |

The delivered median is about **1.3x faster on Mac** and **1.4x on Intel**.
Baseline RSS varies considerably with GC; table dimensions and concrete
snapshot/dirty allocation removal are more useful evidence than a precise RSS
ratio. Both main loops enter Number mode without overflow.

Separate single probes with diagnostics disabled also agree:
Mac **8.190 → 6.144 s**, Intel **24.514 → 17.977 s**. Their peaks are
2886.0 → 608.9 MiB and 1633.6 → 594.0 MiB respectively. These are controls,
not additional samples in the paired medians.

The earlier inline research candidate was faster on Mac (median 5.945 s), but
used nested loops. The delivered functions follow Rank style and add general
compiler support; compare the actual delivery measurements rather than quoting
that candidate as the delivered result.

## Reference execution tradeoff

At N=1000000, both reference probes agree at **55535191115**, but the
short-function version is slower: **4.058 → 7.736 s**, with peaks
**204.9 → 617.5 MiB** (single Mac probes, not controlled pairs). Its numerous
interpreted helper calls add allocation and dispatch overhead. Thus the
full-input compiled memory/speed gain is not a claim that every execution
mode improves. The full default reference run remains excluded; its small
fixture remains in audits.

A conservative scalar-frame reuse experiment gave 7.037 s / 613.6 MiB on this
reference case. It did not materially reduce peak memory, and is not shipped.
Reducing reference helper-call allocation remains a follow-up; no new issue is
created by this change.

## Verification

- Initial verification passes 260 targeted tests across 11 files. After
  integration with main at `c021d70d`, 421 tests across 13 files pass,
  including the parallel modular callback scan changes and the full compiled answer,
  scalar kernels, borrowed arrays, declared calls, array traversal/ranges and
  range writes. New tests cover reverse order/ordinals and finite bounds,
  binding guards, break, domain errors, guarded cached execution, modular
  domains, unsafe values, caller writes/replay, hooks and call-depth limits.
- The delivered demo matches an independent long-division oracle through
  selected bounds 0..1000 on both numeric backends and the interpreter, plus
  the published million checkpoint and the full compiled golden.
- The standalone verifier passes 517 checks on each architecture across 11
  source variants, reference/compiled small cases, and compiled million
  checkpoints. Full answers and memory are measured separately.
- Scoped differential and inferred-type audits pass for the existing test
  fixture. The default full reference exclusion remains deliberate.
- Build/typecheck, semantic-boundary and application-form checks pass.
  No full suite or exhaustive corpus audit was run.

Raw measurements: [delivery JSON](baselines/2026-11-06-euler417-delivery.json).

## Reproduction

Build the delivery and preserve a separately built `43e4ecfb` runtime with its
dependencies for before measurements:

```sh
RANK417_BASELINE=/path/to/baseline/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler417-delivery.mjs
node benchmarks/experiments/euler417-verify.mjs
RANK417_DIAGNOSTICS=0 node benchmarks/experiments/euler417-run.mjs compiled \
  100000000 demos/euler/417_reciprocalcycles.ra
```
