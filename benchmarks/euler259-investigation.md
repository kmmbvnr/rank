# Euler 259 investigation

Baseline: a97ff4eb, Node v24.15.0, macOS arm64. The final change ships
range-aware ownership checks and the final-interval filter. Exploratory samples
collected before implementation are in
`baselines/2026-10-29-euler259-investigation.json`.

The algorithm is interval dynamic programming over reduced rational values.
Every split combines the Cartesian product of the two smaller interval sets.
This is a reasonable exhaustive algorithm, but the final interval need not retain
non-integral results: no larger interval consumes it.

## Controlled implementation comparison

Twelve sequential fresh processes, three samples per source/runtime pair, with
alternating pair order. Baseline runtime is built from a97ff4eb. Raw results are
in `baselines/2026-10-29-euler259-comparison.json`; identical source hashes occur
on both sides of each runtime comparison. Imports are excluded; parsing,
preparation and evaluation are included. External host load is uncontrolled.

| Source / runtime | Median seconds | Range, seconds | Median process peak RSS, MiB |
| --- | ---: | ---: | ---: |
| Original / original | 22.901 | 22.651–23.072 | 2208 |
| Original / improved | 22.554 | 22.327–23.202 | 2665 |
| Final integers / original | 9.178 | 9.074–9.590 | 1358 |
| Final integers / improved | 8.952 | 8.888–9.165 | 868 |

The combined change is 2.56 times faster than the original source/runtime pair.
The source change supplies most of the speedup. The runtime improvement alone
removes 36 whole-table copies (288 million cells) and, on the final source,
reduces median peak RSS by 36% with about 2.5% less elapsed time. Original-source
peak RSS increases in the runtime-only comparison, so this is not evidence of
a universal reduction in peak memory. Peak RSS is not retained memory.

The exact full answer remains 20101196798. The original 15-minute special audit
timeouts for both 259 paths are removed; both remain in the ordinary corpus
with the common budget. A full compiled golden assertion also runs in the
ordinary interpreter suite.

## Verification

- TypeScript interpreter build and test typecheck pass.
- Ordinary interpreter suite: 412 files, 9334 tests pass.
- Focused slices/updates: five suites, 181 tests pass (12 new cases).
- Independent expression-tree oracle: Top=1..6 in both engines, 12 checks pass.
- Scoped type and differential audits: both demo paths pass; the differential
  run executes the full default and all six small assertions in both engines.
- Semantic source checks: 11 tests and 65 owners pass; application forms pass.

Additional final full-input checks (single runs; not the controlled compiled
medians): plain reference 55.667 seconds, cooperative Atomics cancellation path
40.688 seconds. Both return 20101196798 with zero table copies. A same-source
reference comparison took 58.945 seconds with the original runtime and
38.553 seconds with the improved runtime. Earlier exploratory reference
numbers below vary substantially and are not a production speedup claim.

## Exploratory full-input samples

| Variant | Compiled seconds | Reference seconds | Process peak RSS, MiB |
| --- | --- | --- | --- |
| Original | 43.988, 21.370, 23.095 | 51.073 | compiled 1979–2379; reference 2030 |
| Final interval retains integers only | 9.167, 8.940 | 19.774 | compiled 1355–1479; reference 1412 |
| Grow Keys by concat | 38.850 | not measured | 2503 |
| Original, prototype range-aware copy-on-write | 22.414, 20.484 | not measured | 2662–2697 |

Combining the final-interval filter with the range prototype took 8.323
seconds in one full run (peak RSS 856 MiB, zero copied cells).
This single sample does not establish an additional speedup.

Every full run asserts Answer=20101196798. The final-interval variant also passes
the existing known answers for Top=3, 4, 5: 255, 4179, 74689. These are exploratory
samples with uncontrolled external host load; the first original sample is a
clear timing outlier. Compare against the later 21–23 seconds, not a claimed
stable 44 seconds. Peak RSS is not retained memory.

The shipped demo inserts this immediately before `Pool = concat Pool More`:

```rank
if L equal Top
  More = More filter (Rd equal 1) array
end
```

It retains all fractions for intermediate intervals. It removes fractional final
results before pool concatenation, unique sorting and the Keys write. Written
set cells decrease from 4518598 to 1410570.

## General runtime findings

* The original full run records 36 whole-table copy-on-write operations:
  288000000 cells copied from the preallocated 8000000-cell Keys buffer.
* `sliceStoredArray` records retained slice bounds. `arrayForWrite` can prove
  a single scalar write disjoint from those bounds, but bulk assignments call
  `owned(target)` without a write range. Appending a disjoint interval therefore
  copies the whole buffer. The shipped ownership check now accepts an exclusive
  range end, and regular bulk assignments pass their bounding interval.
* An isolated JS prototype passes the min/max bounds of a regular bulk write
  to this check. It retains whole-array alias protection and the ordinary path
  for overlapping or unknown ranges. All full answers match and copy counters
  become zero. Its timing advantage is small against the later baseline and its
  peak RSS increases; it is not a validated production repair.
* At Top=8, unprofiled original / prototype times are 3.059 / 3.258 seconds,
  with peak RSS 1064 / 691 MiB. No uniform speedup is demonstrated.
* A separate Top=8 CPU profile has 1534/5194 samples in `IntegerCells.set`
  and 390 in `storeCell`. These are integer output packing and writes, not
  evidence that all work falls back to AST interpretation. The run records
  590 compiled tensors and 36 compiled loops. `unique sort` already fuses
  into the numeric path, once per interval (45 times on the full input).
* Making An and Ad eager alone did not help at Top=8 (3.319 seconds).

The final implementation covers compiled and ordinary bulk writes, including
fused updates and accumulated updates. Twelve new tests cover disjoint ranges,
overlapping slices, whole-array aliases, reverse strides, widening, RHS snapshots
and errors in both execution modes. The focused five-suite run passes 181 tests.
General improvements to integer tensor output packing require their own benchmark
before claiming a benefit.

## Reproduce

Build the interpreter, then run fresh processes sequentially:

```sh
node benchmarks/euler259-reachablenumbers.mjs --variant=original
node benchmarks/euler259-reachablenumbers.mjs --variant=shipping
node benchmarks/euler259-reachablenumbers.mjs --reference
node benchmarks/euler259-reachablenumbers.mjs --variant=shipping --reference
node benchmarks/euler259-reachablenumbers.mjs --variant=shipping --Top=5
```

`--verify` enumerates all expression trees independently for Top=1..6 using
unreduced BigInt fraction pairs. It checks the demo in both engines (12 runs);
this checks normalization, packing and the final-interval filter against a
different representation. `--fixture` runs every embedded assertion, including
the full default. `--interrupt` checks the cooperative execution path.

`--runtime=/absolute/path/to/out/index.js` selects a separately built runtime;
`--source=/absolute/path/to/demo.ra` selects an experimental source. The range
prototype exists only under `/tmp/rank259-range-runtime`; the final TypeScript implementation replaces this experiment. The benchmark includes parsing/preparation/evaluation and
excludes runtime imports. Historical issue timings are not current baselines.
