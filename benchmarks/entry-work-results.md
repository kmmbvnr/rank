# Shared region entry-work proofs

Baseline: `5bb084a2`. Candidate runtime source SHA-256 (sorted relative `.ts`
paths under `packages/interpreter/src`, NUL separator, then file bytes):
`026186516fc27520c057174cc4a2c3452acbdca30da8978cde8bdf52b06fc634`.

Condition-loop and packed-vector admission now use one prepared block model.
It composes sequential passes, selected branches, slice stores and invariant
nested repetitions. Scalar writes invalidate bounds; loop-carried values are
removed before proving repeated work. No array cells or callbacks are evaluated
by the block model. The vector adapter retains its bounded first/two/last native
cell samples and alias checks. Unknown control/effects stop the proof.

The 64-cell allowance, 262144-cell probe cap, feedback and all semantic guards
remain. An estimate cannot grant Number precision or mutation permission.
Demand budgets bypass the additional work-based admission proof: newly admitted
private preparation must not change the exact publishing path's partial state.
Reference and compiled budget units already differ; they are not compared as if
they represented the same number of user statements.

## Measurements

Node v24.15.0 on Apple M5 and Intel i7-10750H. Three serial fresh processes per
case, engine and revision, alternating revision order. Execution includes initial
preparation/compilation, excluding parsing and startup. Diagnostics are disabled
for timed observations and run separately. Peak RSS includes the entire process;
retained heap/buffer totals are also recorded after GC. This is not cumulative
allocation accounting. Tests and builds completed before each host's timing run;
other system load was not controlled. Both revisions run identical programs and
check independent exact totals. Scalar-entry compilation is disabled to isolate
loop regions. No demo or algorithm was rewritten.

- `work-nested`: three complete updates of a 262200-cell array through locally
  defined row/column bounds. Entry work now multiplies invariant nested passes.
- `work-branch`: known conditional with two complementary strided stores.
- `work-passes`: two plain strided loops, controlling the existing admission.
- `work-short`: 5000 short calls over a 128-cell store, controlling feedback.

Compiled medians:

| Host | Case | Before ms | After ms | Peak RSS MiB, before / after |
| --- | --- | ---: | ---: | ---: |
| Mac | nested | 112.62 | 22.02 | 187.9 / 156.3 |
| Intel | nested | 289.85 | 46.57 | 175.7 / 142.9 |
| Mac | branch | 17.74 | 17.36 | 156.5 / 156.0 |
| Intel | branch | 38.83 | 35.20 | 140.6 / 140.9 |
| Mac | passes | 19.19 | 19.80 | 155.9 / 156.1 |
| Intel | passes | 40.35 | 46.28 | 142.3 / 135.5 |
| Mac | short | 45.48 | 44.13 | 179.8 / 179.9 |
| Intel | short | 145.85 | 147.16 | 163.8 / 165.4 |

The new nested case improves about 5.1x / 6.2x with lower peak RSS. The branch
case gains compilation coverage but little speed because its slices already
use bulk runtime operations. Reference does not use this compiler admission:
its nested medians are 284.97 / 281.99 ms on Mac and 738.12 / 734.35 ms on Intel;
no reference speedup is claimed.

The first Intel passes median suggested a 15% regression. A separate five-sample
alternating control series checks this concern; the original series is retained:

| Host | Control | Before ms | After ms | Candidate / baseline |
| --- | --- | ---: | ---: | ---: |
| Mac | passes | 19.19 | 19.81 | 1.032 |
| Intel | passes | 40.66 | 39.98 | 0.983 |
| Mac | short | 44.02 | 43.95 | 0.998 |
| Intel | short | 144.64 | 147.93 | 1.023 |

The large Intel regression did not reproduce. Small cold-execution overhead
remains visible on some controls; this is not a universal performance win.
Diagnostics show one Number region instead of zero in nested/branch cases;
plain passes retain one region, short calls retain one copy probe. Full compiled
Euler 388 also retains its golden answer in both revisions: one Mac smoke run
per revision, 495.8 / 497.9 ms, 279.7 / 278.9 MiB. Those are validation samples,
not performance medians.

## Verification

- TypeScript source/test build, 11 semantic-boundary tests, 65 semantic owners,
  and both application-form checks pass.
- Mac: 211 tests across six targeted files; after the final conservative
  unknown-statement handling, 79 relevant tests pass again.
- Intel: the same 79 admission/replay/alias/budget tests pass.
- New cases compare final state with reference and exact compiled execution,
  and independently check totals. They cover local bounds, selected branches,
  nested work, changing back-edge bounds, array-derived unknowns, wide overflow,
  error publication, aliases and budgeted partial state.
- Full suites and exhaustive corpus audits were not run.

This step does not add interprocedural memory-effect proofs, array-rotation
ownership, or per-definition numeric range propagation. Those remain separate
work; the estimate is deliberately conservative when their facts are absent.

## Reproduce

Build both checkouts. From the candidate:

```sh
node benchmarks/general-runtime.mjs --baseline=/path/to/baseline --cases=work-nested,work-branch,work-passes,work-short
node benchmarks/general-runtime.mjs --baseline=/path/to/baseline --cases=work-passes,work-short --engines=compiled --samples=5
```

Raw series: [Mac](baselines/2026-11-04-entry-work-mac.json),
[Intel](baselines/2026-11-04-entry-work-intel.json),
[Mac controls](baselines/2026-11-04-entry-work-mac-controls.json),
[Intel controls](baselines/2026-11-04-entry-work-intel-controls.json).
