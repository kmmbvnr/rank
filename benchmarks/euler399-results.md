# Euler 399 rank queries

The workload builds forbidden index moduli for the 100,000,000th squarefree
Fibonacci number: index bound 200,000,000 and prime bound 5,714,285.

The existing per-interpreter `Factorizer` already shares a bounded SPF table.
The initial rank-query change compiled text iteration in scalar functions, registered unary
`binary` as a guarded native call, and expressed the demo's squares as products.
That change preserved the algorithm and its exact BigInt arithmetic. The
subsequent segmented-selection change is measured separately below.

Build with `npm run build`, then run:

```sh
node benchmarks/euler399.mjs --stage=moduli --trials=3
node benchmarks/euler399.mjs --stage=moduli --trials=1 --verify --timeout=60000
node benchmarks/euler399.mjs --stage=fibmod --trials=3
node benchmarks/euler399.mjs --stage=fibmod --variant=powers --trials=3
node benchmarks/euler399.mjs --checkout=/path/to/baseline --stage=fibmod --trials=3
node benchmarks/euler399.mjs --stage=full --trials=1 --timeout=60000
node benchmarks/euler399.mjs --stage=selection --trials=3 --timeout=30000
```

Each trial uses a fresh sequential process. Phase times include parsing and
execution; process times additionally include startup. Verification runs a
separate Number oracle with a full SPF table; its time is excluded from the
Rank phase. The oracle bounds the doubling products below 2^53 and compares
the complete modulus list, including order, rather than only its size.

The modulus-stage budget used for this local experiment is 30 seconds per
process. These timings are not CI gates or a measurement of a GitHub runner.
The original inclusion-exclusion solver retained its full-input audit
exclusion after that initial change. The follow-up replaces index selection.

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

Before segmented selection, the full solver did not complete within a 60-second process limit. Its modulus
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

## Segmented index selection

The follow-up is based on `639ee9cb`. It replaces grouped inclusion-exclusion
and binary search with a forward scan in segments of at most 1,000,000 integer
marks. The moduli are sorted and copied once; each segment marks their
multiples and counts its allowed indices. Only the segment containing the
requested rank needs an element-by-element selection pass. This uses existing
compiled array loops and makes no interpreter changes.

The independent reference first derives the moduli. With the full modulus
list already available, selection and formatting samples were 1.316, 1.322
and 1.546 seconds (median 1.322 s). Setup of the reference modulus list is
excluded from those phase times and included in the reported process time.

Correctness is checked against direct prime-square Fibonacci recurrence,
direct marking with overlapping/unsorted/redundant moduli, segment sizes
1/7/16/1,000,000, first and last allowed ranks, partial final segments, and
the statement example. Independent Number inclusion-exclusion confirms
99,999,999 allowed indices through 130,775,523 and 100,000,000 through
130,775,524. A separate recursive BigInt doubling oracle gives trailing digits
1508395636674243. The full expected output is
`1508395636674243,6.5e27330467`.

The previous selection stage, using the same reference-prepared moduli, timed
out at a 60-second process limit; reference setup had completed in 4.30 s.
The current phase median is 1.322 s. The old phase did not finish, so no exact
speedup or old completed duration is claimed.

Three complete solver runs took 28.70, 28.77 and 33.79 seconds as cold processes
(median 28.77 s). Their modulus phases took 26.92, 27.02 and 32.04 seconds;
selection plus formatting took 1.301, 1.343 and 1.353 seconds. All three asserted
index 130,775,524 and the complete expected output. These are local measurements
on Apple M5 / Node v24.15.0, without concurrent builds or benchmark workers.
The full-input corpus exclusion is retained: even compiled execution exceeded
30 seconds in one trial, and the reference corpus audit was not run.

A separate ordinary CLI execution of the final program (not split into phases)
completed in 35.42 seconds, exited successfully and asserted the same complete
answer. Final validation passed: `npm run build`, six focused Euler 399 tests,
two exclusion-list tests, both demo examples, the three complete benchmark
runs and the ordinary full CLI run. Full `npm test` and corpus audits were not
run. The 30-second full-program limit is not guaranteed.
