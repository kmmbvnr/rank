# Euler 680 / issue #497

Apple M5, Node v24.15.0. Three fresh processes per case, sequential, without diagnostics or a profiler. Timings include parsing and execution; imports and interpreter construction are outside the measured region. Raw samples and source hashes: [JSON](baselines/2026-11-01-euler680.json).

The baseline is commit `241708d2`, archived and compiled in an isolated temporary directory. Initial samples using the main working tree were discarded after concurrent Euler 309 work was detected.

| Change | Baseline median | Candidate median | Ratio |
| --- | ---: | ---: | ---: |
| Int64 prefix-sum microbenchmark | 53.46 ms | 35.01 ms | 1.53x |
| Euler 680, K=3200, Bt=800 (same algorithm) | 5938.56 ms | 6500.66 ms | 0.91x |
| Euler 680, K=3200 (rope algorithm) | 5938.56 ms | 171.49 ms | 34.63x |

The Int64 kernel helps the microbenchmark. The batched demo ranges overlap (baseline 5.78–6.04 s, candidate 5.97–9.80 s); these samples do not establish a whole-demo gain from scan alone. The algorithm change supplies the large improvement.

The full default (N=10^18, K=10^6) returns **563917241** in 21.79, 20.69, 28.78 s; median **21.79 s**. Peak RSS across those runs was 2.93 GiB. The issue's historical 80-minute full baseline was not rerun. At K=12800 the rope median was 0.302 s.

The rope is a persistent AVL tree with positional lengths and lazy reversal. Numeric range leaves keep first/step/count; ordinary data uses bounded chunks. Integer lengths and positions remain exact above 2^53. The demo performs O(K log K) structural work and then reduces the final runs analytically. It does not expand the logical 10^18-element sequence.

Reproduce from a built checkout:

```sh
node benchmarks/euler680.mjs scan
node benchmarks/euler680.mjs batched 3200 800
node benchmarks/euler680.mjs rope 3200
node benchmarks/euler680.mjs rope 1000000
# Use an independently built baseline interpreter for before timings:
RANK_BENCH_RUNTIME=/absolute/baseline/packages/interpreter/out/index.js \
  node benchmarks/euler680.mjs batched 3200 800
```

Validation: the workspace build, 225 focused interpreter tests, 387 language tests, three Euler 680 tests (including the default golden result), the original Rank fixture, and three exclusion-manifest tests passed. Semantic-boundary and application-form checks passed. The Euler tests include an independent flat-array oracle for small inputs with compilation on and off. Full npm test and corpus audits were not run.

After integration with main commit `4584dc82`, the build and all listed focused tests passed again. A separate fresh-process full run took **29.06 s**, returned **563917241**, and peaked at 2.90 GiB RSS. This verification run is recorded separately from the three-sample comparison.
