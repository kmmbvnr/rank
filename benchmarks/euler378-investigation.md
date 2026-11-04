# Euler 378: remaining full-scale cost

Status: implemented, tested on Mac and Intel; production measurements below.
Issue: https://github.com/kmmbvnr/rank/issues/447
Baseline: `8fecf9229efb27da03ca75e4a8fbc037cfda0369` (the prior isolated
`80507fc9` runtime snapshot is identical in interpreter source).

## Delivered implementation and verification

The demo uses paired divisor updates, a histogram with exclusive prefix counts,
and one count Fenwick tree. It records the actual maximum to keep the tree and
prefix table compact, and uses N-1 rather than a separate Seen counter. Small
fixtures include limits 0/1/2/20/100/1000. The full golden remains
`147534623725724718`.

The production backend differs from the investigation loader: it snapshots the
existing native Float64 value/tree buffers directly rather than rebuilding the
tree. Native identity and method descriptors are checked before entry; wide
buffers remain on exact execution. Aliases share one snapshot. Both copied
buffers count toward the existing 64-cell / 262144-cell copy/work policy; proven
long traversals amortize larger copies. No thresholds were changed. Errors and
atomic cancellation publish preceding tree, array, index and scalar stores;
overflow discards the private tree before exact replay. Snapshot copying polls
for cancellation. Demand budgets, custom host polling and inspection retain the
publishing backend. Wide scalar accumulation still uses BigInt.

The completed core is in `86ecc924`. Measurements below use an isolated runtime
with only the Euler 378 changes; integration is also checked against the shared
main revision. The follow-up integration run passes 62 focused tests and the
new full-scale golden test (only Euler 378 selected from that file).

Mac: 1016 focused tests across 18 files pass. Intel: 144 tests across 6 files
pass. Both hosts pass 96 independent small-oracle comparisons each, plus 58
embedded test executions across 10 Fenwick demo fixtures in both engines.
TypeScript source and test builds pass. The new full-size golden is run by
itself; no exhaustive audits or full npm test run were started.

Three alternating fresh-process samples at Limit=10000000 distinguish compiler
and demo changes; time includes parsing, peak RSS is whole-process high water:

| Host | Variant | Median seconds (range) | Median peak RSS MiB |
| --- | --- | ---: | ---: |
| mac | baseline | 6.572 (6.148–8.211) | 260.3 |
| mac | compiler-only | 2.094 (2.059–3.077) | 262.1 |
| mac | combined | 2.139 (2.107–2.650) | 218.0 |
| intel | baseline | 18.750 (18.603–19.760) | 245.4 |
| intel | compiler-only | 7.596 (7.515–7.829) | 240.6 |
| intel | combined | 6.427 (6.279–6.440) | 205.0 |

Compiler-only means the original demo with the new backend. Combined means the
new demo and backend. On Mac the compiler-only and combined times are similar;
the demo's memory reduction is separate from the compiler's speedup. Intel also
benefits from the demo rewrite. Shared-machine timing varies, so raw ranges are
retained.

Full Limit=60000000: original baseline controls are single samples from the
investigation; delivered values are medians of three fresh processes:

| Host | Original seconds / MiB | Delivered seconds (range) / MiB |
| --- | ---: | ---: |
| mac | 45.345 / 687.5 | 16.641 (16.413–17.147) / 409.3 |
| intel | 122.154 / 667.1 | 41.211 (41.209–42.055) / 399.4 |

Every delivered full run reports one mixed region, zero overflows and the same
full golden. Peak memory falls by about 40% versus those original controls.
The dense divisor array is still O(N) and alone needs 240000008 bytes; this is
not a claim of sublinear memory. Full reference execution remains excluded,
with small fixtures retained. The earlier prototype timings below are not the
production medians.

Reproduce the delivery comparison with RUNTIME pointing at a built new runtime
and BASELINE_RUNTIME at the archived old runtime:

```sh
node benchmarks/experiments/euler378-delivery-series.mjs /tmp/euler378-delivery.json
node benchmarks/experiments/euler378-verify.mjs
```

Raw delivery samples, independent oracle results and embedded fixture results:
`baselines/2026-11-04-euler378-delivery.json`.

## Original investigation findings

The earlier runtime work already compiles the divisor sieve, maximum pass and
exact Fenwick pass. It did not eliminate the large 60-million-element workload.
The original uses one additive divisor sieve, scans triangular divisor counts
for their maximum, then maintains count and pair Fenwick trees.

A full profiled Mac run returned `147534623725724718` in 46.326 s at 699.7 MiB
peak RSS. Stage boundaries were 8.665 s after the sieve and 8.989 s after the
maximum pass: about 37.3 s remained in the final exact tree pass. Profiler
self-time includes 5.8 s in Fenwick position checks, 4.9 s in generated private
field access helpers, 4.0 s in set and 3.1 s in sum. These are sampled costs,
not mutually exclusive causal speedups.

The Fenwick class internally stores safe integers as Float64 and widens to
BigInt when needed, but its public read/write interface uses BigInt. The
compiler explicitly excludes Fenwick from Number regions in expression reads,
writes and runtime container admission. Consequently loop indices, triangular
divisor products and tree interfaces remain exact BigInt operations, even
when their values fit safely in Number. This is a general compiler opportunity,
not a demo-specific intrinsic.

## Algorithm variants

- `euler378-original.ra`: unchanged baseline plus optional stage comments.
- `euler378-paired.ra`: count divisors in pairs up to sqrt(Max), following the
  existing Euler 179 demo. The square gets one contribution, later multiples
  get two. This reduces sieve updates but does not address the dominant tree
  pass. A separate `Root` binding matters: `1 to Max isqrt` transforms the
  range, so it is not equivalent to `1 to (Max isqrt)`.
- `euler378-one-tree.ra`: the paired sieve, a frequency histogram and one
  count Fenwick tree. For a middle element V, let Before be the number of
  earlier values <=V. The choices for the first index are Seen-Before; the
  choices for the third are totalLess[V]-Before+seenEqual[V]. Their product
  counts exactly the strictly descending triples with this middle index.
  `scan + with 0` gives exclusive prefix counts. Products are accumulated
  exactly modulo 10^18.
- `euler378-bounded-tree.ra`: also records the actual maximum during histogram
  construction, and limits the prefix table and tree to that maximum. At full
  scale the conservative histogram bound is 451584, while the actual maximum
  is 23040; the prefix shrinks from 451586 to 23042 cells.
- `euler378-final-mod.ra`: compute a separate numeric triple product and apply
  the modulus only after the loop. No compelling win; triggers one speculative
  overflow/replay and increases observed peak RSS. Not recommended.

The paired sieve is O(N log N) with roughly half the leading update count.
The one-tree solution retains O(N log Top) counting with fewer tree queries
and writes. The dense divisor array remains O(N); its Int32 storage alone is
240000008 bytes at the default limit. No claim of sublinear memory is made.

## General compiler prototype

`euler378-number-fenwick.mjs` is an experimental module loader; it does not
modify interpreter source. It admits trusted native Fenwick containers to a
Number/mixed region using a private numeric tree snapshot. Aliases share one
snapshot. Safe reads/writes use Number and throw the existing overflow sentinel
when exact Number arithmetic is no longer possible. Successful/error publication
uses the existing region publication callback; overflow discards the snapshot
before replay. Wide scalar accumulation still uses the existing mixed BigInt
backend. Copy/work thresholds are unchanged.

The loader measures the initial performance potential, rather than supplying
the production API. The delivered backend above adds existing-buffer snapshots,
copy/work admission, cancellation polling and tests for aliases, wide/prefix
sums, protection, ordinary errors, publication, overflow replay, budgets and
modified methods. When loaded against the delivered runtime, the experiment
leaves the production backend unchanged.

## Verification and measurement

The independent oracle in `euler378-verify.mjs` trial-divides the triangular
numbers themselves, then explicitly enumerates triples. It does not reuse the
sieve or either Fenwick algorithm. Small inputs include 0, 1, 2, 3, 10, 20, 30
and 100, with both compiled and reference execution for source variants and
compiled execution for numeric prototypes. Full-input runs assert the existing
golden `147534623725724718`. Full reference remains impractical; exhaustive
audits were not run for this investigation.

Node 24.15.0, Apple M5 Mac and Intel `root@jack.lan`. Each measurement runs a
fresh process against an isolated baseline runtime, excluding unrelated shared
worktree changes. Time includes parsing, stage prints and optional diagnostics;
RSS is whole-process high-water RSS, not retained live memory. The original
full Mac control had CPU profiling enabled, so it is not a precise speedup ratio.
Full-size observations are single samples; the 10-million series provides
three alternating samples per selected variant. See raw data for all ranges.

## Results

Full input (60 million), single fresh-process observations, no CPU profiler
unless labelled above. Numeric prototypes retain a BigInt accumulator.

| Host | Variant | Seconds | Peak RSS MiB |
| --- | --- | ---: | ---: |
| mac | original-full | 45.345 | 687.5 |
| mac | one-tree-full | 35.958 | 464.5 |
| mac | number-full | 16.610 | 484.3 |
| mac | bounded-full | 16.156 | 411.4 |
| intel | original-full | 122.154 | 667.1 |
| intel | one-tree-full | 86.165 | 478.0 |
| intel | number-full | 41.172 | 485.7 |
| intel | bounded-full | 38.661 | 400.8 |

Ten-million input: three alternating fresh processes; median (range) seconds
and median peak RSS. The original Mac series varies noticeably under shared
machine load; do not infer a reliable algorithm-only speedup from its median.

| Host | Variant | Seconds (range) | Peak RSS MiB |
| --- | --- | ---: | ---: |
| mac | original | 6.462 (6.075–8.292) | 263.2 |
| mac | one-tree | 6.347 (4.841–7.154) | 225.1 |
| mac | number-one-tree | 2.338 (2.134–2.579) | 224.9 |
| intel | original | 19.209 (19.197–19.234) | 242.0 |
| intel | one-tree | 14.237 (14.093–14.739) | 211.9 |
| intel | number-one-tree | 6.793 (6.782–6.831) | 213.6 |

Both hosts passed 80 independent small-oracle comparisons each. Every full run
in the table returned `147534623725724718`. The compact tree's full Mac run
reported one mixed region and no numeric overflow; its final prefix table has
23042 cells. RSS differences include GC, read buffers and private snapshots;
not all savings can be attributed to the size of the Fenwick tree itself.

A same-original-source numeric-tree control on Mac took 16.595 s / 691.8 MiB.
Thus most full-input runtime gain is available through a general compiler fix;
the algorithm rewrite is still useful for memory. The bounded-tree prototype
combines both improvements. Moving the modulus out of the loop did not add a
useful win: Mac 16.964 s / 514.3 MiB with one overflow/replay, versus the ordinary
numeric one-tree 16.610 s / 484.3 MiB. Keep the simpler modulo-per-iteration form.

Small reference control at Limit=10000 (one sample each): original 0.494 s /
285.7 MiB; bounded-tree source 0.320 s / 191.1 MiB, same answer 14544175026.
No full-reference timing or acceleration claim is made.

The investigation recommended the compact histogram/one-tree demo plus
transactional native Fenwick support in the existing Number/mixed compiler,
with exact fallback and publication tests. The delivered implementation above follows this approach. Do not add a task-specific kernel,
raise speculative-copy limits, or remove cancellation and overflow guarantees.

Reproduce from repository root, pointing RUNTIME at an isolated built interpreter:

```sh
node benchmarks/euler378-investigation.mjs benchmarks/experiments/euler378-original.ra 60000000
node benchmarks/experiments/euler378-number-fenwick.mjs benchmarks/experiments/euler378-bounded-tree.ra 60000000
node benchmarks/experiments/euler378-series.mjs 10000000 3 /tmp/euler378-series.json
node benchmarks/experiments/euler378-verify.mjs
```

Optional `STAGES=1`, `MEMORY=1`, `DIAG=1`, and `PROFILE=/tmp/euler378.cpuprofile`
add phase timing, storage metadata, compiler counters and a CPU profile.
Raw observations and oracle results are in
`baselines/2026-11-04-euler378-investigation.json`.
