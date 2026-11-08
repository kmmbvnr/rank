# Euler 799: packed range masks and exact Gaussian representations

Issue: https://github.com/kmmbvnr/rank/issues/562

The default `Limit=28000000`, `Least=100`, `Floor=240` run returns
`1096910149053902` in 17.10 s on the local arm64 Mac and 40.78 s on the
Intel x64 host. Both used Node v24.15.0 and an 8192 MiB heap limit.
These are single process wall-time measurements, including parsing, not
statistical medians. Peak RSS is process-wide, not live retained storage.

## Runtime first

Profiling the original million-element sieve showed range-mask traversal,
Boolean unpacking and scalar conversion dominating the run. A proven native
arithmetic range selected by a packed Boolean mask can snapshot the selected
positions and materialize directly into integer storage. No source cells or
boxed Boolean arrays are needed. The optimization also works with compilation
disabled; custom iterators, observable demand budgets and inspection retain
the ordinary path. Cancellation remains polled.

| Original Rank sieve, 1 million elements, Mac | Time | Peak RSS | Unpacked cells |
| --- | ---: | ---: | ---: |
| Main at `0172b6b2` | 5.44 s | 571.39 MiB | 37,000,000 |
| Packed range selection | 1.00 s | 315.22 MiB | 0 |

At full size, the improved original sieve finished in about 29 s, but the
subsequent coordinate enumeration still exceeded a minute; that run was
cancelled. The approximately eight-minute original full runtime is the issue's
reported baseline, not a new measurement.

## Rank algorithm changes

For each prime p = 1 mod 4, solve r² = -1 (mod p). Since p is neither 2 nor 3,
6 has an inverse modulo p. The two zero-based index progressions start at
`((1 ± r) / 6 - 1) mod p`. They find exactly the elements divisible by p.
The existing exact gcd with p^22 removes all powers needed at the default
bound. No large modular multiplication or prime-power root lifting is needed.
There are 37 such primes through 400, and no full-array remainder passes.

For each survivor, write `(6n-1)²+1 = 2 * product(p^e)`. Represent a prime
as `p=a²+b²`, then enumerate the e+1 Gaussian choices
`(a+bi)^k (a-bi)^(e-k)`. Array outer products combine factors, starting
from `1+i`. Normalize coordinate signs and ordering, require both coordinates
congruent to 5 modulo 6, and count distinct larger coordinates. This counts
unordered pentagonal pairs exactly without scanning millions of coordinates.
A scalar memo function shares the small prime square decompositions.

The original 400-smoothness and divisor-count candidate filters are unchanged.
They are a search restriction, not a proof that no smaller excluded candidate
can qualify. This optimization preserves that limitation.

| Full default run | Mac time | Mac peak RSS | Intel time | Intel peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Runtime improvement + Gaussian counting | 31.61 s | 2069.53 MiB | 69.60 s | 1291.05 MiB |
| Plus root-index sieve, before array mapping | 19.47 s | 1681.83 MiB | 41.72 s | 1327.71 MiB |
| Final array mapping | 17.10 s | 2148.48 MiB | 40.78 s | 1325.23 MiB |

The root sieve improves time on both hosts; Intel RSS is slightly higher.
The final source maps pair counting over the candidate array, keeping only one
Rank loop. Peak RSS varies with allocation and garbage-collection timing.
A lazy `Side'` experiment made the final Mac run slower (28.56 s) and raised
peak RSS to 2541.33 MiB, so it was not retained. Making `Ns` and `Side` lazy
with an explicit filled `Divs` also failed to improve the earlier variant.

## Verification and reproduction

- Independent enumeration checks every pair count for n=1..500 in both modes.
- Both modes compare the entire remainder and divisor-count arrays with the
  original sieve for 1000 elements.
- Both modes retain the original small answers 3577 and 107602.
- Packed-selection tests cover reverse and wide integers, snapshots, empty
  masks, shape errors, iterator replacement, cancellation and demand budgets.
- Build and 115 focused tests passed. Exhaustive audits were not run.
- The full compiled answer is registered in `full-scale-demos.test.ts`.
  Large reference execution stays excluded from repeated corpus audits.

Build generated sources and package outputs before running the driver:

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node --max-old-space-size=8192 benchmarks/euler799.mjs
RANK_SOURCE=benchmarks/fixtures/euler799-original.ra SIEVE_ONLY=1 \
  node benchmarks/euler799.mjs 1000000
npm test --workspace @arrrank/interpreter -- test/euler799.test.ts test/range-mask-selection.test.ts
npm test --workspace @arrrank/interpreter -- test/full-scale-demos.test.ts -t 799_pentagonalpuzzle
```

`RANK_INTERPRETER=/absolute/path/to/packages/interpreter/out/index.js` selects
an older built runtime for the original-fixture baseline. `COMPILED=0` selects
reference execution; `PROFILE=/tmp/euler799.cpuprofile` records a CPU profile.
The driver reports exact answer, elapsed time, peak RSS and runtime counters.
