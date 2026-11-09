# Euler 558: exact polynomial powers and wide search batches

Base: `2c6bce1dcf08c569968b32b798ae53c02fa492e9`.
[Problem 558](https://projecteuler.net/problem=558), full M=5000000 answer: **226754889**.

## Program

The problem's root satisfies r^3=r^2+1. The greedy representation therefore
has gaps of at least three between selected powers. The implementation keeps
that algorithm, but removes the per-round logarithm, exponent repair arrays,
previous-exponent arrays and numerical stopping tolerance. A sorted power
table supplies the next exponent through `upperindex`.

Powers are represented as exact coefficient triples in Z[r]. Forward and
backward scans use r^(e+3)=r^(e+2)+r^e, so every algebraic identity remains exact.
The triples are evaluated once into scaled integers; the greedy remainder
ends at exact zero. The bit length of M bounds the leading exponent. The
negative window is conservatively set to twice that height plus twenty; the
full run checks termination for all five million squares. This is not a proof
of that window's sufficiency for arbitrarily large arguments.

Precision is derived from the coefficient table rather than a fixed 70 decimal
digits. Let B=M^2+2*sum(abs(coefficients)), using max(M,1) for the bound.
Every residual-minus-candidate polynomial P=a+b*r+c*r^2 has coefficient L1
norm at most B. The other roots z and conjugate(z) have modulus below one.
The nonzero cubic norm is an integer, so |P(r)|>=1/B^2. Approximating r from
below by floor(Scale*r)/Scale and r^2 by floor(First^2/Scale)/Scale incurs
less than 5*B/Scale error. Choosing Scale>5*B^3 therefore preserves every
nonzero sign; zero polynomials evaluate to exact zero. The program selects
Scale=2^(3*bit_length(B)+4), 190 fractional bits at the default bound.

One explicit loop alternates loading a bounded batch and consuming one greedy
term from all live residuals. There are no nested loops; all Rank lines fit
40 columns. Block width 125000 balances transient storage and throughput.
A scalar function mapped with ranks used less compiled memory but its reference
run at M=100000 took 7.51 s; it was rejected. Smaller array batches saved more
memory but approached the old running time. Larger batches were faster but
had higher memory peaks in exploratory runs.

## Shared runtime

Stored arbitrary-precision integer vectors can now be searched by vector or
tensor targets through the existing batch path, including mixed boxed/Int32/
Int64 storage and trusted linear views. This removes a separate scalar search and reader dispatch per
query. Both insertion-bound variants remain exact, including negative keys,
duplicates and values far beyond Int64. Source revision checks retain edits.

For sufficiently large batches, a Number image of the source can accelerate
search if all images are strictly increasing. Integer-to-Number conversion is
monotone; a Number upper bound can then overshoot the exact boundary by at
most one source element. One exact comparison repairs it, for either lower
or upper insertion semantics. Rounded collisions retain the exact logarithmic
search. Even distinct infinite endpoint images are repaired against the
original integers. No approximate comparison becomes a Rank result directly.

Opaque readers, unestablished contracts, shared integer buffers, inspection,
observable host polling and demand budgets keep their ordinary paths. The
source-key temporary is bounded by the output count. This is a shared native
kernel used by compiled and reference execution; no language syntax or Number
precision/copy-admission threshold changed.

## Measurements

Three alternating fresh-process old/new pairs per mode and input, Node
v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Time includes parsing and
execution, excluding runtime import. RSS is the process high-water mark.
Diagnostics/profiling are off. Every full sample checks 226754889; fixture
samples execute the unchanged statement tests with the corresponding module.

Primary pairs used the candidate kernel before the final shared-Int32 storage
guard. That guard changes only admission of shared compact buffers, absent
from these workloads; the default boxed source/target route is unchanged.
Final focused and full differential checks use the rebuilt guarded runtime.
The raw artifact records both kernel hashes.

The corpus keeps its existing 300 s budget per individual backend. An explicit
per-demo timeout entry lets the differential harness grant 600 s for both
diagnostic runs together; the Mac comparison takes about 153 s, with higher
cost than the uninstrumented primary runs. This does not raise the ordinary
per-backend budget.

| Input / host / mode | Old s | New s | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Full / Mac / compiled | 78.131 | 47.108 | 564.2 | 547.6 |
| Full / Mac / reference | 79.575 | 48.065 | 557.6 | 523.8 |
| Full / Intel / compiled | 192.441 | 105.252 | 565.0 | 530.8 |
| Full / Intel / reference | 195.430 | 108.798 | 558.4 | 614.1 |
| Fixture / Mac / compiled | 0.620 | 0.432 | 399.6 | 281.4 |
| Fixture / Mac / reference | 0.601 | 0.415 | 388.9 | 276.5 |
| Fixture / Intel / compiled | 1.696 | 1.115 | 373.7 | 267.0 |
| Fixture / Intel / reference | 1.560 | 1.081 | 371.6 | 266.1 |

Full compiled time falls by 39.7% on Mac and 45.3% on Intel; reference time
falls by 39.6% and 44.3%. Compiled RSS falls by 2.9% and 6.1%. Reference RSS
falls by 6.1% on Mac but **rises by 10.0% on Intel**. These are median peaks,
not a guarantee that every new process uses less memory. New compiled Mac
peaks span 531.5-599.2 MiB; new Intel reference peaks span 556.7-615.4 MiB.
The raw artifact includes per-sample loads and RSS. Process snapshots on Intel
showed the benchmark Node process as the main CPU consumer.

Direct 100000-query native search controls use exact independent answer checks
outside the timed region. Spread-key medians fall from 18.531 to 8.769 ms on
Mac and 41.342 to 18.014 ms on Intel. Rounded-collision cases retain exact
searches and improve from 18.129 to 11.417 ms and 43.087 to 21.386 ms. These
are kernel timings, not end-to-end speedups.

A straight JavaScript control uses the same 303 powers and 190-bit scale;
its table hash is checked against Rank. One full scalar-traversal sample took
9.350 s / 56.2 MiB on Mac and 19.892 s / 59.2 MiB on Intel. It constructs the
table and processes one integer at a time. Rank retains bulk residual,
gather and filtering stages. This is useful compiler headroom, with different
scheduling and storage, rather than a universal language-overhead ratio.
Fusing wide-integer stages with their consumer remains an opportunity.

Additional memory attempts were not selected. An exclusive Int32 offset-reuse
prototype passed its focused semantic tests but took 52.35 s / 805 MiB for
Mac reference execution. Explicit copying after pruning took 52.38 s / 535 MiB;
a 75000-cell block took 58.57 s / 522 MiB. These are exploratory single runs,
compared with the selected reference median 48.07 s / 524 MiB. The prototype
ownership/runtime changes are not delivered.

Single bounded source/runtime crossover controls at M=100000 are included in
the raw data. They are not full-input medians and should not be extrapolated.

## Verification

TypeScript build and 158 focused checks passed on each host. Two filtered
differential checks passed on each host for the full program and its fixture.
Two filtered type checks and two filtered name-facts checks also passed on Mac.
The instrumented Intel differential pair took 283 s for the full program
and about 2 s for its fixture.

A broader exploratory ownership-suite run reproduced a pre-existing compiled
COW-counter assertion on frozen base 2c6bce1d; alias values match. No ownership
changes or altered expectations from that experiment are delivered.

The independent oracle evaluates polynomial signs with certified rational
root intervals, refining them if needed; it does not use the program's scaled
power table or its norm bound. Tests verify both statement decompositions,
small cumulative sums, partial batches, isolated large squares, coefficient
recurrences and the precision inequality. Search tests cover both insertion
bounds, rounding collisions, infinite images, negative/huge integers,
strided/reversed views, mutation, deferred checks, budgets, host polling and
shared memory. Exhaustive audits/full npm test were not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler558.mjs compiled
node benchmarks/euler558.mjs reference
node benchmarks/euler558.mjs compiled fixture demos/euler/558_irrationalbase_test.ra
node benchmarks/euler558.mjs compiled 5000000 benchmarks/fixtures/euler558-original.ra
node benchmarks/euler558-oracle.mjs 1000
node benchmarks/euler558-search.mjs 100000
node benchmarks/euler558-search.mjs 100000 collision
node benchmarks/euler558-native.mjs 5000000
```

`RANK558_RUNTIME` selects a built runtime; `RANK558_MODULE` selects the module
for the unchanged fixture; `RANK558_EXPECTED` checks a golden result. Profiling
and diagnostics are opt-in (`RANK558_PROFILE`, `RANK558_DIAGNOSTICS=1`).
Raw samples: `baselines/2026-11-09-euler558.json`.
