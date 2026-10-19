# Compiled collection operations and Euler 60

Measured 2026-10-19 on Apple M5 / Node v24.15.0. Baseline runtime:
`bc704760b4e917cfe675238be5174719fc38192f`; candidate runtime:
`90e3efbd` (subsequent delivery commits add tests, documentation and this
benchmark only). The original `demos/euler/060_primepairs.ra` is unchanged.

Three alternating, serial fresh processes per runtime, with no concurrent build,
test or profiler. Each sample checks `Upper = Answer = 26033` and the seed prime
count of 1227. Execute times include parsing and preparation of each phase. Cold
process time is measured by the parent around process creation, execution,
validation and disposal, including module loading and setup of demo definitions.
Diagnostics run separately after the timed series.

| Phase | Baseline median | Candidate median |
| --- | ---: | ---: |
| Seed build | 0.602 s | 0.581 s |
| Seed search | 0.842 s | 0.778 s |
| Full build | 2.712 s | 2.613 s |
| Full search | 0.944 s | 0.832 s |
| Sum of four phases, median per sample | 5.095 s | 4.800 s |
| Cold process | 5.642 s | 5.391 s |

The measured phase-total reduction is about **5.8%**; cold-process reduction is
about **4.5%**. Every candidate phase-total sample was below every baseline
sample in this local series. These are modest gains and are not portable timing
thresholds. The increase in compiled-loop count does not imply an equivalent
speedup: array operations, graph storage, primality checks and the recursive
search still contribute substantial work.

The separate diagnostic runs reported:

| Counter | Baseline | Candidate |
| --- | ---: | ---: |
| Compiled loop regions executed | 2 | 4091 |
| Prepared integer membership filters | unavailable | 18596 |
| Compiled graph-add calls | unavailable | 89749 |
| `scalar-expression:unsupported-op:in` fallbacks | 37195 | 3 |

The remaining three `in` fallback probes are outside the prepared search filters;
this change does not claim to compile every top-level membership expression or
the entire recursive search. The reduced issue snippets independently assert the
new filter path, Number suffix traversal and exact graph-mutation region.

Array-domain filter lookups use a Set with space proportional to distinct domain
values, once per filter evaluation; mask storage is proportional to array source
length. Number suffix traversal reuses its invocation-owned source buffer.
Graph neighbor membership adds a lazily built index over the immutable snapshot.
Captured array membership in scalar kernels uses the shared generic lookup at
its actual expression to observe COW binding changes. No global membership
index or retained numeric mirror is introduced. Peak heap/RSS was not measured,
and no overall memory reduction is claimed.

Raw samples: [2026-10-19-collection-loops.jsonl](baselines/2026-10-19-collection-loops.jsonl).

Reproduce after building both revisions independently:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/collection-loops.mjs --baseline=/absolute/path/to/baseline/out/index.js
```

Use `--trials=1` for a smoke run. The default is three timed samples per runtime
plus a separate diagnostic run per runtime. Worker failures, wrong answers and
missing candidate filter/graph execution counters fail the benchmark.
