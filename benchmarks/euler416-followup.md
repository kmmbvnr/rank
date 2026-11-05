# Euler 416: general stored matrix multiplication

Baseline `200fcffb`, Node v24.15.0, 2026-11-06. This follows the
[initial investigation](euler416-investigation.md). The old approximately
20-second exclusion was already stale: the measured baseline is about 3.2 s
on Mac. We compare against that current baseline, not the old issue number.

## Implementation

The shared linear-algebra `numberMatmul` kernel now specializes canonical
stored rank-two products with at least two output rows and four columns.
The right operand is transposed into contiguous columns, and four independent
output sums reuse each left cell. The contraction order of each result is
unchanged, preserving real rounding. Existing integer-bound proofs remain
unchanged; unsafe bounds, mixed domains, other layouts/ranks and vector
products retain their existing paths. This helps ordinary execution and
compiled programs without recognizing any Euler-specific expression.

The transpose is local to one call and is never cached against mutable inputs.
Opaque atomic cancellation remains cooperative during transposition and the
four-output groups. Exact demand budgets, callback polling and inspection
retain the original kernel and its per-output work/error boundaries. Atomic
checks may occur slightly earlier within a four-output group; exact observable
budgets are not batched or charged for the private transpose.

The demo only skips its unused final matrix squaring; its weighted state
recurrence and compact split-integer `mm` helper are retained. The full main is
restored to corpus execution audits, alongside the small fixture. The new
full-result test runs both ordinary and compiled execution.

## Full default measurements

M=10, N=10^12; every answer is **898082747**. Three alternating before/after
pairs on each host, one fresh process per observation. Parsing is included,
imports excluded, phase logging disabled. Other machine load was not controlled.

| Host | Before seconds | After seconds | Median before → after |
| --- | --- | --- | --- |
| Mac arm64 | 3.179 / 3.205 / 3.225 | 1.513 / 1.511 / 1.524 | **3.205 → 1.513 s** |
| Intel Linux | 7.555 / 7.629 / 7.602 | 3.813 / 3.870 / 4.115 | **7.602 → 3.870 s** |

This is approximately **2.1x** faster on Mac and **2.0x** on Intel.

| Host | Before peak RSS range | After peak RSS range |
| --- | ---: | ---: |
| Mac | 264.9–269.6 MiB | 262.6–264.0 MiB |
| Intel | 245.1–246.8 MiB | 243.8–249.1 MiB |

There is no material peak-memory regression, but this is not a memory-saving
optimization. The temporary transpose adds up to one numeric right-operand
buffer per eligible call; real workloads outside these shapes can have a
different memory tradeoff. No global cache or retained operand is introduced.

Separate full reference probes are **1.556 s / 262.8 MiB** on Mac and
**4.001 s / 247.2 MiB** on Intel, also with the same full answer. This is
expected: the general native library kernel serves both execution modes.

## Verification

- 153 targeted tests across eight files pass, including integer bounds,
  permutations, explicit axes, matrix loops, interruption and full Euler 416.
- Seventeen new kernel cases cover signed integer/real scalar oracles,
  rectangular shapes, four-column tails, long contractions, stored
  permutations, accumulation order, Infinity/NaN/signed zero, exact demand
  costs, callback polling boundaries and atomic cancellation.
- Ten new demo tests include independent route/visited-mask enumeration for
  M=1..3, N=2..8, the published F(2,100) checkpoint and the full answer in
  both execution modes.
- Standalone validation passes 44 route checks and 36 integer/real product
  checks on each architecture.
- Scoped differential and inferred-type audits pass for both the restored
  full main and its fixture (two selected demos in each audit).
- Build/typecheck, semantic-boundary and application-form checks pass.
  No full suite or exhaustive corpus audit was run.

Raw observations and diagnostics:
[2026-11-06-euler416-delivery.json](baselines/2026-11-06-euler416-delivery.json).

## Reproduction

Build this checkout. Preserve an independent built `200fcffb` runtime and its
dependencies for the baseline. Then run:

```sh
RANK416_BASELINE=/path/to/baseline/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler416-delivery.mjs
node benchmarks/experiments/euler416-verify.mjs demos/euler/416_froggy.ra
RANK416_OUT=/path/to/delivery/packages/interpreter/out/ \
  node benchmarks/experiments/euler416-matmul-verify.mjs
```

The delivery runner alternates three original and three delivered full runs,
asserting their answers. Research-only kernel patch scripts remain controls;
the delivered source does not depend on modifying generated JavaScript.
