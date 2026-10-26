# Euler 127: native extrema and incremental abc-hit search

Default limit 120000 and answer **18407904** are preserved. The fixture keeps
one full run and the 1000 example (12523), and adds strict-boundary cases at 9
(answer 0) and 10 (answer 9). Execution lanes and deadlines are unchanged.

## Diagnosis

The old program already sorts candidates by radical and bounds each prefix.
It then expands every prefix into global arrays: **8195016 pairs**, of which
5485995 satisfy `a < b`, 23665 pass the radical-product check, and 456 are hits.
It computes gcd for every expanded pair. The important cost is the representation
of those candidates and repeated generic reads, rather than radical sieving.

The unchanged old source is archived in `fixtures/euler127-batched.ra`.
Native dyadic `min`/`max` previously lost tensor provenance. In particular,
`B' = (Cc - A) max 1` could not compose into a native numeric consumer.
Standard scalar extrema now publish guarded native map recipes. This preserves
normal plan construction and demand, scalar ranks, ordinary completion boundaries,
first-operand ties and independent observations. Mixed numeric domains, nonfinite
values, host sources and replaced native implementations retain ordinary behavior.
There is no hidden plan memoization or removal of deferred-binding checks.

The final program traverses the same sorted radical prefixes incrementally.
For each c it computes `Quota = (c - 1) // rad(c)` once. A candidate needs
`rad(a) <= Quota // 2` because b > a implies b >= 2. It tests order and
`rad(a) * rad(b) <= Quota` before gcd and accumulates only the sum. It avoids
the global pair-index, value and product arrays. The existing Number loop tier
can compile this search; no new loop backend was added.

## Controlled measurements

Apple M5 / Node v24.15.0. Medians of three serial fresh-process samples, alternating
version order. Times include parsing and complete execution, excluding startup,
imports and oracle validation. RSS is the process high-water mark before oracle
validation, not retained storage. The controlled runtime pair differs only in
`rank-application.js`, `tensor-map.js` and `tensor-kernel.js`; other modules are
identical. Baseline source revision is `0ff58e36`. Runtime/source hashes are in
all raw files; earlier concurrent issue inventory times are not comparable.

| Engine | Program/runtime | Main, s | Peak RSS, MiB |
| --- | --- | ---: | ---: |
| Compiled | Batched source, before native extrema | 14.264 | 1470.3 |
| Compiled | Same batched source, native extrema | 13.282 | 1464.6 |
| Compiled | Incremental search, native extrema | 0.200 | 181.5 |
| Reference | Batched source | 15.837 | 1413.4 |
| Reference | Incremental search | 15.836 | 390.6 |

Native extrema alone improve the unchanged main by **6.9% (1.07x)**. The complete
program/runtime change improves compiled execution by **71.2x**, with about **88%
lower peak RSS**. Its final four-test compiled fixture takes **0.227 s / 191.5 MiB**.

Reference time is approximately unchanged; its interpreted candidate loop still
visits 8.2 million pairs. Its memory use falls substantially. The large compiled
speedup therefore combines the new representation/early checks with the existing
loop compiler. It is not a claim that arithmetic pruning alone gives a 71x gain
in both engines.

Separate unchanged-source diagnostics reduce generic derived-cell computations
from **66914996 to 50284966** and increase native tensor entries from 2 to 4.
The final count probe uses two compiled loops, including one Number loop, and
119999 generic derived-cell computations. Count probes are separate validation
runs; the final probe adds a per-c hit counter, so their times are not benchmarks.

## Verification and reproduction

Every timed main independently validates all 120000 radical-table entries and the answer/output.
Separate count probes compare **every per-c hit multiplicity** between the old
source, new source and a scalar oracle: 456 hits, sum 18407904. Twenty-four small
checks compare both sources in both engines with exhaustive pair enumeration and
direct factorization at limits 3, 4, 10, 50, 100 and 1000. Every fixture sample
checks all four original/boundary test blocks and their printed outputs.

The new native-extrema suite has 26 tests covering deferred stage fusion,
broadcasts, repeated/unused plans, completion snapshots, exact large and mixed
numbers, homogeneous result errors, signed-zero ties, NaN fallback, host read
order, native replacements and delayed failures. Build/test typecheck and
semantic/application-form checks pass. The final ordinary interpreter run passes **8472 tests in 373 files** (excluding
the exhaustive type/differential corpora and Nurikabe). All four scoped Euler 127
type/differential checks pass, covering both full files and both engines. The
final focused repair/extrema selection passes 241 tests.

The initial ordinary run exposed three stale tests from the earlier Euler 021/023
top-level migration. Euler 021 now runs the real bounded script instead of calling
the removed `amicable_sum`; its helper checks remain. Euler 023 checks its actual
returned value, exact output and three compiled top-level loops. These failures
also occur with the runtime preceding native extrema; no Euler 021/023 program
was changed here.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-abc-hits.mjs --samples=3
node benchmarks/euler-abc-hits.mjs --samples=3 --engine=reference --cases=main
node benchmarks/euler-abc-hits.mjs --samples=1 --cases=counts --diagnostics=true
node benchmarks/euler-abc-hits.mjs --small-checks=true
```

The default benchmark compares archived and current programs using the same build.
To add the runtime-only baseline, build the baseline separately and pass
`--batched-runtime=/path/to/baseline/packages/interpreter/out/index.js`. The
`--runtime=` option selects an independently built candidate runtime. Each sample
uses a process-level 120-second deadline. Small brute-force checks and test suites
are correctness validation, not additional timing samples.

Raw results: [compiled main](baselines/2026-10-26-euler127-compiled.json),
[compiled fixture](baselines/2026-10-26-euler127-fixture.json),
[reference main](baselines/2026-10-26-euler127-reference.json),
[separate diagnostics and count probes](baselines/2026-10-26-euler127-diagnostics.json),
[small brute-force checks](baselines/2026-10-26-euler127-small-checks.json).
