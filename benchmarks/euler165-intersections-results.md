# Euler 165: fixture size, reference reads and exact integer ordering

Measured on Apple M5 / Node v24.15.0. Three fresh processes per fixture/control
version and five per full-main version in a separate follow-up, serial execution
with alternating version order. Times include parsing
and complete execution, excluding imports, assertions and disposal. Diagnostics
are separate. Each sample checks the full answer or every embedded fixture test.

The baseline is `1264d10b`. Its interpreter `out/` and demo sources were saved
before editing. The candidate measurement uses a copy of that runtime with only
these generated modules replaced: `eval/expressions.js`, `operators.js`,
`value-selection.js`, `numeric-collections.js`, `sequence.js`. Concurrent counter
and tensor work in the workspace is excluded, including the unrelated
`counterHas` import and membership change in `operators.js`. The fixture-only
version combines the baseline runtime with the revised fixture. Runtime module
and source hashes are recorded in the raw measurements.

## Results

Medians in seconds; RSS is the median per-process peak in MiB.

| Workload | Baseline | Fixture only | All changes | Baseline / final RSS |
| --- | ---: | ---: | ---: | ---: |
| Fixture, reference | 5.146 | 4.378 | 3.873 | 465.3 / 209.6 |
| Fixture, compiled | 0.852 | 0.447 | 0.444 | 534.0 / 270.5 |
| Full main, compiled | 4.138 | unchanged source | 3.382 | 846.5 / 626.1 |

The fixture is 24.7% faster in reference and 47.9% faster compiled. Comparing
the same revised fixture isolates a further 11.5% reference reduction from the
runtime changes. Most of the compiled fixture improvement comes from its smaller
inputs and buffers. The full main is 18.3% faster with 26.0% lower peak RSS;
its source, defaults and exact answer `2868868` are unchanged.

Reference fixture ranges are 5.129–5.146 s baseline, 4.353–4.412 s fixture-only,
and 3.799–3.880 s candidate. Full compiled ranges in the five-sample follow-up are
4.095–4.276 s baseline and 3.304–3.413 s candidate. Historical concurrent audit timings in issue #447 are
not the baseline for these comparisons. The earlier three-sample series includes
a 6.370 s candidate main outlier; it remains in the raw data. The table uses all
five main samples from the separate follow-up after the test run.

| Reference control, 100,000 iterations | Baseline, ms | Candidate, ms |
| --- | ---: | ---: |
| Scalar arithmetic and modulo | 143.139 | 141.935 |
| Indexed reads with arithmetic | 184.737 | 176.356 |

The indexed control improves 4.5%. Pure scalar control ranges overlap; no broad
arithmetic speedup is claimed. Compiled controls take 98.309 / 96.701 ms (scalar)
and 101.784 / 102.389 ms
(indexed); no substantial compiled-control speedup is claimed. These are cold
workloads, including parsing and generated-code preparation.

## Changes and contracts

- The first fixture test generates one segment with `Room = 0`. Its four
  coordinate assertions remain. The 300/1000-segment tests retain both golden
  answers and allocate at most `Segs * (Segs - 1) // 2` crossings each, an exact
  upper bound on pair intersections.
- Prepared reference expressions read live ordinary bindings before module or
  builtin resolution and prepare common integer operations. Non-integer operands
  retain the full operator dispatcher and are not evaluated twice. Scalar vector
  reads bypass unrelated table/SQLite/collection dispatch while sharing the
  existing bounds checks and cell reader.
- Stable argsort now has a six-pass signed Int64 radix permutation after the
  existing Int32 path. It reads the low/high words directly with host byte order
  accounted for. There is no conversion through Number: adjacent integers beyond
  2^53, signed extrema, descending order and equal-key stability stay exact.
  Arbitrary-precision integers outside Int64 retain comparison sorting. Native
  ordering remains disabled under cooperative interruption.
- `shift` reads one cell through `readArrayItem`, rather than forcing a typed
  source's public `items` array. A stride replaces per-cell coordinate-array
  allocation. Axis behavior, fill values and deferred-plan mutation protection
  remain unchanged.

Separate full-main diagnostics record two Number loops, zero overflows, two
numeric sorts and zero typed unpacks (previously two unpacks / 5,737,994 cells).
The algorithm still checks all 12,497,500 pairs, stores 2,868,997 strict
crossings and deduplicates by two stable sorts. No sweep-line replacement,
execution-lane change or timeout increase is included. Full reference execution
at 5000 segments was not rerun.

## Reproduction and verification

Before editing, save `packages/interpreter/out` as `SNAPSHOT/out` and
`demos/euler` as `SNAPSHOT/demos/euler`, with dependencies resolvable from the
snapshot. Then build and run:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-intersections.mjs --before=/absolute/path/to/SNAPSHOT
node benchmarks/euler-intersections.mjs --before=/absolute/path/to/SNAPSHOT --cases=main --samples=5
node benchmarks/euler-intersections.mjs --worker=main --engine=compiled --diagnostics=true
```

`--runtime=/path/to/out/index.js` permits an isolated candidate. `--cases=fixture`,
`--cases=scalar,indexed` and `--samples=1` select shorter runs. The benchmark
retains all original fixture assertions and checks the complete main golden.

Tests additionally compare eight small segment counts against independent
parametric intersections with separately reduced rational x/y coordinates in
both engines. Storage tests cover exact wide stable ordering, offset buffers,
input preservation, interruption fallback, typed shifts on all three tensor
axes, live binding replacements/deletions, mixed-type fallback and nullary host
function calls.

[Three-sample timings](baselines/2026-10-26-euler165.json),
[five-sample full main](baselines/2026-10-26-euler165-main.json), and
[separate diagnostics](baselines/2026-10-26-euler165-diagnostics.json).

Verification after the byte-index diagnostic repair: TypeScript build, semantic
boundaries (65 owners), application-form checks, 214 focused tests, all 8,754
ordinary interpreter tests in 387 files, and both scoped Euler 165 type and
differential audits pass. The ordinary run excludes the exhaustive types,
differential and Nurikabe audits; the first two were run separately for this
fixture. The negative byte-index case remains covered by `native-loop.test.ts`.
