# Integer ranges at individual definitions and reads

Baseline: `0a4e55f7` (runtime unchanged from `d6b190c8`). Candidate runtime
source SHA-256 (sorted relative `.ts` paths under `packages/interpreter/src`,
NUL separator, then file bytes):
`2a8e27636e8d7ed31dd61ee352f847082c9208ecbfbe7c63f147cdaccf887665`.

A source analysis now records exact integer intervals for individual expression
occurrences and assignments. Sequential definitions replace facts, branches
merge them, and loop back edges invalidate written names. Known range iterators
have conservative bounds in their bodies; zero iterations and early exits do
not export body-only facts. Facts use source constants and prior definitions,
not observed array cells or one observed invocation. Cached analysis is keyed
by the source AST. Interval endpoint magnitudes are capped at 2^256; exceeding the
8192-expression or 256-depth budget discards all facts from that analysis.

The Number backend consumes those facts in two ways:

- Bounded scalar reads carry intervals into the existing arithmetic checks.
- Exact arithmetic can end at a proved safe result, such as `Total mod Divisor`.
  A wide register can also have a bounded occurrence after a local assignment:
  that occurrence converts safely to Number without forcing all definitions of
  the same name to use Number.

For example, `X = I mod 8; Y = X * X; ...; X = Total` can keep `Y` and array
addresses numeric while the later `X` and `Total` remain exact. The dependency
analysis keeps consistently bounded local definitions numeric, but treats an
unknown entry value as a separate definition. Mixed compilation is also tried
when a wide literal prevents an all-Number plan from being built.

There is still one storage representation per named register. This is not a
full SSA conversion, unrestricted symbolic algebra or an interprocedural range
analysis. Unknown bounds retain checks/fallback. The native arithmetic path
keeps its prior checks when either operand lacks a range. Existing mutation,
precision, callback and ownership guards remain. New exact-to-Number paths
retain the previous backend under observable demand budgets: private storage
preparation must not shift the stopping point.

## Measurements

Node v24.15.0 on Apple M5 and Intel i7-10750H. Five alternating fresh processes
per case and revision, plus a separate diagnostic run. Timings include initial
preparation/compilation and exclude parsing/startup. Both revisions execute the
same program and verify an independent exact checksum. Tests finish before
measurements on each host; other system load is not controlled. Peak RSS covers
the whole process. Post-GC retained heap and buffers are recorded separately.
Scalar-entry compilation is disabled. No demo is rewritten in this step.

- `range-residue`: 100000 indexed updates driven by a wide exact accumulator's
  residue. The checksum includes every cell's index and the final accumulator.
- `range-definitions`: 100000 updates, reusing a name for a small value and then
  for the wide accumulator in every iteration.
- `range-bounded`: 262144 updates with several bounded numeric intermediates.
- `work-passes` and `move-large`: existing non-wide controls.

| Case | Host | Baseline ms | Candidate ms | Speedup | Peak RSS MiB, before → after |
| --- | --- | ---: | ---: | ---: | ---: |
| range-residue | Mac | 23.88 | 13.89 | 1.72× | 149.94 → 143.28 |
| range-definitions | Mac | 25.99 | 15.82 | 1.64× | 150.48 → 142.59 |
| range-bounded | Mac | 15.20 | 15.03 | 1.01× | 142.77 → 142.84 |
| work-passes | Mac | 19.59 | 20.68 | 0.95× | 148.06 → 143.75 |
| move-large | Mac | 65.23 | 61.03 | 1.07× | 147.20 → 146.95 |
| range-residue | Intel | 60.13 | 31.92 | 1.88× | 139.39 → 134.29 |
| range-definitions | Intel | 64.58 | 37.69 | 1.71× | 143.90 → 136.01 |
| range-bounded | Intel | 32.46 | 32.77 | 0.99× | 134.95 → 134.16 |
| work-passes | Intel | 40.82 | 41.26 | 0.99× | 136.38 → 136.67 |
| move-large | Intel | 151.09 | 151.12 | 1.00× | 147.20 → 147.43 |

The two wide examples enter a mixed numeric region rather than an entirely
exact region. The final checksum loop is numeric in both revisions, so total
numeric-region counts are two versus one. The bounded-only case has little
measured benefit; no universal speedup or memory reduction is claimed. The
short `work-passes` control is 5.5% (about 1.1 ms) slower on Mac and 1.1%
slower on Intel in this series, which includes initial proof construction.

## Verification

1009 focused tests in 21 files pass on Mac and Intel, including 18 new range
cases. Tests cover signed residues, branch merging, reused names, large literals,
entry values versus later definitions, loop-carried growth, empty nested loops,
array-cell uncertainty, overflow replay, partial state before errors, real-type
errors, demand budgets and discarding incomplete proofs. The Intel run initially
missed the Euler 378 fixture in its isolated checkout; after transferring it,
the affected 45-test file passed. The other 1008 tests had already passed.
Build and semantic-boundary/application-form checks pass. Exhaustive audits
were not run for this step.

```sh
node benchmarks/general-runtime.mjs --baseline=/path/to/baseline --cases=range-residue,range-definitions,range-bounded,work-passes,move-large --engines=compiled --samples=5
```

Raw series: [Mac](baselines/2026-11-04-integer-ranges-mac.json),
[Intel](baselines/2026-11-04-integer-ranges-intel.json).
