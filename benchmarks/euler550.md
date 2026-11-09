# Euler 550: count prime-factor prefixes instead of a dense sieve

Base: `15203fffc0bf012636d3e2c10ebaf897e60e8441`.
Full input N=10000000, K=1000000000000; exact answer **328104836**.

The previous program builds Omega(n), the number of prime factors with
multiplicity, for every integer through N. A prime-power sieve fills this
large array, then a histogram immediately discards its individual entries.
Existing Number loops already made it much faster than the historical issue
figures; reference execution still paid for hundreds of thousands of loop
iterations and the full table.

The new program counts the histogram directly. Each frontier contains products
of nondecreasing primes and the index of their smallest permissible next prime.
For prefix x and minimum index i, `upperindex(N // x) - i` counts every possible
last prime together. These are exactly the numbers with one more prime factor
than the current depth. Extend a prefix only by p satisfying p*p <= N//x,
so the child still admits a final prime at least p. Prefix lengths, `scan` and
`upperindex` expand only these children. Nondecreasing indices give every
integer a unique factorization path, including repeated prime factors.

The stored prime list comes from the existing library. At the default bound it
contains 664579 compact integers, replacing the 10000001-cell Omega array.
A quotient prime-count-table prototype had similar timings but required more
code and did not reduce default-process peak memory, so the shorter library
variant was retained.

The Grundy recurrence and Walsh-Hadamard counting formula are retained. Their
widths now follow the actual histogram and reachable Grundy values, replacing
fixed limits 30/64/128. The Rank program has one small explicit loop for the
Grundy table and all lines fit 40 columns. Empty item sets and K=0 return zero
winning positions. There is no hand-written memo index or new language form.

## Compiler/runtime

No shared compiler/runtime code changes are needed. Both source variants use
the same built runtime. The new algorithm spends its work in existing native
prime generation, batched searches, scans, keyed sums and tensor operations;
reference and compiled execution now have similar times. A record-helper scalar
compilation rejection is not a material bottleneck at this input and does not
prevent the native array operations from running efficiently.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Five alternating
fresh-process pairs per mode and host, with the full answer checked in every
sample. Timings include parsing/execution and exclude interpreter imports.
RSS is the process high-water mark. Intel samples reported no other Node
processes; load averages are retained with the raw samples.

| Host/mode | Old seconds | New seconds | Old peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.409 | 0.210 | 306.0 | 191.7 |
| Mac reference | 1.323 | 0.204 | 507.8 | 190.8 |
| Intel compiled | 1.093 | 0.517 | 289.4 | 178.9 |
| Intel reference | 4.015 | 0.503 | 488.4 | 179.2 |

All figures are medians of five. The main result is eliminating the dense table
and explicit prime-power work, rather than a compiler threshold or special case.

## Verification

TypeScript build; 97 focused checks on each host; two filtered Mac differential
cases for the demo and its Rank fixture. Independent tests enumerate actual
proper-divisor moves, compute mex values and use a direct XOR convolution for
small N and K. A separate trial-factor oracle checks the Omega histogram through
10000. Full Number, exact and reference runs assert both the golden result and
histogram total N-1. Cases include empty sets, K=0 and prime-power boundaries.
No exhaustive audit or full npm test was run.

```sh
node benchmarks/euler550.mjs compiled
node benchmarks/euler550.mjs reference
RANK550_K=5 node benchmarks/euler550.mjs compiled 10
node benchmarks/euler550.mjs compiled 10000000 benchmarks/fixtures/euler550-original.ra
```

`RANK550_RUNTIME` selects another built interpreter; `RANK550_EXPECTED` checks
the answer. Diagnostics/profiles use separate optional runs. Raw measurements:
`baselines/2026-11-09-euler550.json`.
