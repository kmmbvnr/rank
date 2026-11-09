# Euler 545: a sieve of eligible multipliers and compiled boolean fills

Base: `7f6335b9371d6ea0830c350af93a5cd19dd8ebaa`.
The [problem](https://projecteuler.net/problem=545) asks for the 100000th
exponent whose linear coefficient has denominator 20010.
The default target Q=100000 has exact answer **921107572**.
The exclusion's historical 67-second estimate was stale: the current base
needs about 14.7 seconds compiled on Mac arm64 and 45 seconds on Intel x64.

## Algorithm

By von Staudt-Clausen, the required denominator 20010 forces k=308*m.
For an extra prime p, set g=gcd(p-1,308) and u=(p-1)/g. The even divisors
of 308 give eight possible g values. Such a prime excludes every multiple
of u. For m>1, a prime g*m+1 with gcd(g*m,308)=g cannot be one of the
required primes: each required p has p-1 dividing 308 and hence u=1.
This removes the separate allowed-prime membership mask.

The new sieve visits m in ascending order and inspects its eight possible
extra primes only while m remains eligible. If m was already excluded by a
smaller forbidden divisor u, every multiple of m is already excluded too.
The gcd condition is equivalently gcd(m,308/g)=1. All arithmetic uses the
existing `gcd`, `primesieve`, array masks and strided fills.

The initial bound is a guess max(1024,32*Q), with doubling if insufficient.
Default Q needs m=2990609, so the first bound 3200000 suffices instead of
rebuilding through 4194304. The finite `primesieve` domain still applies;
32 doubling attempts exceed that domain before they could silently stop.
The complete sweep leaves a mask from which array selection chooses the
Q-th survivor. There is one explicit loop; every Rank line fits 40 columns.

## Shared compiler change

The private Number row-slice lowering now accepts scalar boolean `=` fills.
It reuses the integer path's range checks and private transaction, including
variable/reverse strides and scalar leading coordinates on tensors. The
scalar is evaluated once, including for empty selections, and remains the
assignment result. Boolean array RHS values retain their existing routes.
Budgeted runs use the established exact backend; host polling guards remain
in force. Tests compare budget observations against that prior exact path.

No Number copy threshold changed. An early return/break prevented
proving enough work for the large flag copy. A full sweep plus final array
selection lets the existing range/copy proof admit the private loop.

The older integer slice-transform test needed explicit parentheses around
its RHS `mod` expression. Without them, the current parser reads a modular
write suffix. That compiler-counter failure also reproduced on the frozen
base. The test now checks the intended RHS transform and its actual values.

## Measurements

Primary data uses three alternating
fresh-process old/new pairs per mode, Node v24.15.0 on both hosts. Each
sample checks the exact answer. Time includes parsing/execution and excludes
module import. Diagnostics and profiling are disabled. RSS is the process
high-water mark. Intel samples also record load and other Node processes.

| Host/mode | Old seconds | New seconds | Old peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64, compiled | 14.735 | 2.433 | 927.7 | 327.5 |
| Mac arm64, reference | 14.783 | 9.411 | 961.6 | 587.7 |
| Intel x64, compiled | 44.684 | 7.462 | 734.1 | 300.6 |
| Intel x64, reference | 45.005 | 33.594 | 733.8 | 543.6 |

Mac reference RSS varied: old 944-962 MiB, new 586-892 MiB. The table uses
median high-water marks; the highest new sample is still below the lowest
old sample. Intel reference was steadier at 733-736 / 542-544 MiB.
No other Node process appeared in any Intel sample; one-minute load was
0.04-1.90 during the runs.

Single controls separate the rewrite from the compiler extension. New source
on the old runtime took 9.101 seconds / 613.3 MiB on Mac and 32.454 seconds /
605.2 MiB on Intel. Old source on the new runtime remained at 14.673 seconds /
935.7 MiB and 45.705 seconds / 723.0 MiB. Both changes are needed for the
full compiled gain. Reference also benefits from the sieve pruning.

## Verification and reproduction

An independent direct divisor/primality oracle checks the first 100 terms;
examples and small Q values run in Number, exact and reference modes. Tests
also force several bound doublings, reuse the solver for different Q, and
check the full result on all three backends. Compiler tests cover aliases,
positive/reverse/empty ranges, tensor rows, errors and budget fallback.
The full demo is restored to ordinary corpus execution.

Passed: TypeScript build; 271 focused checks on Mac and the same 271
checks on Intel (124 plus 147 in two runs); two filtered differential
checks for the full demo and its fixture on Mac. Exhaustive audits and
full npm test were not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler545.mjs compiled
node benchmarks/euler545.mjs reference
node benchmarks/euler545.mjs compiled 10
node benchmarks/euler545.mjs compiled 100000 benchmarks/fixtures/euler545-original.ra
```

`RANK545_RUNTIME` selects another built runtime. `RANK545_EXPECTED` checks a
golden answer. `RANK545_DIAGNOSTICS=1` and `RANK545_PROFILE=path` enable
separate diagnostic runs. Frozen base binaries were built from the commit
above. Raw samples are in `baselines/2026-11-09-euler545.json`.
