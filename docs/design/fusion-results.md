# Fusion delivery and worker recheck

The planned copy, readable-intermediate, broadcast, ranked-window and profiled
axis-statistics stages are merged into main. No Rank syntax changed. Each stage
has reference comparisons, focused measurements and demo validation.

| Delivered stage | Merge | Evidence |
| --- | --- | --- |
| Explicit copy and private named intermediates | f12fca9 | [Copy report](array-output-fusion.md) |
| Broadcast expression domains | a0eaba9 | [Broadcast and profile report](fusion-domains.md) |
| Window geometry and ranked cell folds | 824a627 | [Window report](window-reduction-fusion.md) |
| Axis mean/std reader and arithmetic fusion | f20b665 | [Axis report](axis-statistics-fusion.md) |

These stages improve the supported computation paths; they do not claim that
every possible producer, function, axis combination or terminal is compiled.
Unsupported cases continue to use ordinary execution.

## Measured outcomes

- Explicit polynomial copy on 1M real cells: about 232 to 9.3 ms.
  Inline returns, assigned results and private named intermediates all use the
  compiler.
- Matrix/vector normalization with explicit copy, 32768 by 32:
  about 308 to 9.37 ms.
- Original Euler 8, including parsing: about 2.1 to 1.5 ms.
  The window/product/max fixture on 100K digits improves from 171 to 105 ms.
- Unchanged PCA with 2048 two-feature observations: about 232 to 163–165 ms.

Each result belongs to its stated fixture. They are not multiplicative speedups
and do not establish a similar acceleration for all programs. The final two
whole-demo runs took 27.47 and 27.04 seconds. All 1189 tests in 341 files passed
with identical output digests to the previous stage. The full TypeScript suite
passed at the final code revision: 1044 tests.

## Workers after fusion

The original opt-in worker benchmark from `ffee766` was copied unchanged into
an isolated checkout of `f20b665`. The benchmark's own correctness tests passed.
Two runs used Node 24.15.0 on Apple M5, five alternating samples per case,
persistent workers, ordinary JS arrays and structured cloning.

| Operation | Local, ms | Four workers, round trip, ms | Four workers, resident input, ms |
| --- | ---: | ---: | ---: |
| Polynomial, 1M real cells | 13.56 / 13.59 | 60.84 / 59.83 | 49.87 / 51.60 |
| Exact integer sum, 1M cells | 2.95 / 3.18 | 15.52 / 15.84 | 1.18 / 1.31 |
| Matrix multiply, 256 by 256 | 175.12 / 180.29 | 76.26 / 75.57 | 70.82 / 72.95 |
| Window/product/max, 100K digits | 116.95 / 115.55 | 35.84 / 35.35 | 32.17 / 32.28 |

The worker benchmark copies array results into a plain return envelope even in
the local case. That accounts for a different boundary from the 9.3 ms standalone
copy benchmark. Resident timings exclude the initial upload, include returned
results, and have nearby local controls in the raw data.

Creating and preparing the four-worker pool took 153.87 and 164.34 ms. These
costs are excluded from the warm table. The original worker result was about
252 ms locally versus 92 ms with four workers for the polynomial; fusion has
reversed that choice. Even resident inputs do not make this cheap map worth
shipping back as a large result.

Heavy independent matrix and window calculations still benefit with an already
running pool. Integer sums need repeated resident use to amortize the upload.
No automatic scheduler or asynchronous interpreter API is introduced.
Desktop crossover measurements are not mobile/browser defaults.

Raw runs are
[run one](../../benchmarks/baselines/2026-09-12-workers-after-fusion.json) and
[run two](../../benchmarks/baselines/2026-09-12-workers-after-fusion-repeat.json).

To reproduce without adding experimental runtime code to main, create an
isolated checkout of `f20b665`, restore `benchmarks/tensor-workers` from
`ffee766` into that checkout, build, then run:

```sh
node --test benchmarks/tensor-workers/test.mjs
node benchmarks/tensor-workers/bench.mjs
```

## Remaining local cost

A separate CPU profile of 201 completed polynomial copies attributes about
976 ms of 1887 ms sampled time to `containedFiles`, about 607 ms to anonymous
generated code, and about 66 ms to garbage collection. It includes startup,
input construction and one full oracle comparison; it is not a guard-only
microbenchmark.

The resource-escape scan remains necessary for generic mutable arrays. A
permanent file-free flag on a writable copy would become incorrect if a later
write inserted a file. Mutation-aware resource metadata or a narrower lifetime
proof is a separate next optimization. No ownership checks were disabled.

Reproduce with:

```sh
node --cpu-prof benchmarks/profile-array-copy.mjs
```

The [saved CPU profile](../../benchmarks/baselines/2026-09-12-copy-final.cpuprofile)
can be opened in a compatible profiler.

## Follow-up boundaries

The delivered stages preserve lazy reads, arithmetic order, BigInt precision,
error precedence, observable intermediates and writable copy storage.

The optional proposal to cache already-read axis cells remains undecided.
Current axis reads still recompute after source mutation. This semantic change
was not required for the delivered optimization and was not made.

Further compiler coverage, dense matmul kernels and resource metadata can follow
new profiles. Generalizing all operators or making workers automatic remains
future work, as intended by the incremental architecture.
