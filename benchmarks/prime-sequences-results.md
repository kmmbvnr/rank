# Segmented prime sequences (#310)

Measured on 2026-10-18, Node 24.15.0, Apple M5. Baseline runtime: `773832ca`.
Candidate runtime: `39e7bd8a`, plus the Euler 136 source change in this delivery.
The benchmark asserts every answer and uses three fresh processes per variant.
Execution includes parsing; cold time also includes startup, imports and disposal.
These are medians, in seconds, on this reference machine; CI does not enforce
machine-dependent timing limits.

| Case | Runtime | Execution | Cold process |
|---|---|---:|---:|
| count-50M | candidate | 0.557 | 0.809 |
| count-50M | baseline | 8.332 | 8.596 |
| 136-original | candidate | 1.919 | 2.196 |
| 136-original | baseline | 9.861 | 10.136 |
| 136-simplified | candidate | 1.740 | 2.005 |
| 136-simplified | baseline | 9.631 | 9.901 |
| bounded-membership | candidate | 0.278 | 0.535 |
| bounded-membership | baseline | 0.284 | 0.543 |
| huge-start | candidate | 0.149 | 0.402 |
| huge-start | baseline | 0.149 | 0.407 |

The 50M count is **3,001,134** and meets the 1.5 s target, including cold startup
on this machine. Euler 136 returns **2,544,559**. `136-original` is the frozen
pre-change source, allowing the sieve's benefit to be separated from the small
source simplification. `136-simplified` starts after 2 and removes the odd-prime
mask and two mask conjunctions. Both formulations still materialize the primes.

Bounded membership counts primes below one million (78,498) using the plan's
segment cache. Huge-start searches still return `1000000000000000003` and
`1000000000000000009`; tiny timing differences there are noise, not a claimed
speedup. No peak-heap or allocation measurements were taken. The engine retains
one 4 KiB bit segment and a base-prime table with a fixed upper limit per
workspace; materialized results and multiple observers have their own costs.

Run after building:

```sh
node benchmarks/prime-sequences.mjs
node benchmarks/prime-sequences.mjs --baseline=/path/to/old/packages/interpreter/out/index.js
```

`--cases=count-50M,huge-start` selects cases; `--trials=1` shortens an exploratory
run. The benchmark checks the candidate count's median execution time against
1.5 s; performance comparisons should use the same otherwise idle machine.
Raw samples: [JSONL](baselines/2026-10-18-prime-sequences.jsonl).

## Verification after main integration

Before merging, `main` advanced to `6c0fbbb4` (#327, graph traversal refactor).
It was integrated in `efddb703`; the runtime source was then rebuilt and the
focused prime/graph suites passed (145 tests). A fresh three-trial repeat on
that combined runtime gave:

| Case | Execution | Cold process |
|---|---:|---:|
| count-50M | 0.551 | 0.803 |
| 136-simplified | 1.695 | 1.966 |
| huge-start | 0.149 | 0.404 |

All answers and the generation target passed again. The four Euler 136 demo
tests passed after integration. These measurements verify the combined runtime;
the earlier baseline comparison remains separate.
[Repeat samples](baselines/2026-10-18-prime-sequences-final.jsonl).
