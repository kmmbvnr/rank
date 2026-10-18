# Integer slice writes: measured results

Apple M5 / v24.15.0; three fresh processes per case and runtime, alternating order. Baseline `b3d7e208`; runtime/demos `198992e0`. The final documentation/report commit changes no runtime source.

Run after building both checkouts:

```sh
node benchmarks/slice-writes.mjs --baseline=/path/to/baseline --samples=3
```

Raw samples, hashes, peak RSS and separate microbenchmark instrumentation are in [slice-writes-results.json](slice-writes-results.json). Every process verifies its answer. Timed executions do not enable counters or profiling.

## Slice workloads

Execute time includes the first parse, allocation, updates and final checksum; imports and process startup are excluded. Full-process wall time includes the benchmark child startup and imports as well. The agreed 5x improvement criterion applies to execute time; cold launch is reported independently.

| Case | Baseline execute ms | New execute ms | Speedup | Baseline wall ms | New wall ms | Wall speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| scalar | 376.2 | 349.3 | 1.08x | 634.5 | 599.3 | 1.06x |
| range | 4462.8 | 447.3 | 9.98x | 4732.2 | 698.9 | 6.77x |
| stride | 2283.9 | 355.7 | 6.42x | 2547.9 | 624.2 | 4.08x |
| indexed | 4141.5 | 628.9 | 6.59x | 4426.5 | 907.3 | 4.88x |
| plain | 3608.7 | 309.4 | 11.67x | 3883.0 | 572.6 | 6.78x |
| sieve | 11730.0 | 2166.1 | 5.42x | 12017.1 | 2430.6 | 4.94x |

The scalar case performs one pass; slice cases perform six. Ranges are inclusive: the full vector has 1000001 cells and a step-2 pass touches 500001. Instrumented runs assert 6000006 writes for each six-pass full-vector case, 3000006 for the strided case, and 12970034 writes across 500000 divisor-sum slices. The sieve checksum is 322467618437. These instrumentation runs are not timing samples.

| Case | Baseline peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: |
| range | 964.8 | 271.8 |
| stride | 590.4 | 236.0 |
| indexed | 1082.5 | 314.8 |
| plain | 928.3 | 180.4 |
| sieve | 874.0 | 512.6 |

Peak RSS is the median process high-water mark, including imports and temporary memory; it is not retained array size. Separate diagnostics confirm zero COW copies and zero retained-selection snapshots for these isolated microbenchmarks. This is not a claim that ordinary aliasing avoids COW.

## Euler demos

Both runtimes execute the same final source files. This table isolates the runtime change; the baseline columns are not timings of the previous matrix-based 73 or scalar-inner-loop 95 demos.

| Demo | Baseline execute ms | New execute ms | New full-process wall ms | Verified answer |
| --- | ---: | ---: | ---: | ---: |
| euler72 | 3659.0 | 1306.9 | 1611.0 | 303963552391 |
| euler73 | 255.7 | 222.8 | 482.0 | 7295372 |
| euler75 | 1910.9 | 758.6 | 1018.0 | 161667 |
| euler86 | 300.2 | 297.8 | 555.5 | 1818 |
| euler88 | 2983.6 | 2770.1 | 3033.6 | 7587457 |
| euler95 | 7495.5 | 3044.3 | 3322.2 | 14316 |

73 replaces the divisibility matrix with the Moebius sieve. 95 keeps the root-limited divisor-pair algorithm and expresses its inner update with index arrays. Existing slice-based 72/75 stay unchanged. Grouping in 86 and descending replacement order in 88 remain necessary: repeated-index compound assignment reads pre-write cells, and the last replacement wins.

## Limits and verification

- All four slice rows exceed 5x in execute time. Cold-process speedup is smaller: stride is about 4.1x and indexed about 4.9x. Fixed startup/parsing costs are not a per-element write bottleneck. No claim of a 5x cold-launch improvement is made.
- The sieve is below 3 seconds, including process startup. Demos 72/75/95 are each below 5 seconds including startup.
- All three samples and answers are retained; no slow samples were discarded. Timings are machine-specific and have no CI wall-clock assertions.
- The baseline is a separate clean checkout, not the independently changing shared development checkout. An earlier interrupted run against that shared checkout was discarded in full before these measurements.
- 3789 semantic unit tests passed in 197 files on the final runtime. An earlier run completed all assertions but hit a Vitest RPC timeout; its separate clean rerun exited successfully.
- All 19 checks across Euler 72/73/75/86/88/95 passed; TypeScript build, semantic-boundary checks and application-form checks passed.
