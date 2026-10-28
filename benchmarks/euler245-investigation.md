# Euler 245: keep bounded comparisons in the Number loop

The full default `Limit = 200000000000` and exact answer `288084712410001`
are preserved. Six executable source lines change; the existing sieve,
divisor enumeration and explicit DFS remain. No compiler threshold or runtime
arithmetic contract changes.

## Diagnosis and change

The original program compiles, but its 3+-prime search overflows safe Number
arithmetic on products used only to reject candidates. A scratch generated-code
probe identified `M * Q * Q` (about 1.383e19), then `M * P` (about 1.777e16).
The normal mixed-scalar retry also overflows and falls back to exact BigInts.
The original full run records two Number overflows; the final program records
zero. Scratch runtime instrumentation was restored before measurements.

For positive integer operands, compare before multiplying:

```
M * P <= Limit     -> P <= Limit // M
M * Q * Q > Limit  -> Q > (Limit // M) // Q
Mm * Q > Limit    -> Mm > Limit // Q
```

The compiler's conservative fallback is correct. Handling wide comparison
intermediates without restarting an entire region remains a possible compiler
optimization; this change does not establish or repair a compiler correctness bug.

Every composite solution is odd: for even composite n, n-phi(n) is even and
cannot divide odd n-1. For odd composite n, n-phi(n) is odd and k is even.
Both candidate loops can therefore advance k by two.

For n=pq, let a=p-k and b=q-k. Then ab=k^2-k+1, and
n=k(a+b)+2k^2-k+1 > (2k-1)^2. Thus k<(sqrt(Limit)+1)/2;
`Kk=(Rt+1)//2`, with `Rt=isqrt(Limit)+1`, is a conservative upper bound.
This reduces the polynomial-factor sieve range and its buffers as well as work.

## Measurements

Node v24.15.0, macOS arm64. Fresh sequential processes, import excluded,
parsing/preparation/diagnostics included. Research timings include phase marker
prints. Before/after process snapshots capture background CPU use; they cannot
prove uninterrupted exclusive machine access. The full original is a single
sample in each cohort, not a repeated median.

Fresh runtime built from research parent `58d5d399`:

| Variant | Full compiled samples (seconds) | Median peak RSS (MiB) |
|---|---:|---:|
| Original | 103.448 | 431.14 |
| Division guards | 10.995 / 11.040 | 417.63 |
| Guards + even k + smaller semiprime range (selected) | 5.554 / 5.621 | 362.56 |
| Above + distinct-prime pruning | 5.537 / 5.535 / 5.496 | 368.19 |

The selected median is 5.588 seconds: about **18.5x** faster than that original
control, with about **16% less peak RSS**. The more complex distinct-prime bound
saves under one percent in this cohort, so retain the simpler source.

Delivery rebuilt from `252ca49d`, including the subsequent parser changes:
clean controls are original **102.202 s**, final **5.512 s**, both with the full
answer. Later final samples **5.724 s** and **6.349 s** overlapped an external
Euler 248 Node profiler. Both are retained with `contended: true` and excluded
from speed claims. Do not pool these runtime cohorts or interpret the contended
runs as a regression. This is not an Intel performance claim.

## Verification and corpus coverage

- Fresh Langium generation and TypeScript project build pass on the delivery parent.
- An independent totient sieve through 10^7 supplies expected sums at eleven
  limits, including 14/15 and 84/85. The final Rank program matches every result.
- The full compiled default returns `288084712410001`, matching the original.
- The existing fixture retains all three limits (10^5, 10^7, 10^9); a new block
  checks the four semiprime boundaries. Both blocks pass compiled and reference.
- The fixture is removed from execution exclusions. The full default program's
  historical reference execution-budget exclusion is retained: a new full
  reference run is not claimed. The original “30 min” fixture comment is replaced
  with the reason for retaining small limits.
- Focused corpus differential/type audits use the existing type-audit runner;
  execution-exclusion checks and JavaScript syntax checks also pass.
- No full interpreter suite is claimed for this demo-only change.

Raw samples, source snapshots/hashes, load snapshots, oracle results, fixture
results and verification logs are in
`baselines/2026-10-28-euler245-investigation.json`.

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler245-coresilience.mjs
node benchmarks/euler245-coresilience.mjs --original
node benchmarks/euler245-coresilience.mjs --fixture
node benchmarks/euler245-coresilience.mjs --fixture --reference
node benchmarks/experiments/euler245-totient-oracle.mjs
node --test scripts/demo-execution-exclusions.test.mjs
node node_modules/vitest/vitest.mjs run \
  packages/interpreter/test/differential.test.ts \
  packages/interpreter/test/types.test.ts -t 'euler/245_' \
  --config packages/interpreter/scripts/type-audit.config.mjs \
  --maxWorkers=1 --minWorkers=1
```

Use `--runtime=/absolute/path/to/packages/interpreter/out/index.js` to benchmark
a separately built runtime. `--variant=guards`, `prune` or `distinct` selects
captured research sources; `--Limit=100000` selects an input.
