# Dense residue counters — issue #358

The 30-second Euler 326 timeout no longer reproduces on main at `fdd25d38`.
Existing compiled indexed writes complete the full calculation in about two
seconds. This change adds repeatable measurements and regression coverage;
it does not change runtime semantics or introduce another specialization.

Measured on Apple M5, Node v24.15.0. Three fresh sequential processes per case,
with case order reversed on alternate trials. The parser is initialized before
timing; execution includes compilation and array allocation. Diagnostics run in
separate processes. Times are measurements, not CI deadlines or a before/after
speedup claim.

| Workload | Default execution | Exact BigInt only | Default process | Exact process |
| --- | ---: | ---: | ---: | ---: |
| 6,000,000 iterations, two indexed increments each | 258 ms | 1,022 ms | 860 ms | 1,599 ms |
| Full Euler 326 | 2,103 ms | 1,877 ms | 2,651 ms | 2,424 ms |

The counter workload revisits each of 1,000,000 cells six times in both arrays.
Every cell is checked against `6`, outside the timed region and without unpacking
storage. Full Euler execution returns `1966666166408794329` in both modes.
Process timings include imports, counter verification, and disposal.

## Where time and storage go

- Counter updates use one compiled Number loop with no overflows. Indexed
  addresses are bounds-checked in generated code, without ordinary per-store
  statement/selector dispatch.
- The Number backend copies each writable array into private Float64 cells and
  allocates a dirty-cell bitmap. Publication converts changed cells back to
  BigInt. These allocations allow an overflowing attempt to be discarded safely.
- Euler's recurrence and final accumulation each overflow Number's safe integer
  range, then replay using exact BigInt arithmetic. Disabling speculation is
  about 11% faster for this workload, but makes the isolated counters about four
  times slower. Disabling Number loops globally would be a regression.
- Diagnostics report zero typed unpacks, element-type scans, and COW copies for
  all four workloads. Median peak RSS is about 197/181 MiB for default/exact
  counters and 206/187 MiB for default/exact Euler. These are whole-process
  high-water marks, not retained array sizes or allocation counts.
- A separate CPU profile of default Euler attributed 43% of process samples to
  its largest generated function, 7% to a prepared scalar writer, 3% to the
  storage writer, and 1.4% to GC. This points to generated computation and
  publication work rather than a dominant GC stall; it does not isolate the
  cost of individual arithmetic or bounds checks.

No prerequisite compiler refactor is needed to meet #358. Backend selection
remains a possible improvement, but requires a general rule that preserves
fast counter loops. The regression test compares period-based counting with an
independent direct recurrence and contiguous-sum enumeration for 30 small
inputs, under default, exact-only, and uncompiled execution. A separate case
checks that overflow replay neither doubles either counter nor changes an alias.

## Reproduce

```sh
npx tsc -b tsconfig.build.json
node benchmarks/dense-counters.mjs --trials=3
npm test --workspace @arrrank/interpreter -- test/euler-326.test.ts test/number-loop.test.ts test/integer-loop.test.ts
```

To compare another built runtime, pass
`--runtime=/path/to/checkout/packages/interpreter/out/index.js`.
Each worker has a 30-second process timeout by default, configurable with
`--timeout=60000`; performance thresholds are deliberately excluded from tests.

For a separate CPU profile:

```sh
node --cpu-prof --cpu-prof-dir=/tmp benchmarks/dense-counters.mjs --worker=euler --diagnostics
```

The captured measurements and diagnostics are in
[the raw results](baselines/2026-10-21-dense-counters.jsonl).
