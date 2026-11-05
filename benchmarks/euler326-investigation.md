# Euler 326: modulo summations

Research against c39c6b28. Production demo and interpreter unchanged.
The next unchecked row in issue #447 was `euler/326_modulosums.ra`.

The original already compiles. Its six-million-step recurrence grows
`Weight` beyond the safe Number range; diagnostics record three overflow
replays and one mixed-integer loop. The final answer also needs exact
integer arithmetic. This is primarily an algorithmic opportunity, rather
than a missing compilation path.

## Exact replacement

For t >= 0 and r = 0..5, the prefix before term 6t+r+1 is

    S(6t+r) = 9t² + B[r]t + C[r]
    B = [-1, 3, 6, 7, 13, 14]
    C = [0, 1, 2, 2, 5, 5]

The term at 6t+r+1 is respectively

    [4t+1, 3t+1, t, 6t+3, t, 3t+3].

`experiments/euler326-formula-proof.py` checks polynomial identities over
exact rationals, including the recurrence quotients and induction between
six-term blocks. The first term is the given special case. The formula
also proves the 6M prefix-residue period: shifting t by M changes every
prefix by M(18t+9M+B[r]).

Keep one weighted histogram instead of Seen and Tail: for each prefix
position in a period add Whole, and add one more if the position is at
most Rest. Sum Count*(Count-1)//2 using exact arithmetic.

The preferred scalar prototype is `experiments/euler326-row-formula.ra`:
visit six residue classes in the outer loop and bind their coefficients
once. Reversing these loops creates a million interpreted inner loops;
that version is fast when compiled but substantially worse in reference
execution. A flat loop avoids those allocations but repeats coefficient
lookups and is also slower in reference execution.

## Array operations and compiler opportunities

The `.accumulate` prototype uses vector polynomial keys and scatter-add
into the weighted histogram. It is fast in both engines, but full-input
reference RSS increases from about 183 MiB to 428 MiB in a single control.
A 32768-element batching experiment reduces this to about 366 MiB, still
higher than the scalar version. Dropping the loop's final array result did
not solve the issue. Diagnostics on the reduced reference input report
35 typed array publications, with no COW copies or selection snapshots;
there is no evidence here for an alias-copy bug.

`sum by` is slower and uses more memory than `.accumulate` in this case.
The typed keyed-fold fast path in `src/keyed-fold.ts` accepts Int32 values
and keys; polynomial intermediate values exceed Int32. Deferred readers
are used in the plan prototype, but the Int32 keyed-fold counter stays
zero. Further work should measure fusion of integer polynomial producers
with scatter/fold consumers, preserving ordinary assignment boundaries,
exact overflow handling and error timing. This is a general optimization
candidate, not an implemented fix or a reason to weaken integer accuracy.

## Verification

The independent JS oracle checks all six million original terms and
prefixes against the formulas and returns 1966666166408794329.
Initial differential verification: 2790 programs on Mac, 1116 on Intel,
zero failures. Cases cover N=0, period boundaries, eight moduli and N up
to 10^30, in compiled, exact-loop and reference engines. The final loop
ordering is checked separately with the same independent oracles.

Timing harnesses run serial fresh Node processes and record peak process
RSS, not just live array payload. Mac: Apple M5; Intel: i7-10750H at
root@jack.lan. Both Node 24.15.0. Full final comparison uses three trials
per variant and engine at N=10^12, M=10^6. Earlier exploratory medians
include reference inputs reduced to M=10000 and must not be interpreted
as full-input reference timings.

Reproduce from the repository root:

```sh
python3 benchmarks/experiments/euler326-formula-proof.py
node benchmarks/experiments/euler326-oracle.mjs
node benchmarks/experiments/euler326-verify.mjs row-formula
node benchmarks/experiments/euler326-final-series.mjs
```

Final ordering verification adds 837 Mac programs (row, flat and batched)
and 279 Intel programs (row), all passing. Existing Euler 326 regression
file: four tests pass through the audit-config focused runner. No full
suite or exhaustive audit was started.

## Final full-input medians

| Host | Engine | Original seconds | Row formula seconds | Original MiB | Row formula MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| mac | compiled | 1.623 | 0.372 | 328.5 | 183.2 |
| mac | reference | 9.075 | 5.959 | 183.9 | 182.1 |
| intel | compiled | 4.594 | 0.454 | 282.8 | 171.1 |
| intel | reference | 21.009 | 15.125 | 170.6 | 167.3 |

Mac compiled row-formula samples range from 0.174 to 0.601 seconds,
so the 0.372-second median is noisy; do not present the fastest trial as
the expected speed. Intel compiled samples are 0.449..0.473 seconds.
Intel reference row-formula trial 1 overlapped a short verification run;
it is retained in raw evidence but excluded from final medians and
replaced by a fresh, isolated full-input run. All other local research
benchmarks were stopped before the final Mac series.

Recommendation: replace the recurrence with the row-formula weighted
histogram first. It wins in both engines and architectures without raising
RSS. Treat integer producer/scatter fusion as a separate measured compiler
improvement; do not choose the higher-memory vector version by default.
