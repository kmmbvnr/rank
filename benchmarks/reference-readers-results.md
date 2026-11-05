# Reference preparation, integer powers and scatter research

Baseline: `aa3621ca` (2026-11-05). Node 24.15.0 on Apple M5 and Intel
Core i7-10750H. Work was isolated in `perf/reference-readers`.

## Reference preparation

A fresh run of `execution-boundary-profile.mjs` executes 100,000 reference
helper calls. CPU samples still emphasize execution continuations, statement
execution, frame creation and GC. Heap sampling identifies repeated singleton
`Set` construction in `BindingEnvironment.assign` and `FunctionFrames.create`.

The implementation interns singleton binding type sets. Frames still establish
and check their own contracts; argument values, array ranks, storage proofs,
closure environments and return contracts are not shared by this cache.
`settledBindingTypes` replaces a missing-only contract rather than mutating a
shared set. Existing type-set consumers only read these sets.

In the 4 KiB sampled allocation profiles, cumulative sampled allocation falls
from 1235.9 to 1119.8 MiB (9.4%). The two leading removed Set sites account for
42.1 and 39.7 MiB. These are sampled cumulative JS allocations, including
collected objects, not retained memory or process RSS. Profiled elapsed times
are not used as speed evidence. Raw compressed Inspector profiles, allocation
site summaries and profiler text are in `results/reference-readers/mac-*`.

## Reader coverage

The shared tensor IR now lowers integer powers into the interpreted indexed
reader when the exponent is a captured nonnegative BigInt scalar. It supports
arbitrary such exponents, exact wide intermediates, negative bases and 0**0.
Admission reads metadata and the captured scalar, never exponent-array cells.
Array, negative and real exponents retain ordinary execution. Scalar callbacks
and real/mixed producers retain their existing limits. This introduces no
control-flow compilation or shared computed-cell cache.

The producer tests use independent BigInt calculations, check native-reader
admission in both engines, and retain negative-power error order and array
exponent fallback. Euler programs retain their assignment boundaries; the
reader speed result below is a dedicated grouped-consumer benchmark, not a
claim that all Euler power expressions now fuse.

## Timing method and small controls

Three fresh sequential processes per revision, engine and case. Baseline and
candidate order reverses in the middle round. Parsing and process startup are
excluded; cold execution preparation and compilation are included. Diagnostics
and profiling are disabled. All answers are asserted against exact constants
or independently calculated BigInt bins. The machines were not isolated from
other activity; these small series do not establish universal speedups.

Medians in milliseconds; ratio is candidate / baseline.

| Case | Engine | Mac before → after | Ratio | Intel before → after | Ratio |
| --- | --- | ---: | ---: | ---: | ---: |
| 100k helper calls | reference | 634.38 → 594.63 | 0.937 | 1792.84 → 1764.75 | 0.984 |
| 100k helper calls | compiled | 15.77 → 15.39 | 0.976 | 29.34 → 28.80 | 0.982 |
| 200k squared values into 64 groups | reference | 44.75 → 32.41 | 0.724 | 115.70 → 77.75 | 0.672 |
| 200k squared values into 64 groups | compiled | 45.47 → 34.33 | 0.755 | 115.96 → 75.12 | 0.648 |
| Euler 23, default | reference | 84.65 → 84.06 | 0.993 | 198.58 → 195.33 | 0.984 |
| Euler 23, default | compiled | 40.45 → 39.72 | 0.982 | 80.28 → 79.98 | 0.996 |
| Euler 193, Power=24 | reference | 47.41 → 46.31 | 0.977 | 119.48 → 129.37 | 1.083 |
| Euler 193, Power=24 | compiled | 21.22 → 19.49 | 0.918 | 35.22 → 35.92 | 1.020 |
| Euler 401, Limit=2e12 | reference | 298.07 → 281.33 | 0.944 | 612.23 → 605.94 | 0.990 |
| Euler 401, Limit=2e12 | compiled | 201.35 → 197.79 | 0.982 | 405.58 → 393.52 | 0.970 |
| Euler 410, R=200k/X=300k/Block=70k | reference | 156.40 → 154.37 | 0.987 | 313.24 → 315.11 | 1.006 |
| Euler 410, R=200k/X=300k/Block=70k | compiled | 67.75 → 72.03 | 1.063 | 137.75 → 135.29 | 0.982 |
| Euler 550, N=100/K=3 | reference | 29.32 → 30.97 | 1.056 | 75.90 → 74.46 | 0.981 |
| Euler 550, N=100/K=3 | compiled | 40.36 → 40.67 | 1.008 | 95.48 → 98.12 | 1.028 |

The short controls include slower cases, up to 8.3%; they do not prove zero
regression. The clearest speed effect is removal of power-producer traversal in
the grouped consumer. The reference call speed effect is small on Intel.

## Full default Euler inputs

Three fresh-process samples per engine/revision/host, all checking the full
published answer. Times are seconds; RSS is median whole-process peak MiB.

| Demo | Engine | Mac seconds before → after | Mac RSS | Intel seconds before → after | Intel RSS |
| --- | --- | ---: | ---: | ---: | ---: |
| 401 | reference | 6.206 → 6.553 | 334.2 → 332.8 | 15.268 → 15.212 | 320.3 → 320.2 |
| 401 | compiled | 3.443 → 3.468 | 269.1 → 254.6 | 7.823 → 7.716 | 242.5 → 242.7 |
| 410 | reference | 63.459 → 68.961 | 579.8 → 585.0 | 121.431 → 126.632 | 558.8 → 556.2 |
| 410 | compiled | 5.897 → 6.125 | 344.5 → 338.5 | 12.051 → 12.276 | 320.8 → 283.0 |

These controls show mixed effects. Full reference 410 is slower by 8.7% on Mac
and 4.3% on Intel; full reference 401 is 5.6% slower on Mac and essentially
unchanged on Intel. The change is not a universal reference speedup. Follow-up
410 controls and the original outlier are reported below rather than hidden.

## Euler 410 timing follow-up

The first Mac full-scale series has reference medians 63.459 → 68.961 s
(+8.7%) and compiled medians 5.897 → 6.125 s (+3.9%). One compiled pair was
5.475 → 7.600 s. Those observations prompted additional measurements rather
than a claim of regression-free execution.

Nine new pairs at R=2000000/X=3000000/Block=70000 have reference medians
1059.57 → 1060.27 ms (+0.07%) and compiled medians 171.02 → 170.42 ms (-0.35%).
The exact answer 47999414397928 was also computed independently by a sieve
counting distinct prime divisors and a direct integer formula over each divisor.

Five new pairs on the full compiled input have medians 5201.39 → 5217.71 ms
(+0.31%), recorded in `mac-full-compiled-control.jsonl`. Follow-up samples also record process CPU
usage and initial system load. They do not silently replace the original series.


Two further full reference Mac pairs produce 52.616 → 55.307 s and
70.707 → 75.561 s (+5.1% and +6.9%). Their medians are 61.662 → 65.434 s
(+6.1%). The 39% compiled outlier did not reproduce in five further full pairs;
the full reference slowdown remains smaller but should be treated as a cost of
this candidate until a larger controlled series establishes otherwise. Across
these measured medians there is no slowdown above 10%; this is a measured
regression check, not a guarantee for other machines or inputs.

## Scatter experiment

`reference-scatter-probe.mjs` compares ordinary reference `.accumulate` with a
research-only two-pass reader consumer. Both use two million stored integers,
computed keys `(T * 17) mod 1024` and RHS `T ** 2 + 3`. Every output bin is checked
with an independent BigInt loop. Setup is outside timing. Peak RSS is sampled
before the independent oracle runs.

Three fresh processes per mode, with alternating order:

| Host | Ordinary ms / peak MiB | Prototype ms / peak MiB |
| --- | ---: | ---: |
| mac | 1471.17 / 349.5 | 998.48 / 181.3 |
| intel | 1814.23 / 331.7 | 1207.51 / 162.4 |

The prototype first validates all keys, then reads keys again while reducing
RHS values into private exact integer updates. It publishes only final bins.
This uses O(input storage + target size) memory without completed key/RHS arrays.
It is a direct host consumer, not a replacement Rank statement implementation.

Production integration remains separate for concrete reasons:

- Selection validation precedes RHS evaluation, including RHS effects.
- RHS must complete before target writes or replacement-contract errors.
- Aliases, retained slices and target-dependent keys/RHS must see snapshots.
- Plain compound scatter reads original cells and keeps the last replacement;
  `.accumulate` folds repeated addresses. These are different contracts.
- `.accumulate` returns its original RHS. Only discarded results could omit it.
- Real arithmetic cannot inherit exact-integer regrouping semantics.
- Observable polling, inspection and demand budgets need their existing work
  boundaries; the prototype has not established equivalent behavior.

The experiment supports pursuing a guarded, discarded-result integer
`.accumulate` consumer with private updates. It does not justify enabling
streaming for general scatter or bypassing contracts. No production scatter
semantics or selection implementation changed in this task.

## Verification scope

All 549 tests across 17 focused files pass on both hosts; the complete logs
are saved as `mac-tests.txt` and `intel-tests.txt`.

The focused selection covers keyed producers and integer folds, accumulating
writes, block and function scope, eager/deferred parameters, array/record
binding contracts, builtin rebinding, plans/effects, return preparation,
loop array frames and tail calls. It includes independent power results and
independence of missing-only bindings after type-set interning.

TypeScript project build and interpreter test typecheck, semantic-source
boundaries (65 owners), and application-form checks are included. Exhaustive
type/differential/demo audits and the full workspace `npm test` are not run.

`source-identities.json` records sorted path-and-content SHA-256 hashes for
interpreter/language source and emitted JavaScript in both revisions. All four
hashes per revision match between Mac and Intel. The baseline was built before
source edits and retained separately; both engines use their revision's emitted
interpreter. Language dependencies are identical between revisions.

## Reproduction

Build baseline and candidate independently with locked dependencies, generated
language and `tsc -b tsconfig.build.json`. Use the same Node version on each host.
From the candidate checkout:

```sh
python3 benchmarks/reference-readers-series.py \
  /path/to/baseline "$PWD" /path/to/node /tmp/small.jsonl
python3 benchmarks/reference-readers-series.py \
  /path/to/baseline "$PWD" /path/to/node /tmp/full.jsonl \
  401-full 410-full
node benchmarks/execution-boundary-profile.mjs \
  /path/to/baseline /tmp/reference-before
node benchmarks/execution-boundary-profile.mjs \
  "$PWD" /tmp/reference-after
node benchmarks/reference-scatter-probe.mjs ordinary 2000000
node benchmarks/reference-scatter-probe.mjs stream 2000000
```

Raw runs are saved in `results/reference-readers`. Full default answers checked
by the timing runner are 281632621 (401) and 799999783589946560 (410).
