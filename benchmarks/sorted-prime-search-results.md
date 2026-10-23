# Sorted integer insertion indices (#375)

Apple M5, Node v24.15.0. Baseline: the local Rank `upper` function from
`c3bcdfff`; candidate: `use algo` and `upperindex`. Each sample runs in a fresh
process, with the same algorithm, inputs and checksum in both variants.
Raw samples: `baselines/2026-10-23-sorted-prime-search.jsonl`.

The original Euler 354 already used binary search, not linear interval scans.
Its missing facility was a native insertion-index operation. Existing multiset
`lowerbound` and `upperbound` return values and retain that contract.

## Changes measured separately

1. Native bounds only: 1,000 upper-bound queries over 1,073,096 primes congruent
   to 1 mod 3 through 35 million improved from 10.156 ms to 2.980 ms (3.41x).
   This intermediate version was correct but made the Euler loop fall back
   from compilation: at Limit=10^9, 109.243 ms became 179.778 ms.
2. Compiled integer-array native arguments restored loop compilation. Final
   search medians: 8.668 ms for local Rank binary search, 1.438 ms for the native
   operation (6.03x). These are medians of three processes; each process reports
   the median of five warmed batches. First batches including parsing and
   compilation were 20.1–21.2 ms versus 7.1–7.6 ms. Setup is excluded.
3. Euler 354 replaces only its two local search calls; its quotient grouping
   and arithmetic are unchanged. At Limit=10^9, fresh-process execution medians
   including parsing were 120.053 ms versus 97.057 ms (1.24x), answer 107946.
   At the original Limit=5*10^11, three fresh processes per variant gave medians
   of 18,245.108 ms versus 7,260.976 ms (2.51x). Every run returned 58065134;
   all six completed within the 30-second per-process limit.

The 35-million preparation produced 2,146,775 primes and 1,073,096 filtered
primes, checked against an independent ordinary sieve during the initial audit.
Every search benchmark validates checksum 553697517. The unit tests compare
bounds against independent linear counts and prove at most 31 cell reads in a
virtual vector of 2^30 integers, without eager materialization.

## Reproduction

```sh
npm run build
node benchmarks/sorted-prime-search.mjs
node benchmarks/sorted-prime-search.mjs --case=euler --limit=1000000000
node benchmarks/sorted-prime-search.mjs --case=euler --limit=500000000000 --expected=58065134
```

Sortedness is a caller precondition. Bounds return zero-based indices in
`0..len`, inspect only the search path, support duplicate and arbitrary-precision
integers, and use the ordinary array reader for views and lazy cells. Compiler
specialization uses existing guarded array proofs and rechecks native bindings.

## Verification

- `npm run build` passed (including web builds and Capacitor sync).
- 137/137 targeted interpreter tests passed: sorted bounds, compiled array arguments, typed
  native calls, operation catalogue, numeric search, multiset, prime sequences.
- 53/53 targeted language tests passed (compiled expressions and type/shape signatures).
- Both new offline manual examples and the generated CLI reference check passed.
- Euler 354's existing tests: Limit=10^6 -> 18, Limit=10^7 -> 597.
- The general manual structure check fails on an existing 41-column line in
  `docs/manual/cli.md` under `argument`; reproduced unchanged on `c3bcdfff`.
  That unrelated formatting was left unchanged.
- No full `npm test` or demo-corpus audit was run.
