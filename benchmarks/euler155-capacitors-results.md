# Euler 155: compact distinct values and ready reciprocal arrays

Baseline: `724ccc0e0c992b89755bf44904a65ee5843ecefc`. Apple M5,
Node v24.15.0. Default `Count = 18` and answer **3857447** are unchanged.
The original fixture is unchanged: Count 3 returns 7; Counts 10, 12 and 15
return 2525, 15463 and 241519. No exclusions, lanes or deadlines changed.

## Controlled compiled results

Three serial fresh workers per version/case, reversing order between samples.
Time includes parsing and complete execution, excluding interpreter construction,
module imports and validation. Process peak RSS is sampled before validation.
This investigation scheduled no concurrent builds, tests, profilers or other
benchmark workers during timing. Earlier exploratory timings differ from this
pass and must not be mixed into its comparisons.

| Version | Main median | Fixture median | Main peak RSS median | Fixture peak RSS median |
| --- | ---: | ---: | ---: | ---: |
| Before: original source/runtime | 15.871 s | 975.561 ms | 1119.45 MiB | 312.84 MiB |
| Runtime only: original source | 12.170 s | 863.662 ms | 1031.14 MiB | 300.53 MiB |
| Source only: baseline runtime | 9.495 s | 686.172 ms | 1000.88 MiB | 233.81 MiB |
| Final source/runtime | **5.164 s** | **569.404 ms** | **832.33 MiB** | **222.33 MiB** |

The final main is **3.07x faster**, with **25.6% lower peak RSS**. The fixture
is **1.71x faster**, with **28.9% lower peak RSS**. These are whole-process
high-water measurements, not retained-heap or allocation-volume claims.
Every worker verifies the complete default answer or all fixture assertions.
The ablation distinguishes runtime improvements from source changes; their
interaction is included in the final row rather than assumed additive.

Separate full reference validations, one fresh worker per case/version:

| Workload | Before | Final |
| --- | ---: | ---: |
| Main | 77.574 s | 64.548 s |
| Fixture | 4.649 s | 4.252 s |

Every reference worker passes. These single observations establish correctness
and give current costs; they are not repeated performance estimates. General
reference loop and expression overhead remains.

## Cause and runtime change

The pair-generation region already uses the Number backend, including `gcd`.
A separate CPU-profiled diagnostic run of the unchanged source concentrates
in distinct-value construction and generic collection traversal rather than
generated pair loops.
At level 18 it generates 8,345,678 candidates, obtains 3,842,575 exact-level
values and grows Store to 6,355,545 entries across all levels. The clean before diagnostic
reports 21,577,062 ordinary computed cells. A separate stage-print probe adds
observations of deferred Lev, causing recomputation and 43,154,124 cells; use
that probe for candidate/level sizes, not as a count of normal execution work.
Neither diagnostic is a before timing sample.

`numericDistinct` now reads admitted stable Int32 storage directly. Its keys
are exact Numbers, so it avoids the generic integer items Proxy, per-input
BigInt boxing and conversion back to numeric keys. Materialized results retain
first-appearance order and expose exact Rank integers; distinct counts do not
build an output array. Other homogeneous integer results use the existing
`IntegerCells` builder, keeping large results in Int32 where possible and
widening exactly when necessary.

The existing admission checks remain: stable runtime-owned rank-1 storage,
no column metadata, missing values, opaque readers or observable polling.
Unsupported cases retain their ordinary paths. Real NaN/signed-zero behavior,
boolean results and integers beyond Int64 retain their existing contracts.
Source buffers are not mutated or aliased by results. The input scan and output
construction both retain periodic cancellation checkpoints.

## Source changes

`Rec` is completed before joining it with `Par`. The original deferred
reciprocal recipe prevented concat's integer distinct reader from admitting
both inputs, so `Lev` used generic collection traversal. Ready reciprocal
storage lets the existing numeric concat consumer run. This changes the demo's
completion choice; it does not change ordinary `=` or deferred-binding semantics
in the interpreter.

For an equal-level join, `(P, Q)` and `(Q, P)` produce the same reduced rational.
The inner loop starts at P only when I equals J. Candidate allocation uses the
matching triangular size, so no unused zero keys enter `unique`. The level-18
candidate count falls from **8,345,678 to 7,968,532** (4.5%). Unequal-level joins
and the reciprocal closure are unchanged. This is a reduction in duplicate
work, not a new asymptotic algorithm.

The final answer uses the existing `Store unique len` consumer, avoiding an
unneeded materialized final distinct array. Exact-count levels and the complete
attainable set remain available in Store/Off.

Clean diagnostics without extra stage consumers:

| Counter | Before | Final |
| --- | ---: | ---: |
| Ordinary computed cells | 21,577,062 | 0 |
| Native numeric distinct operations | 18 | 35 |
| Number loops | 34 | 34 |
| Number overflows | 0 | 0 |
| Compiled tensors | 17 | 34 |
| Typed buffer unpacks | 0 | 0 |

The final Store still holds 6,355,545 entries. Extra native distinct admissions
replace generic distinct processing; no smaller input or discarded fixture
assertion accounts for the timing improvement.

## Rejected experiment

A separate prototype retains only values first attainable at each count,
filters earlier values through membership and counts the resulting disjoint
levels. Its full answer is correct, but one exploratory run took **251.172 s**.
It was rejected. This single run used an intermediate runtime; no precise
controlled slowdown ratio or isolated membership-cost attribution is claimed.
The prototype is kept as `fixtures/euler155-minimal.ra`, alongside the original,
ready-only and triangular variants. Its levels intentionally have a different
minimum-count contract from the retained exact-count levels.

## Verification

Build and interpreter test typecheck pass. The ordinary interpreter selection
passes **8,927 tests in 396 files**, including ten new compact-distinct tests;
semantic-boundary checks (65 owners) and application-form checks pass.
Exhaustive type/differential corpora and Nurikabe remain separate lanes.

An independent oracle stores unencoded rational pairs, reduces them with a
JavaScript Euclidean GCD and explicitly enumerates both parallel and series
joins over all ordered splits. For Counts 1 through 10, **both engines match
the complete attainable-value set and the exact-count level**, not only the
answer cardinality. The original fixture assertions and full Count 18 golden
answer pass in the timed cases documented above.

New runtime tests cover stable order, duplicates, signed Int32 endpoints,
distinct counts, compact concat output, result ownership, exact widening to
Int64 including values beyond safe Number range, public writes, host-reader
overrides and cancellation. Existing numeric-collection tests cover real
NaNs/negative zero, booleans, masked/mixed/foreign inputs and wider integers.

Two unchanged full-default compiled controls use three serial fresh processes
per version, alternating versions, and verify their golden answers:

| Control | Before median | Final median |
| --- | ---: | ---: |
| Euler 060 | 5154.096 ms | 5159.900 ms |
| Euler 177 | 2648.704 ms | 2470.998 ms |

Ranges overlap in both controls. These observations do not establish a
universal speedup or prove that every other workload is unaffected.

## Reproduction

Build both runtimes before comparing; before-runtime must be a separately
built copy of the baseline, not a directory overwritten by the final build.

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/euler-capacitors.mjs --samples=3 --ablation=1 --before-source=benchmarks/fixtures/euler155-original.ra --before-runtime=/path/to/baseline/out/index.js
node benchmarks/euler-capacitors.mjs --samples=1 --engine=reference --deadline=180000 --before-source=benchmarks/fixtures/euler155-original.ra --before-runtime=/path/to/baseline/out/index.js
node benchmarks/euler-capacitors.mjs --checks=1
node benchmarks/euler-capacitors.mjs --checks=1 --engine=reference
node benchmarks/euler-capacitors.mjs --worker=main --diagnostics=1
node --expose-gc benchmarks/euler-prime-pairs.mjs --worker=bits --runtime=/path/to/out/index.js
node benchmarks/euler-quadrilaterals.mjs --worker=main --version=final --runtime=/path/to/out/index.js
```

Raw records: `baselines/2026-10-27-euler155-*.json`. Primary timing files include
source and changed-runtime module hashes. Profiles, stage probes, oracles and
exploratory results are separate from the controlled timing files. Full V8
profiles are temporary local artifacts; their top self samples are retained.
