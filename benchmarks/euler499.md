# Euler 499: stable exponential bounds before the matrix solver

The default answer remains **0.8660312** for ticket price 15 and capital
1000000000. The statement fixture is unchanged. The main workload now fits
ordinary differential execution and is removed from its exclusion list.

## Why it was slow

The original algorithm iterates a 14 by 14 transfer matrix to the floating-point
floor. Each iteration evaluates 700 selected rows of matrix powers, using about
46 binary stages. Its historical exclusion says about 24 seconds; the frozen
current baseline is already faster. This change must not claim credit for that
earlier runtime improvement.

A companion-matrix prototype reduced the fixed-point work substantially, but
returned **0.8660313** at the default input. Raising an almost-unit eigenvalue
to a billion-scale exponent amplifies rounding error. That prototype is retained
as an experiment, not used in the demo.

## Program change and numerical argument

Let `q = exp(-a)` be the nontrivial root in `(0, 1)` of

```
sum(n >= 0, 2^(-n-1) * q^(2^n)) = q^Ticket.
```

The stopped process `q^Capital` is a bounded martingale. Ruin leaves capital
between 1 and `Ticket-1`; on survival capital tends to infinity almost surely.
Thus the survival probability lies between

```
1 - exp(-a * (Capital-Ticket+1))
1 - exp(-a * (Capital-1)).
```

The new default path bisects `a` directly. It evaluates the root equation as
weighted `-expm1(-a * payout)` terms against `-expm1(-a * Ticket)`, avoiding
subtraction of almost equal numbers. The first 100 payout terms have a remaining
probability mass of `2^-100`. A conservative floating-point guard widens sign
comparisons; uncertain comparisons retain the bracket. Eighty bisection steps
bound the work. This is ordinary binary64 arithmetic with a guard, not a new
arbitrary-precision or directed-rounding subsystem.

The result is returned only when both survival bounds round to the same seven
decimal places. Otherwise the existing layered matrix calculation remains the
fallback. This handles small capitals and rounding boundaries without guessing
an overshoot distribution or hardcoding the default answer. Ticket price 1 and
capital below the ticket price have direct boundary answers.

For the default input an independent 90-digit Decimal calculation gives bounds
**0.866031230202843659...** and **0.866031233703706362...**, which both round to
**0.8660312**. Nine checked-in oracle cases include other ticket prices, capital
sizes and a boundary where the two rounded answers differ. Tests check that the
Rank bounds enclose those independent bounds, and that uncertain cases actually
call the fallback. The oracle can be regenerated without third-party packages.

The source has one explicit loop, in the matrix fallback. Selected binary
powers use a tuple state and `repeat`; the root calculation uses array operations
and a bounded `repeat`. All Rank lines fit 40 columns.

## Reusable language and compiler support

`numbers.expm1` exposes JavaScript's stable exponential-minus-one primitive for
numbers, arrays and sequences. `1e-18 expm1` retains `1e-18`, whereas subtracting
one from its exponential loses it. The operation is described in the catalogue
and manual, maps completed numeric storage through the existing native batch
path, and can compose with surrounding deferred tensor arithmetic.

Number regions lower scalar and array calls to `Math.expm1` under the existing
native-binding guards. Tensor recipes carry its internal intrinsic and emit the
same operation in fused real kernels. Tests cover small values, exceptional
real values, sequence mapping, delayed type errors, numeric loops, deferred
fusion, a changed native binding and observable demand budgets.

The algorithm change supplies the large speedup. The new reference execution
is about as fast as compiled execution; these measurements do not imply a
28-fold improvement of the compiler itself.

## Measurements

Node 24.15.0 on Apple M5 and Intel i7-10750H. Each timed observation is a fresh
process with diagnostics disabled; RSS is process peak RSS, including parsing
and runtime startup. Default compiled results below are medians of three
alternating old/new pairs. Old source and runtime were frozen at `5c5a6217`.

| Host | Old compiled | New compiled | Old peak RSS | New peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 | 5.119 s | 0.193 s | 358.6 MiB | 187.1 MiB |
| Intel i7 | 12.494 s | 0.440 s | 350.7 MiB | 177.8 MiB |

Intel load averages before the three pairs were 0.08/0.05/0.07,
0.30/0.10/0.09 and 0.45/0.15/0.10. Old Intel times ranged 12.390–12.522 s;
new times ranged 0.440–0.448 s. No other benchmark or suite of ours ran there
concurrently. The Mac was noisier: old times 4.959–7.735 s, new times
0.180–0.243 s. These are per-host comparisons, not portable CPU speed ratios.

Single reference observations: Mac **6.126 -> 0.166 s**, Intel
**15.974 -> 0.413 s**; all answers agree. These are observations, not medians.
Raw results and input hashes are in the companion baseline JSON.

There is a tradeoff for the uncertain small case `Ticket=6, Capital=10000`,
which still invokes the matrix fallback and returns **0.995201**. Three Mac
pairs give median **1.057 -> 1.191 s**, **341.3 -> 370.3 MiB**. One Intel pair
gives **3.251 -> 3.869 s**, **324.4 -> 354.2 MiB**. The preliminary Mac baseline
had been slower under load; the repeated pairs supersede that apparent speedup.
The array-state rewrite of the fallback is not a memory improvement. Further
compilation of tuple-valued `repeat` states is a possible separate direction;
no unmeasured runtime policy is introduced here.

## Verification

- Nine Decimal oracle cases, with default, reference and exact-loop modes;
  statement fixture and forced-fallback checks: 9 tests. `expm1`: 8 tests.
  All 17 pass on Mac and Intel. The statement fixture tests have an explicit
  30-second budget because an Intel reference run alone takes about 5 seconds.
- Broader Mac numerical/tensor/manual run: **642 passed, 3 failed** out of 645.
  The same three counter-expectation failures reproduce on clean `5c5a6217`:
  two broadcast-shape cases in `tensor-broadcast-fusion.test.ts` and the empty
  filter scalar-error case in `tensor-kernel.test.ts`. They are not claimed
  as fixed by this change. Semantic/error assertions in those cases still pass.
- The analogous Intel run has the same three failures, plus three initial
  fixture timeouts at the default five-second test budget. The focused rerun
  with the explicit fixture budget passes all 17 new tests.
- Language ordinary suite: **1526 passed**. Generated CLI reference check passes.
- Filtered differential audit for this demo and its fixture: **2 passed on both
  hosts**. This is a scoped run, not the full differential corpus.
- After integrating concurrent main changes (`f626712c`), 89 focused tests
  pass on both hosts; full-input smokes still return 0.8660312 in 0.172 s
  on Mac and 0.465 s on Intel.
- Source/test TypeScript build passes. No exhaustive type/name corpus audit or
  full repository test run was started.

## Reproduction

```
node benchmarks/euler499.mjs compiled
node benchmarks/euler499.mjs reference
node benchmarks/euler499.mjs compiled 6 10000
python3 benchmarks/experiments/euler499-bounds.py
node benchmarks/experiments/euler499-companion.mjs
```

Use `RANK499_RUNTIME` with a frozen runtime and
`benchmarks/fixtures/euler499-original.ra` as the optional final source argument
for the old case. `RANK499_EXPECTED` checks an answer; `RANK499_DIAGNOSTICS=1`
enables a separate diagnostic observation. Do not compare timed observations
with diagnostic counters enabled to those without them.
