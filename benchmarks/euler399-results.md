# Euler 399 rank queries

The workload builds forbidden index moduli for the 100,000,000th squarefree
Fibonacci number: index bound 200,000,000 and prime bound 5,714,285.

The existing per-interpreter `Factorizer` already shares a bounded SPF table.
This change compiles text iteration in scalar functions, registers unary
`binary` as a guarded native call, and expresses the demo's squares as products.
The algorithm and its exact BigInt arithmetic are unchanged.

Build with `npm run build`, then run:

```sh
node benchmarks/euler399.mjs --stage=moduli --trials=3
node benchmarks/euler399.mjs --stage=moduli --trials=1 --verify --timeout=60000
node benchmarks/euler399.mjs --stage=fibmod --trials=3
node benchmarks/euler399.mjs --stage=fibmod --variant=powers --trials=3
node benchmarks/euler399.mjs --checkout=/path/to/baseline --stage=fibmod --trials=3
node benchmarks/euler399.mjs --stage=full --trials=1 --timeout=60000
```

Each trial uses a fresh sequential process. Phase times include parsing and
execution; process times additionally include startup. Verification runs a
separate Number oracle with a full SPF table; its time is excluded from the
Rank phase. The oracle bounds the doubling products below 2^53 and compares
the complete modulus list, including order, rather than only its size.

The modulus-stage budget used for this local experiment is 30 seconds per
process. These timings are not CI gates or a measurement of a GitHub runner.
The complete solver's inclusion-exclusion stage remains outside this issue's
modulus-list acceptance criterion and retains its existing audit exclusion.

## Local measurements

2026-10-23, Apple M5, Node v24.15.0, baseline `7734516b`.

| Workload | Baseline | Runtime changes, original squares | Runtime changes and product squares |
| --- | ---: | ---: | ---: |
| 10,000 `fibmod` calls, median execution | 962.44 ms | 249.76 ms | 37.39 ms |
| Compiled scalar entries per microbenchmark | 0 | 0 | 10,000 |

The runtime changes alone improve the microbenchmark by 3.85x. Product squares
then allow the whole helper to compile, improving it by another 6.68x (25.74x
over baseline). The checksum is 24,604,978 in every case. Each median uses
three fresh processes, without a concurrent benchmark or build.

For the complete modulus stage, baseline exceeded a 180-second process limit.
The final execution samples were 24.44, 25.37 and 29.00 seconds (median 25.37 s;
median cold process time 25.74 s). This establishes a speedup greater than 7x,
not an exact baseline runtime. Peak RSS was 473–476 MiB.

A separate verified run took 23.18 s in Rank, then 4.49 s in the independent
oracle. Both produced exactly the same 2,059 retained moduli from 2,879
candidates, examining 394,525 primes and executing 1,604,053 modular Fibonacci
queries. Rank entered the compiled scalar helper 1,604,053 times.

The full solver did not complete within a 60-second process limit. Its modulus
phase completed in 24.47 s before the timeout during inclusion-exclusion.
No completed full-size answer or CI-runner timing is claimed.

Correctness checks cover Unicode iteration and ordinals, control flow,
cancellation and recovery, guarded native rebinding, direct small Fibonacci
recurrence, exact large-modulus doubling (including modulus 10^16), the 200th
statement example, and independent prime-square marking for index selection.

Final validation: `npm run build`; 214 tests across the eight focused
interpreter files; 17 compiled-expression language tests; two exclusion-list
tests; both `399_squarefree_test.ra` examples. The full `npm test` and corpus
audits were not run.
