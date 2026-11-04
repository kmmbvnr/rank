# Integer producer / grouped consumer measurements

Baseline: `cf455fa1796e189d463df12da0bd8938c89dccdc`. Candidate implementation: `e9050b5ce6565434771cb815ad2d4e23493c7d8c`.
Both include the integrated Euler 388 changes. Delivery also includes the later
ACMP-only main commit; its rebase leaves the measured runtime source hash unchanged. The implementation extends the
existing native tensor graph and integer reader; it does not change either
Euler demo or cross ordinary assignment boundaries.

## Method

Node 24.15.0 on Apple M5 (Mac) and Intel i7-10750H. Each observation uses a fresh
Node process. Three samples per case, engine and mode; version order alternates
between samples. Parsing and process startup are excluded from execution time;
initial compilation and graph preparation are included. Runs are serial on each
host. This task’s tests and builds completed before the final timing series.

Time and peak RSS below use diagnostics and allocation profiling **off**.
Allocation estimates come from separate diagnostics-on runs with V8 heap sampling
(32 KiB sampling interval, including objects collected by minor and major GC).
They estimate cumulative JavaScript heap allocation, not live or retained memory,
and exclude external ArrayBuffer payloads. Instrumented timings are retained in
the raw files but are not used for speed claims. The raw files also contain
typed-array publication counts and post-GC heap/ArrayBuffer retention with the
runtime bindings still reachable. RSS is the whole-process high-water mark,
including parsing, startup and final GC; it is not an allocation count.

Each host has 120 small-series observations and 24 full-Euler observations.
Every worker checks its exact output. An independent recurrence computes the
Euler oracle; the measured Rank producer uses polynomial residue keys. The full
N=10^12, M=10^6 result is **1966666166408794329** in every run.

## Workloads

- `polynomial`: 200,000 computed values with intermediates beyond safe Number,
  polynomial keys modulo 97, grouped sum. Both producers are deferred.
- `materialized`: the same calculation with ordinary assignments. Its completed
  arrays remain boundaries; the consumer can still read their exact wide values.
- `stored`: Int32 ones and completed modulo keys, controlling the existing path.
- `scan`: wide computed values and duplicate keys, observing the final grouped
  prefix value. Scan still materializes its required output.
- `euler326`: the same vector/plan histogram algorithm on both versions, first
  M=100,000 and then M=1,000,000. This is a compiler control, not a claim that
  the unchanged scalar row-formula production demo became faster.

## Small-series execution medians

| Host | Case | Engine | Baseline ms | Candidate ms | Candidate / baseline |
| --- | --- | --- | ---: | ---: | ---: |
| mac | polynomial | reference | 67.25 | 41.55 | 0.618 |
| mac | polynomial | compiled | 45.13 | 43.17 | 0.957 |
| mac | materialized | reference | 35.23 | 28.58 | 0.811 |
| mac | materialized | compiled | 24.66 | 21.17 | 0.859 |
| mac | stored | reference | 14.33 | 9.46 | 0.660 |
| mac | stored | compiled | 10.41 | 10.78 | 1.036 |
| mac | scan | reference | 60.05 | 38.45 | 0.640 |
| mac | scan | compiled | 42.95 | 38.70 | 0.901 |
| mac | euler326 | reference | 502.71 | 335.52 | 0.667 |
| mac | euler326 | compiled | 357.09 | 335.06 | 0.938 |
| intel | polynomial | reference | 194.25 | 118.69 | 0.611 |
| intel | polynomial | compiled | 132.62 | 114.57 | 0.864 |
| intel | materialized | reference | 82.74 | 70.11 | 0.847 |
| intel | materialized | compiled | 47.76 | 44.59 | 0.934 |
| intel | stored | reference | 34.06 | 22.04 | 0.647 |
| intel | stored | compiled | 23.37 | 24.28 | 1.039 |
| intel | scan | reference | 157.45 | 104.95 | 0.667 |
| intel | scan | compiled | 114.97 | 106.98 | 0.931 |
| intel | euler326 | reference | 1410.87 | 936.64 | 0.664 |
| intel | euler326 | compiled | 956.66 | 915.34 | 0.957 |

The compiled stored-Int32 control is about 3–4% slower in these samples
on both hosts (roughly 0.4 ms on Mac and 0.9 ms on Intel). The broader producer
coverage does not imply that every existing workload gets faster.

## Small-series memory medians

| Host | Case | Engine | Peak RSS MiB, base → new | Sampled allocation MiB, base → new |
| --- | --- | --- | ---: | ---: |
| mac | polynomial | reference | 176.0 → 174.4 | 195.9 → 71.2 |
| mac | polynomial | compiled | 175.8 → 175.4 | 71.5 → 72.0 |
| mac | materialized | reference | 172.2 → 183.8 | 39.8 → 31.8 |
| mac | materialized | compiled | 159.6 → 171.0 | 26.4 → 16.6 |
| mac | stored | reference | 159.7 → 170.1 | 21.5 → 0.8 |
| mac | stored | compiled | 160.0 → 168.9 | 1.0 → 0.8 |
| mac | scan | reference | 180.4 → 174.2 | 114.9 → 62.4 |
| mac | scan | compiled | 175.5 → 175.3 | 61.8 → 63.5 |
| mac | euler326 | reference | 290.1 → 208.6 | 1593.3 → 493.9 |
| mac | euler326 | compiled | 210.2 → 210.2 | 535.5 → 496.0 |
| intel | polynomial | reference | 160.1 → 159.1 | 200.2 → 74.3 |
| intel | polynomial | compiled | 159.9 → 159.7 | 72.7 → 72.7 |
| intel | materialized | reference | 155.9 → 156.4 | 47.0 → 36.2 |
| intel | materialized | compiled | 146.7 → 145.2 | 28.8 → 17.4 |
| intel | stored | reference | 144.6 → 144.4 | 22.0 → 1.0 |
| intel | stored | compiled | 144.5 → 144.3 | 1.1 → 1.0 |
| intel | scan | reference | 165.1 → 159.5 | 118.1 → 62.5 |
| intel | scan | compiled | 158.5 → 160.0 | 62.4 → 62.2 |
| intel | euler326 | reference | 275.8 → 195.6 | 1604.9 → 496.3 |
| intel | euler326 | compiled | 199.9 → 196.6 | 531.5 → 494.8 |

## Full Euler 326 medians

| Host | Engine | Time ms, base → new | Peak RSS MiB, base → new | Sampled allocation MiB, base → new |
| --- | --- | ---: | ---: | ---: |
| mac | reference | 5235 → 3348 | 489.4 → 441.9 | 15878.4 → 4824.7 |
| mac | compiled | 3731 → 3327 | 484.2 → 458.9 | 5212.1 → 4827.3 |
| intel | reference | 14279 → 9381 | 480.4 → 474.5 | 15896.4 → 4828.7 |
| intel | compiled | 9730 → 8843 | 458.7 → 467.4 | 5209.0 → 4828.1 |

These are three-sample medians, not universal speed or memory bounds. Peak RSS
does not track cumulative allocation: V8 collection timing and retained backing
stores can keep RSS flat or higher even when allocation falls. Read those columns
independently. All samples, including slower observations, remain in the raw data.

## Verification and limits

Mac and Intel: TypeScript project builds and 282 tests across 15 focused files
passed on the integrated sources. This includes independent BigInt oracles,
widening, duplicate-key scans, repeated consumers/effects, opaque host reads,
alias snapshots, error precedence, cancellation, bounded demand, tensor views,
and the integrated vector-slice/Euler 388 regressions. Semantic-boundary checks
(11 tests, 65 owners) and both application-form checks passed. No exhaustive
audits or full suite were started.

The reference engine shares the native reader and integer group kernel but
retains independent statement/control execution. Tests therefore use independent
exact calculations rather than treating reference/compiled agreement as proof.

Ordinary assignments, effectful consumers, opaque host inputs, observable polling
and bounded demands preserve their existing boundaries. Unsupported IR nodes,
real/mixed producers and scatter mutation ordering retain their existing paths;
see [tensor fusion coverage](../docs/design/tensor-fusion.md#integer-producers-into-grouped-consumers).

## Reproduction

Build both checkouts with `npm run langium:generate` and
`node node_modules/typescript/bin/tsc -b tsconfig.build.json`, using the same Node.
From the candidate root:

```sh
node benchmarks/producer-consumer.mjs --baseline=/path/to/baseline --samples=3
EULER_M=1000000 node benchmarks/producer-consumer.mjs --baseline=/path/to/baseline --cases=euler326 --samples=3
```

Raw observations:

- [mac, small](baselines/2026-11-04-producer-consumer-mac-small.json)
- [mac, full](baselines/2026-11-04-producer-consumer-mac-full.json)
- [intel, small](baselines/2026-11-04-producer-consumer-intel-small.json)
- [intel, full](baselines/2026-11-04-producer-consumer-intel-full.json)

Runtime-source SHA-256 (sorted paths relative to `packages/interpreter/src`,
NUL separator, then file bytes):

- Baseline: `b8a7d06f1fd0665718ecebdc36a091b829c113f5682bdac9a274a26e4e67b3a9`.
- Candidate: `a5f9dcb31ab5de55403d0e9f1c8efbafd7848359e6823b9d63fcbc1348a0740d`.
