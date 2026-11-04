# Parallel array moves in numeric regions

Baseline: `bb8b6bc5`. Candidate runtime source SHA-256 (sorted relative `.ts`
paths under `packages/interpreter/src`, NUL separator, then file bytes):
`10dfea254ba3d6b310857c0173ce40c0f3574cce3db0489f77e56adc75ed6231`.

A complete, duplicate-free `unpack` permutation now moves private array handles
in parallel. It supports any permutation length, integer or real cells, and
changing dimensions within a fixed rank. Every entry buffer connected to a
written binding gets its own private snapshot, including a source that becomes
writable only after a move. Ordinary alias guards remain in force. Shape caches
refresh after moves; the bounds analysis sees unpack targets as rebound names.

The final tuple is published through the ordinary tuple constructor, preserving
copy-on-write for later statements. Overflow discards all private changes before
exact replay; ordinary errors publish completed writes and bindings. The region
cannot contain escaping control, calls or callouts that could expose an earlier
iteration result. Demand budgets retain the existing exact path. This is a
parallel-move proof, not a general ownership or last-use analysis: sequential
aliases, duplicate tuple operands, slice stores through rebound inputs and
mixed wide-scalar/rebound-input regions retain their previous fallback.

## Measurements

Node v24.15.0, Apple M5 and Intel i7-10750H. Same program and independent BigInt
oracle in both revisions; no demo rewrite. Scalar-entry compilation is disabled.
Three alternating fresh processes per revision for small cases and controls,
five for the large case. Parsing/startup excluded, compilation and execution
included. Diagnostics are collected separately from timing. Each host's tests
finish before timing; other system load is not controlled. RSS covers the whole
process. Post-GC heap and buffers are recorded separately from cumulative buffer
allocation counters.

Thirty-two recurrence passes, two or three rotating buffers. Small arrays have
32768 cells; the large two-buffer case has 524288 cells.

| Case | Host | Baseline ms | Candidate ms | Speedup | Peak RSS MiB, before → after |
| --- | --- | ---: | ---: | ---: | ---: |
| Two buffers | Mac | 23.04 | 19.28 | 1.19× | 146.75 → 156.28 |
| Three buffers | Mac | 23.62 | 19.84 | 1.19× | 160.44 → 156.08 |
| Large buffers | Mac | 160.40 | 67.61 | 2.37× | 240.80 → 161.00 |
| Existing strided passes | Mac | 20.07 | 20.61 | 0.97× | 155.17 → 155.64 |
| Two buffers | Intel | 58.27 | 43.18 | 1.35× | 144.16 → 137.55 |
| Three buffers | Intel | 57.93 | 44.28 | 1.31× | 145.33 → 139.59 |
| Large buffers | Intel | 367.80 | 150.17 | 2.45× | 237.57 → 146.51 |
| Existing strided passes | Intel | 39.97 | 40.47 | 0.99× | 135.41 → 135.08 |

The large case enters one numeric region instead of 32. Snapshot copies fall
from 64 MiB to 4 MiB, and dirty-mask allocations from 16 MiB to 1 MiB. Retained
buffers after GC are unchanged: this removes intermediate allocations. The
small Mac two-buffer case has higher RSS despite lower cumulative copying;
there is no claim of a universal RSS reduction. The control is 1–3% slower in
this short series. The reference engine has no new execution path in this step:
Mac two-buffer median is 690.16 → 693.38 ms, with the same 172.92 MiB peak RSS.

## Verification and reproduction

Build and semantic-boundary/application-form checks pass. The same eight focused
files pass on both hosts: 516 tests, including 19 transfer tests. Cases cover
three-way permutations, different shapes and lengths, local allocations, entry
aliases, real cells, Int32 widening, exact overflow replay, errors before/after
moves, final tuple snapshots, empty/conditional loops, unsafe-alias fallback,
demand budgets, cancellation and cached re-entry. Exhaustive audits were not run.

```sh
node benchmarks/general-runtime.mjs --baseline=/path/to/baseline --cases=move-2,move-3,work-passes --engines=compiled
node benchmarks/general-runtime.mjs --baseline=/path/to/baseline --cases=move-large --engines=compiled --samples=5
node benchmarks/general-runtime.mjs --baseline=/path/to/baseline --cases=move-2 --engines=reference
```

Raw series: [Mac](baselines/2026-11-04-array-transfer-mac.json),
[Intel](baselines/2026-11-04-array-transfer-intel.json),
[Mac large](baselines/2026-11-04-array-transfer-mac-large.json),
[Intel large](baselines/2026-11-04-array-transfer-intel-large.json),
[reference control](baselines/2026-11-04-array-transfer-mac-reference.json).
