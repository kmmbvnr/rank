# Euler 441: Farey gaps and an odd Mobius sum

Default N=10000000; answer **5000088.8395**. Baseline `b6f3cafb`, with source
retained in `experiments/euler441-original.ra`.

The [problem](https://projecteuler.net/problem=441) sums reciprocal products
of coprime pairs p<q with p+q>=M, then sums over M=2..N. The old program
used Mobius inversion and two ranges of (d,k), with full harmonic tables.
Current baseline time was about 5.3 s compiled on Mac, below the historical
44 s in the issue. The remaining cost was unnecessary algorithmic work and
large temporary/retained arrays, especially in reference execution.

## Reduction

For M>=2, adjacent Farey fractions of order M have coprime denominators
p,q<=M with p+q>M. Their gaps are 1/(pq) and sum to 1. Each unordered pair
occurs twice, so the strict-inequality part of R(M) is exactly 1/2.

The p+q=M boundary contributes
h(M)=sum_{1<=p<M,gcd(p,M)=1} 1/(M*p), except at M=2 where p=q=1 is excluded.
Consequently, for N>=2,

S(N) = (N-2)/2 + sum_{p<q<=N,gcd(p,q)=1} 1/(p*q)
     = (N-2)/2 + sum_{d<=N/2} mu(d)/d^2 * G(floor(N/d)),

where G(k)=(H(k)^2-H2(k))/2. There is no separate (d,k) search.

Only odd Mobius values are stored. For odd d, mu(2d)=-mu(d), while
mu(4d)=0, so each odd term uses
mu(d)/d^2 * (G(N//d)-G(N//(2d))/4).
This halves the sieve domain and removes the even-table entries.

There are O(sqrt(N)) distinct quotient values. Small values use direct
prefixes and large values use a table indexed by their small divisor.
The final weighted sum maps blocks of 262144 odd indices with `rank 0 sum`.
It does not construct a full table of real-valued terms. The only explicit
Rank loop is the prime-power sieve; all production lines fit 40 columns.
Empty and singleton N return 0.

## Harmonic sums and accuracy

The direct prefix bound is min(N,max(Cut,floor(sqrt(N)),32)). `Cut` remains
a tuning argument, now controlling this prefix instead of the removed
search split. `N` and `Digits` retain their defaults and meaning.
Above that bound, the program evaluates Euler-Maclaurin expansions:

H(k) = log(k)+gamma+1/(2k)-1/(12k^2)+1/(120k^4)-1/(252k^6)+r1,
H2(k) = zeta(2)-1/k+1/(2k^2)-1/(6k^3)+1/(30k^5)-1/(42k^7)+r2.

For positive k, the truncation errors obey
0<r1<1/(240k^8), 0<r2<1/(30k^9). See the
[NIST digamma remainder bound](https://dlmf.nist.gov/5.11#ii) and
[Nemes, Theorem 1.3](https://pmc.ncbi.nlm.nih.gov/articles/PMC5549576/),
applied to the positive-real Hurwitz-zeta expansion at s=2.
At k>=33 these give a weighted truncation error below 1e-12 for the default
input, before floating arithmetic. This is an approximation for the stated
four-decimal task, not an arbitrary-precision harmonic implementation.

A full-default control with Cut=N uses direct prefixes through 10 million,
without the approximation. It produces the same double result
**5000088.839531809**, hence the same four-decimal answer. The upper rounding
boundary is about 1.82e-5 away. The old program's raw result was
5000088.839531011; the simplified formula avoids its large cancelling sums.
The direct-prefix control took about 1.1 s / 968 MiB on Mac; the compact
quotient tables avoid that memory cost.

## Compiler/runtime inspection

Existing numeric tensor kernels already handle the rewritten array stages:
one compiled sieve loop and 51 compiled tensor regions in the final Mac run.
The Number-loop write-budget guard is retained. Some helpers are not compiled
as whole functions, but their arithmetic uses the existing bulk operations;
the harmonic helper only processes O(sqrt(N)) entries. No interpreter or
compiler code is changed in this step, and no timing gain is attributed to
an implementation change.

## Measurements

Node v24.15.0, fresh processes, no heap/GC flags. Times include parsing.
Mac entries are medians of three; Intel entries are single controls. RSS is
process peak, with medians of those peaks on Mac.

| Host / mode | Original s | Final s | Original peak MiB | Final peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 compiled | 5.266 | 0.545 | 1698 | 347 |
| Apple M5 reference | 17.613 | 1.404 | 3038 | 717 |
| Intel i7-10750H compiled | 12.170 | 1.262 | 1561 | 289 |
| Intel i7-10750H reference | 41.197 | 3.197 | 2119 | 535 |

Compiled improves about 9.6x and reference 12.5–12.9x. Peak RSS falls by
75–82% across these four comparisons. The flat odd-only prototype took
0.458 s / 446 MiB compiled and 1.324 s / 738 MiB reference on Mac. Blocking
trades a small amount of time for bounded scratch space. These prototype
entries are single exploratory samples, not controlled medians.

## Verification and audit coverage

- TypeScript source/test build and semantic/application-form checks.
- 18 targeted tests on both hosts: 102 direct-oracle executions (17 bounds,
  two prefix settings and three modes), plus 18 independent odd-sieve checks.
- Direct oracle counts how many M include each coprime pair and uses compensated
  summation, without the Farey reduction. It covers N=0..5,10,31,32,33,63,64,
  65,100,129,250,1000, including the approximation's first boundary.
- Trial factorization independently checks odd Mobius values at nine bounds,
  including empty inputs, primes and prime squares, in both engines.
- All four Rank fixture tests in three modes on both hosts, including all
  original assertions, new empty/singleton cases and the full golden answer.
- Full default in both engines on both hosts; full-default direct-prefix control.

The full main's manual execution exclusion is removed. Exhaustive audits and
the full suite were not run. Raw results and candidates are retained in
`baselines/2026-11-07-euler441.json` and `experiments/euler441-*.ra`.

Reproduce after building:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/experiments/euler441-run.mjs compiled
node benchmarks/experiments/euler441-run.mjs reference
node benchmarks/experiments/euler441-verify.mjs
RANK441_CUT=10000000 node benchmarks/experiments/euler441-run.mjs compiled
```

The runner accepts a limit and source path after the mode. RANK441_CUT and
RANK441_DIGITS override the tuning arguments; RANK441_RUNTIME can select a
separately built runtime by file URL.
