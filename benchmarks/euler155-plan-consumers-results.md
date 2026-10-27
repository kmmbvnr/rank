# Native integer-plan distinct consumers: Euler 155 follow-up

This follow-up builds on `b9199c29`, which already optimized compact integer
storage and the Euler 155 demo. It retains that demo's ordinary `Rec =`,
triangular equal-level enumeration, defaults and every existing assertion.
The new change connects guarded native integer arithmetic/concat plans directly
to collection consumers. It is a general runtime improvement, not a second
claim that the Euler 155 algorithm was replaced.

## What changed

- `unique` visits a checked native integer graph directly, retaining the first
  occurrence of each exact key and packing only representable result values.
- `unique len` retains keys without constructing a unique-result array.
- `unique sort` fills its private Int64 sorting buffer from a native graph,
  without first materializing each arithmetic/concat stage. Wider values decline
  this sorting specialization and retain exact ordinary sorting.
- Each demand owns private consumer state. A declined kernel discards partial
  state before ordinary traversal; repeated demands recompute their results.
  Unused plans, captures, ordinary completion boundaries, error progress,
  unsupported readers and cancellation retain their semantics.
- Native sorting still declines when cooperative interruption is installed.
  Ordinary `unique` is never silently reordered.

The existing `visitIntegerTensorMap` / `compileNativeTensorVisit` mechanism
supplies graph/domain proofs, native identity checks and guarded execution.
The stored Int32 fast path from `b9199c29` is retained.

## Compare the two implementations

Apple M5, macOS arm64, Node v24.15.0. Three serial fresh processes per case,
forward/reverse/forward order, full Count=18. All nine answers are **3857447**.
Each isolated runtime uses the same baseline modules except for its recorded
numeric-collection implementation and diagnostics property. The published
version is reconstructed from the exact `b9199c29` TypeScript module; that commit
changes no other production interpreter module. No tests, builds or profiles
ran concurrently with this comparison.

| Version | Median execution, s | Median whole-process peak RSS, MiB |
| --- | ---: | ---: |
| Published `b9199c29` | 5.036 | 832.08 |
| Independent plan-consumer + sorted-level prototype | 6.699 | 874.59 |
| Both runtime changes, triangular demo with deferred `Rec'` | 6.555 | 715.50 |

The published source is the speed winner. Combining the runtime improvements
and deferring `Rec` saves about 14% peak RSS but costs about 30% execution time
on this host. Therefore the final demo keeps **ordinary `Rec =`**. The runtime
can consume a deferred graph where a program explicitly chooses one; this does
not imply every explicit completion should be removed.

The earlier investigation and its different timing series are retained in
[the raw investigation](baselines/2026-10-27-euler155-investigation.json).
Its absolute times must not be compared across batches. An interrupted delivery
batch is not used to estimate the final merged performance.

## Final verification and measurements

The published demo source is identical in both final controls. Medians:

| Runtime | Default, s | Peak RSS, MiB |
| --- | ---: | ---: |
| published | 5.151 | 833.89 |
| merged | 5.018 | 828.47 |

The default timing ranges overlap; no additional default Euler 155 speedup is claimed.

| Deferred consumer, 400000 cells | Published, ms | Merged, ms | Speedup |
| --- | ---: | ---: | ---: |
| `unique` | 168.34 | 47.15 | 3.57x |
| `unique len` | 168.53 | 47.98 | 3.51x |
| `unique sort` | 171.24 | 48.82 | 3.51x |

The unchanged full default also returns **3857447** in reference mode (64.680 s, one separate validation, not a reference speedup estimate).

Build/test typecheck, semantic-boundary/application-form checks, **9033 ordinary tests**, **165 focused tests**, and both scoped type/differential fixture audits pass.

The dedicated plan workload consumes
`concat (Input mod 997) (Input mod 991)` for 200,000 input integers: 400,000
produced cells and 997 distinct values. Its timer includes parsing the consumer,
compiling and consuming the graph, but excludes interpreter/input setup and
post-timing validation. It is a duplicate-heavy collection benchmark, not a
prediction for arbitrary programs. Each output checks the count and, for arrays,
the sum and first/last values. Fresh processes and alternating version order are
used for each consumer. Diagnostics are collected separately.

The Euler timers include interpreter construction, parsing and full execution;
imports and subsequent validation are excluded. Whole-process peak RSS is sampled
before validation. It does not measure retained array storage or total allocations.

Verification includes 20 direct rational-oracle cases (Counts 1–10 in both
engines) and every existing fixture assertion, plus native-plan consumer tests
for stable order, empty/ranked inputs, ordinary snapshots, captured inputs,
repeated/unused demands, wide integers, late failure/fallback, opaque read order,
changed native implementations and cancellation without partial publication.
The oracle explicitly builds series and parallel fractions over all ordered
splits, without packed keys or reciprocal symmetry.

Full type/differential corpora and Nurikabe remain separate lanes. No existing
execution exclusions or repository deadlines change. A newly added fixture unit
check has an explicit 30-second limit because its Count=15 reference call exceeds
Vitest's default five seconds under parallel load.

## Reproduction

Build the selected runtime, then run each sample in a fresh process. Use an
independently built baseline checkout for `--runtime`.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler155-capacitors.mjs
node benchmarks/euler155-capacitors.mjs --runtime=/baseline/packages/interpreter/out/index.js
node benchmarks/integer-plan-distinct.mjs --consumer='unique len'
node benchmarks/integer-plan-distinct.mjs --consumer='unique sort'
node benchmarks/integer-plan-distinct.mjs --runtime=/baseline/packages/interpreter/out/index.js
node benchmarks/euler155-capacitors.mjs --count=15 --diag
```

[Final raw samples, source variants and verification](baselines/2026-10-27-euler155-plan-consumers.json).
