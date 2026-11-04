# Execution-cost diagnostics (#509)

Baseline: `0e6cb9a9`. Candidate: this change. Node v24.15.0 on both hosts.
Candidate interpreter source SHA-256: `99740cc892edd2bf1e9b67c3e9f69784d3e0c103ecd9602e8250145ced022bb8`.

Five fresh processes per workload, engine and diagnostic mode; version order
alternates between samples. Both engines run the same six non-Euler programs.
The harness validates exact answers. Parsing and process startup are excluded
from elapsed execution time; compilation and runtime preparation are included.
No exhaustive audits were run. These short cold runs measure execution including initial compilation, not steady-state throughput or a universal overhead bound.

## Time

Ratios use medians. Off/baseline measures disabled-mode overhead; on/off measures
instrumentation overhead. Ratios below one are not evidence of a speedup.

| Workload / engine | Mac off (ms) | Mac off/base | Mac on/off | Intel off (ms) | Intel off/base | Intel on/off |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scalar/reference | 8.48 | 0.991 | 1.017 | 21.09 | 1.012 | 0.967 |
| scalar/compiled | 7.38 | 1.027 | 1.022 | 16.17 | 1.024 | 0.992 |
| dense/reference | 12.91 | 1.003 | 0.991 | 32.60 | 0.997 | 1.139 |
| dense/compiled | 10.22 | 1.030 | 0.992 | 22.55 | 1.018 | 1.015 |
| sparse/reference | 5.49 | 0.984 | 1.016 | 13.27 | 1.018 | 0.983 |
| sparse/compiled | 10.13 | 1.004 | 1.042 | 22.13 | 0.986 | 1.047 |
| grouped/reference | 5.10 | 0.988 | 1.031 | 11.81 | 0.986 | 1.010 |
| grouped/compiled | 5.25 | 0.975 | 1.068 | 12.07 | 0.997 | 1.003 |
| container/reference | 16.68 | 0.970 | 0.999 | 45.83 | 0.989 | 0.949 |
| container/compiled | 9.57 | 1.022 | 1.016 | 21.04 | 1.021 | 1.015 |
| replay/reference | 4.25 | 0.963 | 1.027 | 10.32 | 0.994 | 1.050 |
| replay/compiled | 9.76 | 1.005 | 1.028 | 21.77 | 0.987 | 1.023 |

Disabled ratios range from 0.963 to 1.030 on Mac and 0.986 to 1.024 on Intel.
Enabled ratios reach 1.068 on Mac and 1.139 on Intel. Keep diagnostics opt-in
and compare performance with the collector disabled.

## Memory

Medians for candidate-on. RSS is the peak for the whole child process, including
parsing and JIT. Heap and ArrayBuffer deltas subtract a post-parse GC baseline
from a post-execution GC observation with runtime bindings still reachable.
These are process measurements, not an isolated live-object graph. Cumulative
buffer allocation/copy counters are a different quantity and are not added here.

| Workload / engine | Mac peak RSS MiB | Mac retained heap delta KiB | Mac retained buffers delta KiB | Intel peak RSS MiB | Intel retained heap delta KiB | Intel retained buffers delta KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scalar/reference | 163.7 | 538.1 | 0.0 | 139.8 | 519.7 | 0.0 |
| scalar/compiled | 163.5 | 617.7 | 0.0 | 137.1 | 606.6 | 0.0 |
| dense/reference | 166.9 | 651.2 | 46.9 | 140.5 | 648.6 | 46.9 |
| dense/compiled | 165.8 | 822.2 | 46.9 | 138.7 | 809.1 | 46.9 |
| sparse/reference | 168.7 | 549.5 | 78.1 | 138.5 | 535.2 | 78.1 |
| sparse/compiled | 168.2 | 842.2 | 78.1 | 138.8 | 825.7 | 78.1 |
| grouped/reference | 163.5 | 380.6 | 93.8 | 138.0 | 374.3 | 93.8 |
| grouped/compiled | 162.6 | 464.6 | 93.8 | 136.6 | 457.6 | 93.8 |
| container/reference | 170.2 | 750.2 | 2.0 | 140.3 | 727.5 | 2.0 |
| container/compiled | 169.3 | 782.9 | 2.0 | 138.5 | 784.5 | 2.0 |
| replay/reference | 165.3 | 368.2 | 0.0 | 138.2 | 364.1 | 0.0 |
| replay/compiled | 166.5 | 937.1 | 0.0 | 130.2 | 917.2 | 0.0 |

## What the counters explain

- Dense compiled writes copy 48,000 payload bytes and allocate 12,000 dirty-mask bytes.
- Sparse compiled writes make an initial 80,000-byte copy and a 20,000-byte mask for 120 updates. The existing one-probe policy is observable; it is unchanged.
- The 128-cell Fenwick workload copies 2,056 bytes for values and tree nodes.
- The replay control records one discarded Number attempt before a successful mixed/exact execution. It reports discarded time without adding iteration instrumentation.
- Grouped folds expose their shared-kernel time in either engine. The report does not assign guessed byte sizes to their JS arrays.

## Verification

- TypeScript project build passed.
- 465 targeted interpreter tests passed across 11 files on Mac.
- 96 targeted tests passed on Intel: execution costs, runtime diagnostics and numeric Fenwick.
- Semantic-boundary checks (11 tests, 65 owners) and application-form checks passed.
- New tests compare diagnostic-on/off results, partial state, first error, cancellation and demand budgets in both engines; check scoped timing and exact typed-copy byte accounting.
- Full suites and exhaustive audits were not run.

```sh
node benchmarks/execution-cost.mjs --baseline=/path/to/built/baseline --samples=5
```

[Counter scope](../docs/design/runtime-diagnostics.md#fallback-categories-and-execution-costs)
and raw [Mac](baselines/2026-11-04-execution-cost-mac.json) / [Intel](baselines/2026-11-04-execution-cost-intel.json) observations.
