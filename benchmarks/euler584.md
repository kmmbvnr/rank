# Euler 584: integrate the transfer polynomial

Based on `c0a38108185f7e6c7809bdb33d706b771cc82a2d`.
The default `N=365, K=4, D=7` still returns **32.83822408**. The statement
checkpoints remain **5.78688636** and **8.48967364**. The original coefficient
DP is preserved in `fixtures/euler584-original.ra`; its old 80-second issue
entry is stale: the current compiler already runs it in about four seconds
on Mac. The expensive uncompiled nested loops remain worth replacing.

## Probability and polynomial

If T is the number of arrivals at the first matching birthday group,

    E[T] = sum(n>=0) P(T>n)
         = sum(n>=0) A(n) n! / N^n.

A(n) sums the weights `prod(1/c_day!)` of admissible day-count vectors totalling
n people. Every cyclic window of D+1 days may contain at most K-1 people.
Adding those N window constraints bounds the degree by

    Limit = floor(N*(K-1)/(D+1)).

States remember the last D day counts, whose sum is below K. There are 120
states for the default. Appending c people gives one transition weighted by
`x^c/c!`. Each cyclic year has exactly one closed path through the states, so

    A(x) = trace(Transfer(x)^N).

The previous program propagated every polynomial coefficient, for every
initial state, over all N days. Instead, the factorial moments give

    E[T] = integral(0,infinity) exp(-t) A(t/N) dt.

Gauss-Laguerre quadrature integrates a polynomial of degree at most `2q-1`
exactly in exact arithmetic. Thus `q=Limit//2+1` covers the entire polynomial;
there is no probability-tail cutoff. The implementation uses the existing
`eigh`, `matpow`, `diag` and array operations, plus one loop for polynomial
weights. See the [NIST quadrature formulas](https://dlmf.nist.gov/3.5) and
[SciPy's degree guarantee](https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.roots_laguerre.html).

The symmetric Laguerre Jacobi matrix has diagonal 2i+1 and off-diagonal i+1.
Its eigenvalues supply the nodes. Tiny first-eigenvector components are not
accurate enough for the weights in this workload: squaring those components
gave **2.0822102421005616e41**, despite plausible eigenvalues. The final program
instead evaluates Laguerre polynomials by their three-term recurrence and uses

    weight(x) = x / ((q+1)*L_(q+1)(x))^2.

All floating-point calculations remain approximate. Independent small-case
counts, both statement values, the original DP, the full eight-place answer
and an extra-node unrounded stability check validate the chosen computation.

## Shared matrix-power runtime

`matpow` previously boxed every completed real product with `Array.from`,
then its next multiplication repacked it. The runtime now snapshots trusted
Float64 inputs directly and retains the typed storage of completed private
products. Positive real powers reuse at most three product buffers and one
transpose buffer per invocation. No input or global scratch cache is retained;
the final output is separate from the scratch available to later calls.

The initial snapshot still precedes a following modulus expression. Power one
retains the prepared snapshot identity. Integer/modular powers keep their
existing paths, negative powers retain inversion, and budget/observable
polling routes recheck policy before using the new path. Shape and storage
length checks keep malformed physical layouts on ordinary validation.
Cancellation inside squaring discards only private work and leaves the
prepared input available for another run. No Number threshold or syntax
changes were introduced. This is shared native numerical execution used by
compiled and reference programs, not a new Euler-specific JIT rule.

## Measurements

| Host | Compiled before → after | Peak RSS before → after |
| --- | --- | --- |
| Mac M5 | 3.915 → 0.693 s (5.65x) | 188.6 → 213.6 MiB |
| Intel i7-10750H | 7.601 → 1.758 s (4.32x) | 186.9 → 192.6 MiB |

The new algorithm adds about 25 MiB peak RSS on Mac and 6 MiB on Intel
versus the original compiled scalar DP; this is a measured tradeoff.


Three alternating fresh-process old/new program pairs per host use the final
runtime. All completed default runs check the full answer. Interpreter import
and construction are untimed; parsing/execution are timed. RSS is the process
high-water mark. Diagnostics/profiling are off, with no tests or benchmarks
from this session overlapping measurements on the same host.

| Host | Full new reference | N=100 reference before → after |
| --- | --- | --- |
| Mac M5 | 0.701 s / 208.8 MiB | 9.448 → 0.130 s |
| Intel i7-10750H | 1.796 s / 188.1 MiB | 37.045 → 0.343 s |


The original full reference exceeded the 30-second control deadline on both
hosts. Bounded reference pairs use the official `N=100,K=3,D=7` checkpoint.
No exact full-reference speedup factor is claimed.

| Host | New program, old → final runtime | Peak RSS old → final runtime | Hot matpow, old → final |
| --- | --- | --- | --- |
| Mac M5 | 1.343 → 0.695 s | 418.3 → 214.7 MiB | 319.520 → 176.931 ms |
| Intel i7-10750H | 3.299 → 1.736 s | 404.9 → 193.0 MiB | 856.629 → 457.456 ms |


The runtime control keeps the new Rank source unchanged and swaps between the
frozen baseline runtime and final runtime. The prepared-kernel control excludes
imports, preparation and two warmups, then times twenty powers of a 128-square
matrix. Its dyadic entries make the expected idempotent result exact; every
output cell is checked, and the full-output digest must match across runs.

## Rejected alternatives

- Marking one birthday and using cyclic symmetry reduces the coefficient DP
  from 120 starting states to 36. A scalar prototype took 1.560 s / 206.0 MiB
  on Mac, but still leaves the reference nested loops expensive.
- A rectangular gather/axis-sum DP took 10.905 s / 384.5 MiB; its reference run
  took 11.037 s. Marking and compacting that array DP reached about 3 s, with
  roughly 272-384 MiB peaks. These temporary-array costs were not acceptable.
- A native selected-axis completion prototype did not reach the intended
  producer and was stopped after 90 seconds. It is not shipped.
- Dense real keyed accumulators and streamed real expression readers were
  prototyped. Streaming did not beat completed inputs here and retained more
  memory; none of those keyed-reader or reduction changes are shipped.
- The final quadrature program on the old matrix-power runtime was faster
  than the original compiled DP but had a much higher memory peak. Unboxed
  intermediates and invocation-local buffer reuse address that runtime cost.

Exploratory timings are individual samples from evolving implementations,
kept separately from the final paired measurements. The final whole-program
RSS comparison is reported explicitly; runtime memory savings do not imply
that the new algorithm uses less memory than the old compiled scalar DP.

## Verification and reproduction

759 distinct focused checks pass on each host. Six filtered Mac corpus checks
(main and fixture in differential, inferred types and name facts), TypeScript
source/test builds and five exclusion-policy checks also pass.
The independent oracle enumerates labelled birthdays, including ties and
wrapped windows; it uses no transfer matrix or numerical quadrature. Tests
cover small calendar sizes, K=1, both statement checkpoints, original-DP
comparisons, the full default in three execution modes, and stability with an
extra quadrature node. Matrix-power checks cover zero/positive/negative powers,
signed zero, NaN/infinities/overflow, malformed physical storage, snapshots,
output independence, bounded scratch, policy changes and running cancellation.
The full main returns to ordinary corpus execution; its fixture is unchanged.
Full npm test and exhaustive audits were not run.

```sh
node benchmarks/euler584.mjs compiled
node benchmarks/euler584.mjs reference
node benchmarks/euler584.mjs compiled 365 4 7 benchmarks/fixtures/euler584-original.ra
node benchmarks/euler584-matpow.mjs 20
```

`RANK584_EXPECTED` checks an answer; `RANK584_RUNTIME` selects another built
runtime. Diagnostics use `RANK584_DIAGNOSTICS=1` in separate runs. Raw samples:
`baselines/2026-11-11-euler584.json`.
