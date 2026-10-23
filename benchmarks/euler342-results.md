# Euler 342: cube-totient factor-residue search

Measured on Apple M5 with Node v24.15.0. Each completed row uses three fresh
processes; medians include parsing, prime/factor table construction and search.
Every completed sample checks its answer. Raw samples are in
`baselines/2026-10-23-euler342.jsonl`.

| Exclusive bound | Original scan | Scan using `numbers.factors` | Residue search |
| --- | ---: | ---: | ---: |
| 100,000 | 406.6 ms | 1,201.8 ms | 189.2 ms |
| 1,000,000 | 7,429.0 ms | — | 215.4 ms |
| 10,000,000,000 | timeout at 30 s (one attempt) | — | 2,033.8 ms |

The million-bound search is 34.5 times faster than the original scan on the
same runtime. The full search returns **5943040885644**. With all compilation
disabled, the full search also returns that sum (median 1,991.7 ms). These
measurements establish the algorithmic improvement; they do not claim a
compiler speedup or memory saving. Full-search maximum RSS was 554–566 MiB
in the three compiled samples, versus about 170 MiB for the million-bound scan.

## General mechanisms considered first

The interpreter already shares a bounded smallest-prime-factor table between
`factors` and `divisors`. Replacing only the original demo's manual trial
division with `N factors unique` made the reduced scan slower. Diagnostics show
the original scan enters a compiled loop, while the factor-sequence version
falls back to ordinary evaluation. It still enumerates every integer.

The new search reuses existing primes, factorization, counters and indices.
Its variable integer power, collection operations and recursive search are
outside the current compiled loop region. Broadening the compiler solely for
this demo is unnecessary: reference execution already meets the full bound
in about two seconds. No interpreter semantic or compiler changes are included.

## Search invariant and completeness

For `n = product p^a`, `phi(n^2) = product p^(2a-1) * (p-1)`.
Choose distinct primes in descending order. The carried multiset contains the
unfinished factors contributed by already selected primes; multiplicities
represent exponent residues modulo three. It is updated by dropping the
chosen prime and appending the cached factors of `p-1`, without factoring a
candidate integer or its squared totient.

If the carried residue for `p` is `r`, its exponent must satisfy
`2a - 1 + r = 0 mod 3`. The least positive exponents for residues 0, 1 and 2 are
2, 3 and 1 respectively; further choices add three. Smaller selected primes
cannot change an already settled exponent. Therefore the next prime cannot
be below the largest nonzero pending residue. An empty residue set accepts
the current product, except for 1; optional smaller factors are still explored.
Every valid factorization has exactly one descending path.

For the largest prime the residue is zero, so its exponent is at least two.
Only primes through `isqrt(bound - 1)` are required: 9,592 primes for the full
bound. Each branch is rejected when its product reaches the exclusive bound.
Above the largest pending residue all initial powers are `p^2`, so the
ascending candidate-prime loop can stop once that bound is reached.

## Verification and reproduction

- `npm run build` passed after linking the existing root and mobile workspace
  dependencies into the isolated worktree. The initial attempts failed only
  because Capacitor could not locate the mobile workspace's dependencies.
- `test/euler342.test.ts` compares the search with an independent totient sieve
  for every prefix through 128 and selected prime-power/product boundaries
  through 10,000, with compilation both enabled and disabled. It also checks
  the preserved direct formulation, repeated solves, a million-bound sieve,
  and the full-answer regression.
- All five `342_totientcube_test.ra` blocks passed. Targeted type and
  compiled/reference corpus checks cover only the two Euler 342 files.
- The full demo is eligible for the ordinary execution audits again; its old
  scan-based exclusion was removed. The exclusion-manifest tests passed.

Build with `npm run build`, then run `node benchmarks/euler342.mjs`.
The original full scan is optional:
`node benchmarks/euler342.mjs --cases=original-full --trials=1 --timeout-ms=30000`.
A timeout is reported as incomplete work and exits unsuccessfully.
Run the demo assertions with
`node packages/cli/bin/cli.js test demos/euler/342_totientcube_test.ra` and the
focused interpreter/corpus tests with
`npm test --workspace @arrrank/interpreter -- test/euler342.test.ts test/differential.test.ts test/types.test.ts -t 342`.
No full test suite or whole-corpus execution was run.
