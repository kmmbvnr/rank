# Euler 548: batched exponent frontiers and exact axis products

Base: `33b8e8dc06f1d3842dc8275b4c33631a33ad72bc`.
The [problem](https://projecteuler.net/problem=548) asks for fixed points of
the number of proper-divisor chains through 10^16. Exact answer:
**12144044603581281**, beyond Number's exact integer range.

## Program changes

The finite-difference counting formula is retained. For exponent pattern a,
T(j)=product binomial(a_i+j-1,j-1) counts weak divisor chains. Alternating
binomial coefficients remove repeated values, then sum over strict lengths.
Broadcast binomials and an axis scan now construct both coefficient tables.
Bit length bounds the exponent width and the required prime prefix, replacing
fixed limits 60 and 100.

Each frontier contains patterns with nonincreasing exponents on consecutive
primes, hence the least number for that exponent multiset. An exact upperindex
query against the next prime's powers gives each parent's permissible length,
clamped to its previous exponent. Prefix lengths and another upperindex map
all child positions back to parents. The old loop trying each of 60 exponents
and repeatedly concatenating accepted rows disappears.

Counts are evaluated within each frontier. Only the current product table is
retained for expansion; completed earlier tables are released. A possible
fixed point must lie between its pattern's minimum and L. For these candidates,
library factorization supplies the exponent multiset. A scalar memo function
returns its canonical minimum: largest exponents on smallest primes. Equality
with the generated minimum proves the fixed point. This replaces the manual
small-prime stripping loops and the residual-prime heuristic.

The Rank program has no explicit loops, and every line is within 40 columns.
The empty bound L=0 now returns 0; positive bounds retain the special fixed
point 1. Canonicalization is independent of the search bound.

## Shared compiler change

`A * B sum axis 0/1` can contract equally shaped stored integer matrices with
arbitrary-precision boxed cells directly, without retaining a product matrix.
The existing bounded word kernel keeps priority. Both matrix axes and their
negative spellings work. Trusted transposed and gathered views are supported.
Exact output can exceed int64, and cancellation can return compact storage.

Physical integer-kind proofs and uniform pure validation guard the readers.
Opaque readers, column contracts, shared buffers, inspection and demand budgets
keep their previous routes. The operation uses the existing guarded sum consumer;
no syntax or Number threshold changes. Real/mixed inputs retain ordinary paths.

## Measurements

Node v24.15.0 on Apple M5 arm64 and Intel i7-10750H x64. Three alternating
fresh-process pairs per mode; each sample checks the full exact result. Time
includes parsing/execution and excludes importing the interpreter. RSS is the
process high-water mark. Diagnostics/profiling are disabled. No other Node
process appeared in the Intel samples; one-minute load stayed at 0.10-1.06.

| Host/mode | Old seconds | New seconds | Old peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64, compiled | 6.194 | 0.535 | 634.2 | 373.8 |
| Mac arm64, reference | 6.294 | 0.576 | 613.2 | 409.3 |
| Intel x64, compiled | 15.284 | 1.692 | 497.3 | 349.7 |
| Intel x64, reference | 15.798 | 1.810 | 504.5 | 393.5 |

Memory varied on the baseline: Mac compiled 586-676 MiB, Intel compiled
488-707 MiB. Every new primary sample remains below the corresponding old
samples' minimum. New compiled peaks were 363-376 MiB on Mac and 348-362 MiB
on Intel; reference peaks were 409-412 and 392-395 MiB.

Most of the gain comes from the program rewrite. Single new-source/old-runtime
controls took 0.571 seconds / 403.9 MiB on Mac and 1.823 seconds / 397.9 MiB
on Intel. The exact contraction gives a smaller additional time gain and
reduces temporary storage. Old-source/new-runtime controls stayed at 6.243
seconds / 637.6 MiB and 15.401 seconds / 497.8 MiB. These controls are single
samples, not repeated medians.

## Verification and reproduction

Passed: TypeScript build; 161 focused checks on each host; two filtered
Mac differential checks for the full demo and its fixture. An independent
proper-divisor recurrence checks all small-bound cases; the million and full
results run on Number, exact and reference backends. Tests also cover canonical
patterns beyond the current search limit. Wide-axis tests cover both signs,
negative axes, transposed/gathered inputs, compact cancellation, redefinition,
opaque/real/shared inputs and cancellation/budget fallback. The full demo is
restored to ordinary corpus execution. Exhaustive audits/full npm test were
not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler548.mjs compiled
node benchmarks/euler548.mjs reference
node benchmarks/euler548.mjs compiled 1000000
node benchmarks/euler548.mjs compiled 10000000000000000 benchmarks/fixtures/euler548-original.ra
```

`RANK548_RUNTIME` selects another built runtime; `RANK548_EXPECTED` checks a
golden answer. `RANK548_DIAGNOSTICS=1` and `RANK548_PROFILE=path` enable separate
diagnostic runs. Raw samples: `baselines/2026-11-09-euler548.json`.
