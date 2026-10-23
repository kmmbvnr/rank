# Quadratic factorization and Euler 343

Measured on Apple M5, Node v24.15.0, on 2026-10-23. Baseline runtime:
`919aaa0d`. Each timing is the median of three fresh processes, except the
explicitly labelled single interpreted run. Execution timings include parsing,
allocation and table construction; module loading is outside the timer.
The benchmark asserts the checksum for every sample.

## Shared factorization mechanism

The `native` workload calls the exported `Factorizer` from JavaScript for both
`k+1` and `k*k-k+1`. The `factors` workload runs the original Rank program with
its scalar helper replaced by `factors max`, with a separate result of 1 for
input 1. These comparisons keep the algorithm fixed between runtimes.

| Limit | Workload | Before | After | Speedup |
| ---: | --- | ---: | ---: | ---: |
| 10,000 | Native Factorizer | 76.784 ms | 32.830 ms | 2.34x |
| 10,000 | Rank `factors max` | 430.588 ms | 391.993 ms | 1.10x |
| 100,000 | Native Factorizer | 4,999.982 ms | 437.588 ms | 11.43x |
| 100,000 | Rank `factors max` | 6,986.829 ms | 2,605.779 ms | 2.68x |

Small factors still stream out immediately. Residues below `2^20` use the
existing bounded table. Larger residues below `2^64` use the existing exact
Miller-Rabin test, then Pollard-Brent when composite. The tail is sorted before
being yielded, preserving ascending factors and repetitions. Above this range,
trial division remains exact and can enter either faster path as the residue
shrinks. Cancellation leaves no partial factorization cache.

## Dense quadratic range

The demo now sieves quadratic values together instead of factoring each one.
For a discovered prime P at index K, its two root progressions are K and
P+1-K modulo P. Each visit removes all copies of P and records the largest
factor seen. The double root modulo 3 is visited once.

Why the discovered residue is prime: a prime divisor P below 2*K-1 has a root
at an earlier index (the smaller root is at most (P+1)/2), so it has already
been removed. Two remaining prime factors, counting repetitions, would have
product at least (2*K-1)^2, greater than K*K-K+1 for K >= 2. The residue is
therefore either 1 or a prime. A separate ordinary prime sieve computes the
largest factors of k+1. The final reduction uses exact integer arithmetic.

| Runtime / program | Limit | Time | Comparison |
| --- | ---: | ---: | --- |
| Baseline / original program | 10,000 | 621.927 ms | Baseline |
| Current / quadratic sieve | 10,000 | 165.638 ms | 3.75x overall |
| Current / `factors max` | 100,000 | 2,605.779 ms | Before demo algorithm change |
| Current / quadratic sieve | 100,000 | 211.513 ms | 12.32x for demo algorithm change |
| Current / quadratic sieve | 2,000,000 | 1,104.447 ms | Full range, 3 samples |
| Current / quadratic sieve, compilation disabled | 2,000,000 | 39,482.467 ms | Full range, 1 sample |

All full runs produced `269533451410884183`. The compiled full-run median
CPU time was 1,367.657 ms; peak RSS ranged from 392.7 to 398.3 MiB. This change
establishes speed and exact results, not a reduction in memory consumption.
The full original program was not run; no full-range speedup is claimed.
The default workload remains excluded from broad corpus execution because
of its array allocations and the interpreted runtime cost.

## Independent correctness checks

`quadratic-factors-oracle.py` sieves by primes in ascending order, obtains
quadratic roots from modular cube roots of unity, and handles residual prime
cofactors in a final pass. It uses Python integer arithmetic and independently
confirmed the full checksum in 1.785 seconds (one run). The Rank tests compare
every quadratic largest factor through k=1,000 and every sum prefix through
100 with independent trial division in both execution modes. Scalar tests cover
64-bit primes, signed/unsigned boundaries, semiprimes, repeated factors, a
strong pseudoprime, cancellation during the Brent walk, and arbitrary-precision
streaming. Existing bounded-factorization and Euler 302 checks are retained.

## Reproduction

Build with `npm run build`. Keep a built baseline interpreter to compare the
shared mechanism, then run:

```sh
node benchmarks/quadratic-factors.mjs --variants=manual,factors,native --limit=10000 --runtime=/path/to/baseline/out/index.js
node benchmarks/quadratic-factors.mjs --variants=factors,native,demo --limit=10000
node benchmarks/quadratic-factors.mjs --variants=factors,native --limit=100000 --runtime=/path/to/baseline/out/index.js
node benchmarks/quadratic-factors.mjs --variants=factors,native,demo --limit=100000
node benchmarks/quadratic-factors.mjs --variants=demo --limit=2000000
node benchmarks/quadratic-factors.mjs --variants=demo --limit=2000000 --compilation=false --trials=1
python3 benchmarks/quadratic-factors-oracle.py 2000000
npm test --workspace @arrrank/interpreter -- test/factorization.test.ts test/quadratic-factors.test.ts test/prime-membership.test.ts test/interrupt.test.ts
```

Raw samples are under `benchmarks/baselines/2026-10-23-quadratic-*.jsonl`.
