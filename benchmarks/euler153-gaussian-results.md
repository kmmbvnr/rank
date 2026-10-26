# Euler 153: reference interpreter overhead

The unchanged Gaussian-integer solver already completes the full input quickly
with compilation enabled. Reference execution spends substantial time preparing
mutation checks and validating repeated scalar array writes.

Two runtime changes reduce that overhead:

- Mutation guards retain each statement's syntax-derived target names and local
  scope flags. Prepared statements reuse those targets. Current binding and value
  protection is checked on every execution, including compiled loop entry.
- Array writes whose scalar replacements match the established integer, real,
  boolean or text element type reuse that element contract. Each replacement is
  read once and retains its cancellation/demand check. Missing values, infinity,
  structural values, positional columns and type mismatches use full validation.
  A contract changed by a host callback also receives full validation.

The solver, fixture, algorithm, default limit, assertions and execution lanes are
unchanged. The full answer remains **17971254122360635**, exceeding the exact
integer range of JavaScript `Number`.

## Controlled measurements

Apple M5, Node v24.15.0. Three serial fresh processes per version/workload/engine,
alternating version order. Times include parsing and complete execution; imports
and validation assertions are outside the timer. Diagnostics run separately.

The baseline is a snapshot of the runtime immediately before these changes,
including the pre-existing Euler 154 runtime work. Raw results retain hashes of
both changed runtime modules and both unchanged Rank sources.

| Workload / engine | Before, s | After, s | Time reduction |
| --- | ---: | ---: | ---: |
| Main / reference | 9.059 | 7.796 | 13.9% |
| Fixture / reference | 8.781 | 7.738 | 11.9% |
| Main / compiled | 0.312 | 0.313 | -0.4% |
| Fixture / compiled | 0.342 | 0.345 | -0.8% |

All reference main samples separate: baseline 8.967–9.193 s, candidate
7.756–7.836 s. Compiled ranges overlap; these measurements establish a reference
execution improvement. Reference peak RSS medians change from 455.9 to 465.9 MiB
for the main and 465.0 to 467.9 MiB for the fixture. These are process high-water
measurements; the change does not establish memory savings.

A separate guard-only main run has a 7.547 s median. It supports attributing the
Euler gain chiefly to mutation guards, but was run separately from the main
comparison and cannot establish an incremental contribution from scalar writes.

The scalar-write control performs 100,000 indexed integer updates. Reference
medians are 163.34 ms before, 161.30 ms with guards alone, and 145.51 ms with both
changes: 10.9% less time overall and 9.8% less than guards alone. The unchanged
compiled control has overlapping timing ranges. This control includes parsing.

## Validation

- TypeScript build, semantic-boundary checks and application-form checks pass.
- All 8,672 tests in 381 ordinary interpreter files pass. The selection excludes
  the exhaustive type/differential corpora and Nurikabe.
- Four scoped type/differential checks pass for the full main and fixture.
  Reference and compiled observations agree, and both fixture test blocks pass.
- Forty Euler-specific checks compare both engines at twenty limits from 0 to
  100 with direct Gaussian divisibility enumeration. This oracle uses neither
  Mobius inversion nor the solver's divisor-sum/lattice decomposition.
- Regression coverage checks live mutation protection, original error nodes,
  local scopes, repeated compiled entry, single-read replacement snapshots,
  homogeneous domains and per-cell demand budgets. Existing suites cover
  deferred captures, aliases, nested records, positional columns and infinity.

## Reproduction

Preserve a built baseline runtime directory before applying the changes, with
access to the workspace's dependencies. Then build and run:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-gaussian.mjs --before-runtime=/path/to/before/out/index.js
node benchmarks/euler-gaussian.mjs --cases=scalar-loop,scalar-writes --before-runtime=/path/to/before/out/index.js
node benchmarks/euler-gaussian.mjs --worker=main --engine=compiled --diagnostics=true
npm test --workspace @arrrank/interpreter -- test/types.test.ts test/differential.test.ts -t 'euler/153_gaussian'
```

Raw measurements:
[full workloads](baselines/2026-10-26-euler153.json),
[controls](baselines/2026-10-26-euler153-controls.json),
[guard-only main](baselines/2026-10-26-euler153-guards.json), and
[compiled diagnostics](baselines/2026-10-26-euler153-diagnostics.json).
