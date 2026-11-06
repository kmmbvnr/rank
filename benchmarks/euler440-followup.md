# Euler 440: diagonal powers in bounded array blocks

Default L=2000; answer **970746056**. Baseline `e5cfe861`, with original
source retained in `experiments/euler440-original.ra`.

The [problem](https://projecteuler.net/problem=440) defines T(0)=1, T(1)=10,
T(n)=10T(n-1)+T(n-2), and sums gcd(T(c^a),T(c^b)) over a,b,c up to L.
The existing Lucas-sequence/GCD reduction is retained: pairs with equal
2-adic valuation contribute T(c^gcd(a,b)); other pairs contribute 10 for
odd c and 1 for even c. An odd-totient prefix counts the first kind.

The old program computed four million T values with 30 whole-array doubling
steps. It retained the exponent matrix and several arrays of intermediate
products. Current baseline time was already below the historical 34 s in
the issue: preceding runtime work had brought it to about 9.3 s on Mac.

## Algorithm

Over the prime field p=987898789, put r=sqrt(26), alpha=5+r, beta=5-r.
Then T(n)=(alpha^(n+1)-beta^(n+1))/(2r). The program computes r and the
inverse of 2r using `powmod`; no precomputed root or answer table is used.
Since p=5 mod 8, the square-root construction needs at most one correction.
Both roots are nonzero, so Fermat's theorem also gives the exponent period
p-1 used by the original program.

Broadcast `powmod` builds c^d mod (p-1), then two fixed-base powers give T.
The odd-totient prefix is now a masked scan. Each function has at most one
loop. A single top-level loop processes 128 bases at a time; its arrays
have at most 2000*128 cells at the default input. This bounds memory without
scalarizing the arithmetic. All production lines fit 40 columns.

## Shared numeric implementation

`powmod` now has a native path for one safe integer base, a scalar modulus
up to 2^30, and stable packed nonnegative Int32 exponents. Four exponent
lanes use independent accumulators and one shared 31-entry squaring table.
The result stays packed and preserves the exponent tensor shape. This
benefits ordinary reference execution as well as callers of the builtin
from compiled code; there is no Euler-specific operation or compiler rule.

Other types, domains and irregular/opaque storage retain the existing
mapper. Cancellation, inspection and demand-budget behavior retain the
existing entry guards and 4096-cell checkpoints. A negative exponent declines
to the ordinary error path; partial results are never published.

## Measurements

Node v24.15.0, individual fresh processes, no heap/GC flags. Times include
parsing. Mac entries are medians of three processes; Intel entries are
single controls. RSS is process peak, with medians of those peaks on Mac.

| Host / mode | Original s | Final s | Original peak MiB | Final peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 compiled | 9.295 | 1.124 | 561 | 189 |
| Apple M5 reference | 22.032 | 1.225 | 657 | 253 |
| Intel i7-10750H compiled | 18.433 | 2.244 | 550 | 178 |
| Intel i7-10750H reference | 48.127 | 2.551 | 600 | 259 |

Compiled improves about 8.2x; reference improves 18–19x. Peak RSS falls by
57–68% across these four comparisons. Most of the gain is the Rank algorithm.
A control using the final Rank source with the old runtime took 1.129 s
compiled / 1.462 s reference on Mac; the native change's whole-program gain
is clearest in reference execution.

A separate reference microbenchmark computes 1048576 varying powers of one
base, five timed evaluations in one process. Median builtin time changes
from 93.811 to 36.286 ms on Mac and 168.437 to 79.677 ms on Intel (2.6x / 2.1x).
This excludes parsing and does not represent the whole Euler speedup.

The flat diagonal formula took 1.010 s / 352 MiB compiled on Mac. Fully
broadcast exponent construction took 1.199 s / 271 MiB. Bounded blocks keep
the latter array formulation with less peak memory. These prototype timings
are single exploratory samples, not controlled medians.

## Verification and audit coverage

- TypeScript source/test build, semantic and application-form checks.
- 528 targeted tests across 18 files on both hosts.
- Four Rank fixture tests in three modes on both hosts, including the new
  full-default golden assertion and L=0/L=1 cases. Existing examples remain.
- Direct exact integer tiling/GCD enumeration at L=0..5, independent of the
  Lucas reduction, in three execution modes.
- Comparison with the original doubling program at L=6,31,127,128,129,257,
  including both sides of the 128-base boundary, in three execution modes.
- Packed exponent tests cover negative/safe-wide bases, 0/1/2^31-1 exponents,
  modulus admission endpoints, tensors, tails across 4096 cells, empty and
  rank-zero arrays, domain errors, and budgeted publication.
- Full L=2000 answer in both engines on both hosts. The full main's manual
  exclusion is removed; the fixture now retains the same golden answer.

The exhaustive audits and full suite were not run. Raw records are in
`baselines/2026-11-07-euler440.json`.

Reproduce from the repository root after building:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/experiments/euler440-run.mjs compiled
node benchmarks/experiments/euler440-run.mjs reference
node benchmarks/experiments/euler440-verify.mjs
node benchmarks/experiments/euler440-powmod.mjs
```

The runner takes a limit and source path after the mode. Set RANK440_RUNTIME
to a file URL for a separately built runtime when isolating implementation
changes. Older raw records use `n` for the CLI limit L.
