# Euler 554: sparse factorial queries and streaming modular folds

Base: `0f4a65e276ccd9d0f56f56dd467448d9ce08fb0f`.
Full answer for Top=90: **89539872**; Top=5: **2073**.

## Program

The central-binomial/Lucas formula is retained. Instead of constructing a
factorial-block table across the whole prime (100000007), reflect factorial
arguments with Wilson's theorem, sort distinct required arguments and reduce
disjoint gaps. A scan combines the gap products. Only the queried factorials
are retained; total gap traversal is at most the largest reflected argument.
The lazy `Span'` binding deliberately exposes each range to its consumer.
Library Fibonacci numbers replace the recurrence. An integer bit bound chooses
the Lucas digit width, replacing the fixed three-digit limit. The source has
no explicit loops and every line fits 40 columns.

## Shared runtime

A declaration-proved pure modular sum/product callback can now reduce a trusted
arithmetic range directly, without completing a range array or calling the
Rank function for each element. Existing exact modular word arithmetic handles
moduli through 2^31; wide starts, strides and seeds are normalized with BigInt.
The first real fold checks the function's return contract and its result is
reused. Empty/singleton folds do not demand an unused captured modulus.

This is a native interpreter consumer, also available with compilation=false;
no generated JavaScript is required. Opaque readers, replaced iterators,
execution observers, inspection, demand budgets and unsupported moduli retain
the ordinary route. Captured moduli are resolved per invocation. Cancellation
is checked in bounded chunks and no persistent numeric cache is added.

The differential collector previously installed user execution hooks merely
to count compiler entries. Those hooks select observer-compatible execution
and disabled the production fast path: the final full demo took about 89 s
under that collector. It now reads passive diagnostics, and the two demo cases
plus an audit regression finish their test bodies in about 1.05 s on Mac.
`entryAccounting: passive-diagnostics-v1` identifies the new lower-bound counts;
they are not comparable to old hook-event totals. Actual user hooks keep their
existing behavior. The regression verifies the native consumer is exercised
in both audit modes.

An unrelated dice test expected exactly 16 kernel entries, but both the frozen
base and current runtime produce 18 with identical retained values and plans.
Its backend assertion now requires compiled activity rather than a particular
kernel partition; all semantic assertions remain.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Three alternating
fresh-process pairs per mode and input; medians below. Each sample verifies
the result (or the unchanged test fixture). Parsing/execution are timed,
interpreter import is excluded. RSS is process high-water memory. Primary
runs disable diagnostics and profiling. Intel load was low during sampling.

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled, full | 0.770 | 0.454 | 184.0 | 184.3 |
| Mac reference, full | 2.232 | 0.444 | 444.3 | 178.8 |
| Intel compiled, full | 1.818 | 0.805 | 170.5 | 170.7 |
| Intel reference, full | 6.419 | 0.774 | 326.4 | 165.8 |
| Mac compiled, fixture | 0.726 | 0.151 | 186.2 | 183.2 |
| Mac reference, fixture | 0.850 | 0.137 | 411.9 | 180.1 |
| Intel compiled, fixture | 1.893 | 0.387 | 171.5 | 169.7 |
| Intel reference, fixture | 2.811 | 0.351 | 334.1 | 165.3 |

Compiled full-run RSS is effectively unchanged; reference memory falls
substantially. These timings combine the algorithm and runtime changes.
A separate unchanged-source modular factorial fold over 100000 elements
isolates the generic consumer. Producer setup and an independent BigInt oracle
are outside this timer; parsing the reduction and executing it are inside.

| Host/mode | Old milliseconds | New milliseconds |
| --- | ---: | ---: |
| Mac compiled | 37.243 | 4.862 |
| Mac reference | 59.091 | 4.817 |
| Intel compiled | 107.198 | 11.250 |
| Intel reference | 166.187 | 10.950 |

## Verification

TypeScript build; 389 focused checks on each architecture (the Intel rerun
supplied a missing checked-in benchmark fixture before its two affected cases
passed). Coverage includes independent exact small central binomials, small-
prime Lucas oracles through Top=200, unsorted/reflected factorial queries,
full answers on Number/exact/reference backends, negative/wide range arithmetic,
empty/singleton behavior, user callbacks, budgets and opaque source fallback.
Three filtered differential checks passed on each host. Exhaustive audits and full
npm test were not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler554.mjs compiled
node benchmarks/euler554.mjs reference
node benchmarks/euler554.mjs compiled fixture demos/euler/554_centaurs_test.ra
node benchmarks/euler554-range.mjs reference 100000
```

`RANK554_RUNTIME` selects another built runtime; `RANK554_MODULE` selects the
module imported by the fixture, and `RANK554_EXPECTED` checks the answer.
`RANK554_DIAGNOSTICS=1` / `RANK554_PROFILE=path` select separate diagnostic runs.
Raw samples: `baselines/2026-11-09-euler554.json`.
