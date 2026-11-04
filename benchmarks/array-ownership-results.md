# Private ownership for ordinary array assignments

Baseline: `76a5a3d2`. Candidate runtime source SHA-256 (sorted relative `.ts`
paths under `packages/interpreter/src`, NUL separator, then file bytes):
`05a2448f10b70edc28e59c0f1b952b7ce26618ebe1eb2fe495f47151fa3662e9`.

Ordinary aliases now have separate private array handles sharing a counted
buffer owner. A write detaches only if another binding still owns the old
buffer. Replacing a binding releases its old owner. Publishing shared handles
returns the same public RankArray so ordinary copy-on-write still protects
later statements. Rebound buffers publish through their binding and no longer
allocate an unused per-cell dirty mask.

This applies to assignment chains, conditional bindings, scalar writes through
either alias, different shapes of the same rank, and aliases mixed with parallel
unpack moves. It does not introduce another swap syntax. The sequential swap
benchmark uses the existing code:

```rank
Temp = A
A = B
B = Temp
```

A still-live `Temp` preserves its prior contents when `B` is written. Those
copies remain necessary under the current binding-lifetime model. A separate
benchmark uses `C = A; C = B` before writing `A`: the old owner is released and
no alias copy is made. This is ownership across binding replacements, not a
proof that every value becomes dead immediately after its last read.

The compiler connects named aliases and parallel moves to written array
bindings, prepares private entry snapshots and tracks publication for the whole
component. Unknown callbacks, calls, escaping control, pooled vector stages,
shared slice stores and mixed wide-scalar/rebound-input regions retain fallback.
Regions without direct name assignments omit the ownership instructions. Runtime contracts
and entry guards still decide whether an invocation can enter the private path.

## Measurement method

Node v24.15.0 on Apple M5 and Intel i7-10750H. Five alternating fresh processes
per case and revision, diagnostics off, followed by a separate diagnostic run.
Execution includes preparation and compilation; parsing/startup are excluded.
Tests finish before timing on each host; other system load is not controlled.
Peak RSS covers the whole process; post-GC heap and buffers are recorded too.
Buffer-copy counters measure cumulative payload, not retained memory.
Scalar-entry compilation is disabled. Both revisions run the same program and
check the same independent exact total. Reference execution is unchanged.

- `alias-2`: 32 sequential swaps of two 32768-cell arrays, with a full update
  before each swap.
- `alias-large`: the same program with 524288 cells per array.
- `alias-release`: 32 full updates of a 524288-cell array after overwriting
  its alias with another array binding.
- `move-large`: the prior parallel-unpack path, as a control.
- `work-passes`: existing strided stores without aliases, as a control.

| Case | Host | Baseline ms | Candidate ms | Speedup | Peak RSS MiB, before → after |
| --- | --- | ---: | ---: | ---: | ---: |
| alias-2 | Mac | 23.22 | 23.52 | 0.99× | 160.34 → 155.77 |
| alias-large | Mac | 143.10 | 108.14 | 1.32× | 231.22 → 220.08 |
| alias-release | Mac | 112.00 | 64.40 | 1.74× | 253.36 → 159.12 |
| move-large | Mac | 63.47 | 62.56 | 1.01× | 160.02 → 161.09 |
| work-passes | Mac | 20.37 | 20.14 | 1.01× | 155.47 → 156.02 |
| alias-2 | Intel | 57.05 | 52.52 | 1.09× | 142.94 → 141.08 |
| alias-large | Intel | 362.92 | 269.52 | 1.35× | 212.49 → 202.70 |
| alias-release | Intel | 263.53 | 130.98 | 2.01× | 216.45 → 141.60 |
| move-large | Intel | 152.69 | 151.33 | 1.01× | 146.45 → 146.54 |
| work-passes | Intel | 40.47 | 40.89 | 0.99× | 135.21 → 135.90 |

In `alias-large`, snapshot copying falls from 64 MiB to 4 MiB. The 62 MiB of
copies preserving live aliases remain: total measured payload falls from
126 MiB to 66 MiB. In `alias-release`, 64 MiB of numeric snapshots plus 64 MiB
of public COW copies become 4 MiB of entry snapshots, with no private alias
copies. Both newly admitted programs run one numeric region instead of 32.
The small sequential-swap case has no dependable speedup.

An earlier implementation emitted ownership checks even for non-alias regions.
Five-sample controls showed roughly 3–5% overhead on Mac. The final version
omits that instrumentation when the source has no direct name assignments.
The pre-elision measurements are retained separately and do not describe the
final source hash.

## Verification and reproduction

Build and semantic-boundary/application-form checks pass. The same eight focused
files pass on Mac and Intel: 528 tests, including 31 array-transfer/ownership
cases. New cases cover retained temporary values, chained and overwritten
aliases, real cells, Int32 widening, conditional moves, multidimensional arrays,
exact overflow replay, partial error state, final result snapshots, cancellation
and demand budgets. A nested budgeted example also matches the previous built
revision's partial state; disabling numeric compilation for its inner loop
changes existing budget accounting and is not used as an equivalent baseline.
Exhaustive audits were not run.

```sh
node benchmarks/general-runtime.mjs --baseline=/path/to/baseline --cases=alias-2,alias-large,alias-release,move-large,work-passes --engines=compiled --samples=5
```

Raw series: [Mac](baselines/2026-11-04-array-ownership-mac.json),
[Intel](baselines/2026-11-04-array-ownership-intel.json).
Earlier instrumentation controls:
[Mac](baselines/2026-11-04-array-ownership-mac-before-elision.json),
[Intel](baselines/2026-11-04-array-ownership-intel-before-elision.json).
