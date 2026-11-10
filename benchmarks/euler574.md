# Euler 574: exact CRT search by two half-sized subset lists

Base: `04b6a140295e486e4f74bed223490eac376acf09`.
The [problem](https://projecteuler.net/problem=574) asks for the sum of minimum
verifying A values for primes below 3800. The exact result remains
**5780447552057000454**, beyond Number's exact integer range.

## Why the old program was slow

For each prime p, the original program doubled a CRT-residue array once per
small prime, eventually retaining up to 2^18 BigInt entries. Subsequent
remainders, quotients, masks and choices each traverse that large array. A
reference CPU profile is dominated by owned-array writes, garbage collection
and stored BigInt kernels, rather than Rank statement dispatch. Faster scalar
loop compilation alone cannot remove these arrays.

## Algorithm and Rank changes

Let M be the product of primes r<=sqrt(p). Choosing A=0 or p modulo each r
ensures M divides A(A-p). Since p is prime, gcd(A,p)=1 is exactly the required
coprimality condition for both B=p-A and B=A-p.

It therefore suffices to find the least A>=ceil(p/2) satisfying these CRT
conditions and A mod p!=0. Below p it verifies a sum; above p it verifies a
difference. The excluded value A=p cannot verify either. The next prime q
above sqrt(p) gives the required p<q^2 without a fixed prime-prefix limit.

For each small-prime count, construct CRT unit weights
(M/r)*inverse(M/r mod r). Split the weights in two. A small bit-mask tensor
and axis sum construct the half-subset sums L and R, reduced modulo M. These
bases are computed once for all groups using array operations, with no manual
memoization index. For each p, multiply each half by p modulo M, then sort R.
There are at most 512 entries per half at the default input, rather than
262144 full subsets per prime.

For each x in L and target t=ceil(p/2), compute:

```
threshold = (t-x) mod M
turn = floor((t-x)/M)
position = lower_bound(R, threshold)
candidate = x + R[position mod size]
              + (turn + floor(position/size))*M
```

This is the first candidate for that x at or above t, including wraparound.
Only candidates divisible by p advance to the next position in the circular
sorted list. Advancing a full list adds M, which is coprime to p, so the
correction terminates. Taking the minimum across L covers every full CRT
subset and every relevant period. No approximate comparison is used.

The program has one explicit loop, for the exceptional candidates only. Its
other work uses array operations and library search/sort functions. All lines
are within 40 columns. Empty bounds return zero. Squares of the shared small
primes determine group indices, avoiding a prime-generator call per p.

## Compiler/runtime findings

No compiler source changes are needed for this task. The existing stored
integer kernels handle arithmetic beyond int64, and `lowerindex` already
performs exact batch searches over boxed BigInt arrays. Existing tensor kernels
construct the small bases. Focused diagnostics confirm both paths execute;
Number guards retain exact fallback for the wide values. Replacing them with a
new task-specific kernel would duplicate functionality while retaining the
old exponential materialization.

## Measurements

| Host/mode | Old seconds | New seconds | Old peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 7.920 | 0.371 | 722.0 | 257.6 |
| Mac reference | 9.880 | 0.365 | 715.7 | 279.0 |
| Intel compiled | 19.409 | 1.094 | 638.6 | 239.1 |
| Intel reference | 23.433 | 1.176 | 657.5 | 264.8 |

Compiled execution improves about 21x on Mac and 18x on Intel; reference
execution improves about 27x and 20x. Peak RSS falls by 60-64% in all four
lanes. Mac baseline times vary more than Intel; every new primary sample is
faster and uses less peak memory than every corresponding old sample.

Three alternating fresh-process old/new pairs per mode, Apple M5 arm64 and
Intel i7-10750H x64, Node v24.15.0. Every sample checks the full exact result.
Both sources use the same runtime, so this comparison isolates the program
rewrite. Time includes parsing/execution and excludes interpreter import.
RSS is the process high-water mark. Diagnostics/profiling are disabled during
these samples. Raw results: `baselines/2026-11-10-euler574.json`.

## Verification

276 focused checks across six files passed on each host. An independent direct
search checks coprimality and divisibility without CRT/subset construction for
all primes below 500. Tests cover empty bounds, exclusive upper bounds, prime
square boundaries and statement examples V(2)=1, V(37)=22, V(151)=165. Small
bounds match the original full-subset search. Number, exact and reference modes
all retain the default golden. Existing sorted search, real-search fallbacks,
weighted-axis, vector-write and range tests pass.

Two filtered differential, two inferred-type and two name-fact checks pass on
Mac for the main and fixture. The full main is restored to ordinary corpus
execution. TypeScript build and five exclusion-policy checks pass. Full npm
test and exhaustive audits were not run.

```sh
node benchmarks/euler574.mjs compiled
node benchmarks/euler574.mjs reference
node benchmarks/euler574.mjs exact
node benchmarks/euler574.mjs compiled 3800 benchmarks/fixtures/euler574-original.ra
```

`RANK574_EXPECTED` checks an answer; `RANK574_RUNTIME` selects another runtime.
`RANK574_DIAGNOSTICS=1` and `RANK574_PROFILE=path` enable separate instrumented
runs.
