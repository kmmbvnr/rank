# Euler 565: odd progression sieve and bounded trigger pairs

Base: `8c2f05ed6e14bdc26621e7adb4fe5c02ff8728ce`.
Full answer: **2992480851924313898**, beyond exact Number arithmetic.

## Program and correctness

Sigma is multiplicative. A prime-power valuation triggers divisibility by
2017 when the prime's multiplicative order modulo 2017 divides exponent+1.
Residue 1 would need exponent 2016 and cannot contribute at the default bound;
the prime 2017 never triggers. Residue -1 gives the large order-two list.

Its primes are now sieved as 4034*j-1: the odd half of the old progression.
A boolean bitmap replaces the integer marker table. Modular inverses and
first composite positions are calculated in arrays. One prime loop marks
strided ranges. A `sieve` function keeps mask allocation and writes in one
private execution region, avoiding an entry snapshot and dirty tracking for
this local array. This is ordinary Rank function scope, with no new syntax.

The small-order exponent reduction uses a fold over the prime factors of 2016.
Prefix sums and insertion searches expand only possible prime powers, then an
exact bound check removes excess powers. Sorting the combined events once
lets another insertion search bound each pair's range. Ragged expansion builds
only pairs whose product fits, instead of scanning the entire prime list for
each small trigger. Events for the same prime are mutually exclusive.

For exact valuation p^e, the weighted sum is
`p^e * (tri(N//p^e) - p*tri(N//p^(e+1)))`. Pairs use the analogous four-term
inclusion-exclusion expression. As in the original, singles minus pairs is
valid through the default N=10^11: the three smallest triggers are 12101,
24203 and 48407, whose product exceeds 10^11. This is not an arbitrary-bound
implementation of higher-order inclusion-exclusion.

The program has one explicit loop, no nested loops and no lines over 40 columns.
An independent divisor-sum sieve checks nine bounds through a million,
including either side of the first trigger. The billion statement example and
full exact answer run on compiled, exact and reference configurations.

## Shared compiler/runtime improvement

An already stored boolean input used to be copied through its per-cell Proxy
into Float64 storage before entering a Number loop. Trusted private bitmaps
now unpack directly into Uint8 snapshots: one byte rather than eight per cell.
The invocation-private snapshot, dirty tracking, alias isolation and exact
replay/publication contracts remain. Demand budgets, shared buffers and opaque
readers retain ordinary preparation. Cancellation checkpoints remain in place.

This gap was exposed by the external-mask version of the new program. The
selected local-mask solution already avoids that snapshot, so it gains little
from this runtime change. `fixtures/euler565-external-mask.ra` retains the
external form to measure the shared improvement independently.

## Measurements

All modes check the full exact answer in fresh serial processes. Each reported
value is the median of three samples; old/new modes alternate. Time includes
parsing/execution and excludes interpreter import. RSS is the process high-water
mark. Diagnostics and profiling are disabled. Raw samples and host load are in
`baselines/2026-11-10-euler565.json`.

Mac M5 arm64, Node v24.15.0:

| Variant | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Old compiled | 2.838 | 978.7 |
| New compiled | 0.592 | 469.5 |
| Old reference | 2.302 | 977.5 |
| New reference | 0.747 | 616.7 |
| New source / old runtime | 0.593 | 473.6 |
| External mask / old runtime | 3.655 | 734.7 |
| External mask / new runtime | 1.463 | 477.9 |

The primary gain comes from the demo rewrite. The external-mask control
separately demonstrates the shared snapshot improvement; it is not the chosen
demo's timing. The original source and both control sources are retained.

Intel i7-10750H x64, Node v24.15.0:

| Variant | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| Old compiled | 7.445 | 683.5 |
| New compiled | 1.521 | 453.2 |
| Old reference | 6.012 | 685.6 |
| New reference | 2.100 | 546.8 |
| New source / old runtime | 1.562 | 457.6 |
| External mask / old runtime | 10.066 | 624.3 |
| External mask / new runtime | 3.802 | 452.5 |

Sampled one-minute host load ranged from 1.12 to 1.62 on Mac and 0.11 to 0.95
on Intel. No claim of a dedicated isolated machine is made. Intel old compiled
RSS varied from 638 to 718 MiB; all new compiled samples were 452–454 MiB.

## Verification and reproduction

Passed: TypeScript build; 302 focused checks in eleven files on each host; two
filtered differential checks on each host; two Mac inferred-type and two
name-fact checks; five exclusion-policy checks. Full exhaustive audits/full npm
test were not run. The full default demo is restored to ordinary corpus runs.

```sh
node benchmarks/euler565.mjs compiled
node benchmarks/euler565.mjs reference
node benchmarks/euler565.mjs compiled 1000000
```

`RANK565_RUNTIME` selects a built interpreter and `RANK565_EXPECTED` checks
the exact answer. Diagnostics/profiling are separate from primary timings.
