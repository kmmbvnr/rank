# Euler 537: use modular polynomial convolution

The full result remains **779429131**. The [statement](https://projecteuler.net/problem=537)
gives 19, 869985 and 578270566 for n=k=3, 10 and 1000 respectively.
The coefficient of x^n in A(x)^k counts the tuples: A(0)=1 for x=1,
and A(r)=p(r+1)-p(r) for r>0. Binary powering only needs degrees through n.

The former demo implemented NTT butterflies with gathered/scattered arrays,
bit reversal and four stage-index/twiddle matrices. Existing compilation
already made it much faster than the historical issue estimate of 20 seconds.
The replacement calls the existing `convolve ... mod` operation, retains one
explicit loop, and requests exactly n+1 primes instead of assuming p(n+1)<300000.
Starting the result at the constant polynomial also handles k=0 and n=0.

## Shared runtime change

Previously every large modular convolution used three NTT fields and CRT,
even when the requested modulus itself supported the transform. The new path
uses one field/ring when m<=2^30, transform length L divides m-1, and
3^((m-1)/2)=-1 mod m. This is a verified root criterion, not a primality test.
For every prime factor of odd m, w=3^((m-1)/L) has order L: its half-power
is -1 and its L-th power is 1. Since L is a power of two, every w^j-1 for
0<j<L is a unit modulo m. Thus the transform is invertible even for a
composite m satisfying the criterion. The inverse scale uses
((m+1)/2)^log2(L), which does not assume Fermat's theorem.

Other moduli and unsupported lengths retain the exact three-field CRT route.
Budgeted and inspectable/custom-poll executions retain that route as well,
including its work accounting. Atomics cancellation still checks transform
stages; inputs remain unchanged on interruption. Arbitrary small modulus
root tables retain at most three entries (48 KiB), and large transforms keep
one table. Only one scalar root-verdict cache is added, avoiding an unbounded
cache for user-supplied moduli.

## Measurements

Node 24.15.0, separate processes, full n=k=20000. Three alternating compiled
pairs against frozen 3a826d6e, with no overlapping benchmark jobs per host.
Values are medians; RSS is process peak, including startup and parsing.

| Host | Original seconds / MiB | Final seconds / MiB |
| --- | ---: | ---: |
| Mac arm64 | 1.276 / 250.5 | 0.358 / 181.1 |
| Intel i7-10750H | 2.530 / 242.5 | 0.642 / 170.6 |

Intel load averages were 0.15-0.34 with zero other Node processes recorded
before every sample. Mac load was about 3.2-3.4; alternating order reduces
but does not eliminate external load noise. CPU time also decreases.

Single controls using the new source with the old runtime take 0.933 seconds
on Mac and 1.532 seconds on Intel, versus 0.358/0.642 with the shared change.
Reference-mode single runs improve 1.080->0.344 seconds on Mac and
2.622->0.629 on Intel. These are single controls, not repeated medians.
The algorithm remains polynomial binary powering; gains come from using
library storage/transforms and avoiding unnecessary CRT passes.

Raw samples and source hashes: [JSON](baselines/2026-11-09-euler537.json).
Reproduce a single run from the repository root:

```sh
node benchmarks/euler537.mjs compiled 20000
node benchmarks/euler537.mjs reference 20000
```

`RANK537_RUNTIME` selects a frozen interpreter entry point; pass
`benchmarks/fixtures/euler537-original.ra` as the third argument for the old
source. `RANK537_K` permits unequal n and k. Diagnostics/profiling are off
in the reported timing series.

## Verification

Independent trial-prime generation and repeated coefficient sums cover zero
and unequal n/k, powers that require NTT, and all three execution modes.
All three modes cover the 1000 example and full answer. A k=1 case at n=30000
exceeds the old fixed prime bound. Convolution checks cover exact BigInt
references, negative/extreme residues, squares, arbitrary modulus cache
eviction, a supported modulus with an unsupported longer transform,
non-root primes/composites, unchanged budget charges and cancellation.
The now-fast full demo returns to the ordinary differential corpus; only
its filtered differential checks were run here, not the exhaustive audits.

The focused Mac suites passed 162 tests across convolution, Euler 537,
compiled array operations and image processing; the filtered differential
passed both demo files. The same convolution/Euler suites passed 127 tests
on Intel. TypeScript build passed. Exhaustive audits were not run.
