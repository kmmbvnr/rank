# Numeric representation and container contracts (#510)

Baseline: `58acbe2b`; candidate implementation: `cc12d47a`. Both include the parallel Euler 386 changes. Node 24.15.0 on both hosts.

The harness runs identical programs and algorithms in both checkouts, in fresh processes with five alternating samples per engine and diagnostic mode. Parsing and process startup are excluded; initial compilation and runtime preparation are included. This measures cold execution, not steady-state throughput.

## Time

| Workload / engine | Mac baseline ms | Mac candidate ms | Ratio | Intel baseline ms | Intel candidate ms | Ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scalar/reference | 12.11 | 12.36 | 1.021 | 20.74 | 21.91 | 1.056 |
| scalar/compiled | 12.13 | 12.26 | 1.011 | 17.59 | 16.92 | 0.962 |
| dense/reference | 18.13 | 18.43 | 1.017 | 34.30 | 34.54 | 1.007 |
| dense/compiled | 14.92 | 14.71 | 0.986 | 24.38 | 23.64 | 0.970 |
| index/reference | 31.30 | 31.23 | 0.998 | 65.45 | 64.70 | 0.989 |
| index/compiled | 14.91 | 13.79 | 0.925 | 21.19 | 21.95 | 1.036 |
| container/reference | 24.71 | 24.60 | 0.996 | 48.02 | 47.97 | 0.999 |
| container/compiled | 15.63 | 15.46 | 0.990 | 22.13 | 21.95 | 0.992 |
| composed-container/reference | 79.46 | 75.39 | 0.949 | 180.37 | 188.55 | 1.045 |
| composed-container/compiled | 23.59 | 23.66 | 1.003 | 38.51 | 39.14 | 1.016 |
| mixed-container/reference | 76.98 | 75.16 | 0.976 | 173.30 | 197.66 | 1.141 |
| mixed-container/compiled | 33.00 | 33.60 | 1.018 | 56.22 | 57.08 | 1.015 |
| mixed-composed/reference | 80.57 | 80.52 | 0.999 | 165.94 | 167.75 | 1.011 |
| mixed-composed/compiled | 27.30 | 27.46 | 1.006 | 41.56 | 39.42 | 0.948 |
| empty-replay/reference | 54.00 | 58.99 | 1.092 | 116.64 | 115.69 | 0.992 |
| empty-replay/compiled | 22.35 | 22.70 | 1.015 | 37.15 | 38.00 | 1.023 |
| overlay-replay/reference | 61.10 | 52.29 | 0.856 | 116.83 | 115.95 | 0.992 |
| overlay-replay/compiled | 22.88 | 22.74 | 0.994 | 38.81 | 37.47 | 0.965 |

Ratios compare medians with diagnostics disabled. Values below one are not evidence of a speedup. This is a contract refactor; the controls do not establish a universal performance or memory improvement.

## Memory

Candidate-off medians. RSS is peak process memory; retained deltas compare post-execution GC with post-parse GC while runtime bindings remain reachable. These process totals include engine state and cannot isolate Rank live objects or cumulative allocations.

| Workload / engine | Mac peak RSS MiB | Mac heap delta KiB | Mac buffers delta KiB | Intel peak RSS MiB | Intel heap delta KiB | Intel buffers delta KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scalar/reference | 146.1 | 544.1 | 0.0 | 131.0 | 509.6 | 0.0 |
| scalar/compiled | 146.0 | 612.1 | 0.0 | 130.9 | 601.3 | 0.0 |
| dense/reference | 154.2 | 645.1 | 46.9 | 130.9 | 644.3 | 46.9 |
| dense/compiled | 147.8 | 813.1 | 46.9 | 130.9 | 800.1 | 46.9 |
| index/reference | 164.1 | 1672.9 | 0.0 | 146.1 | 1638.1 | 0.0 |
| index/compiled | 149.4 | 1504.1 | 0.0 | 131.0 | 1493.4 | 0.0 |
| container/reference | 165.9 | 744.8 | 2.0 | 147.5 | 728.4 | 2.0 |
| container/compiled | 150.4 | 772.8 | 2.0 | 130.8 | 784.4 | 2.0 |
| composed-container/reference | 174.3 | 1366.3 | 2.5 | 159.7 | 1245.6 | 2.5 |
| composed-container/compiled | 157.9 | 1515.0 | 2.5 | 138.5 | 1450.4 | 2.5 |
| mixed-container/reference | 174.9 | 1375.0 | 2.5 | 160.8 | 1320.4 | 2.5 |
| mixed-container/compiled | 158.8 | 1605.0 | 2.5 | 140.6 | 1497.0 | 2.5 |
| mixed-composed/reference | 174.2 | 1356.5 | 2.5 | 160.3 | 1325.6 | 2.5 |
| mixed-composed/compiled | 156.5 | 1566.3 | 2.5 | 135.8 | 1532.2 | 2.5 |
| empty-replay/reference | 173.1 | 1170.6 | 2.5 | 158.3 | 1138.7 | 2.5 |
| empty-replay/compiled | 156.2 | 1408.0 | 2.5 | 136.2 | 1451.3 | 2.5 |
| overlay-replay/reference | 173.9 | 1163.5 | 2.5 | 159.1 | 1063.8 | 2.5 |
| overlay-replay/compiled | 157.8 | 1576.3 | 2.5 | 137.8 | 1529.8 | 2.5 |

## Composition and limits

- `composed-container` combines numeric array stores, index overlays, aliased Fenwick trees and audited scalar calls in one Number region.
- `mixed-composed` keeps the accumulator in BigInt while the array, index and Fenwick operations stay numeric; the scalar native call runs in a separate numeric assignment.
- `mixed-container` intentionally puts that native call inside the wide accumulator expression. It retains exact execution and reports `number-loop:call-number-result-proof`. The call slot lacks a proof relating its exact result representation to its consuming register.
- Rank helpers beside private containers retain exact execution with `number-loop:call-private-state-proof`; scalar arguments alone do not rule out observing captured state.
- Both replay controls discard one Number attempt before mixed/exact replay. Empty-index rollback and nonempty-index overlays preserve the same final answers.
- The common contract deduplicates aliases before calculating copy work. It retains the existing copy thresholds, snapshot sizes, ordinary-error publication and speculative rollback behavior. Concrete hot accesses remain specialized.

## Verification

- TypeScript project build passed on Mac and Intel.
- 490 targeted tests across 12 files passed on Mac, including the parallel scalar-sequence changes; 139 targeted tests across six files passed on Intel.
- Semantic-boundary checks (11 tests, 65 owners) and application-form checks passed.
- Tests cover Int32 and safe-Number boundaries, wide registers, arrays plus aliased containers and native calls, native guards, readonly errors, operand order, ordinary errors, cancellation, demand budgets, and rollback before replay.
- The requested admission-proof reminder lives beside `prepareNumberLoop`.
- Full suites and exhaustive audits were not run.

```sh
node benchmarks/execution-cost.mjs --baseline=/path/to/built/main --samples=5 --cases=scalar,dense,index,container,composed-container,mixed-container,mixed-composed,empty-replay,overlay-replay
```

Raw observations: [Mac](baselines/2026-11-04-container-contract-mac.json) and [Intel](baselines/2026-11-04-container-contract-intel.json). Counter definitions and exclusions remain in [runtime diagnostics](../docs/design/runtime-diagnostics.md).
