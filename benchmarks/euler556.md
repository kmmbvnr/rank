# Euler 556: residual sieve and exact square-root reductions

Base: `469c39f2`. Full N=10^14 answer: **52126939292957**.

## Program

The Gaussian Mobius/disc formula is unchanged. The sieve now divides factors
out of residual cofactors instead of building their products and then dividing
a second full range. Temporary sieve arrays live inside a helper. Prime 2 is
included even when it exceeds the square root of a small sieve bound; an
independent Gaussian-square-divisor oracle caught this boundary during work.

A pure quarter-disc function replaces the second explicit loop. Its array
expression computes integer roots and a sum. Removing the common factor four
avoids scaling every disc count before the final division. The quotient groups
still cover all m; an approximate cube-root split affects cost, not correctness.
The program has one explicit loop, existing library prime generation, and no
lines beyond 40 columns. The full demo returns to ordinary corpus execution.

## Shared compiler

Structural numeric functions now admit pointwise integer `isqrt` over arrays,
including reshaped tensors and sums. Nonnegative safe-integer bounds prove the
domain; generated code calls the shared corrected integer square root. The
root array stays virtual inside a reduction. Negative inputs, wider integers,
redefined builtins and unsupported layouts retain ordinary execution. Numeric
range, reduction-prefix and final-result guards remain in place.

The copy-cost proof now preserves range length through explicit `array`
completion, as it already did for `copy`. It never evaluates an opaque source
or changes the copy threshold. Existing immutable-entry, early-exit, alias and
exact replay guards still apply. Completed ranges can therefore prove enough
work to amortize the private snapshot of a sieve destination.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Three alternating
fresh-process pairs for each mode/input. Medians below include parsing and
execution, exclude importing the interpreter, and use process high-water RSS.
Diagnostics and profiling are disabled. Intel load during samples was 0.89-1.77
(one-minute average); the preceding process check showed no other Node job.

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled, full | 2.111 | 2.007 | 1164.6 | 806.9 |
| Mac reference, full | 4.130 | 4.164 | 1287.6 | 1197.2 |
| Intel compiled, full | 5.113 | 4.929 | 742.3 | 649.3 |
| Intel reference, full | 10.669 | 11.080 | 758.1 | 637.6 |
| Mac compiled, fixture | 0.180 | 0.190 | 188.4 | 187.4 |
| Mac reference, fixture | 0.177 | 0.187 | 187.9 | 187.7 |
| Intel compiled, fixture | 0.470 | 0.490 | 175.2 | 179.1 |
| Intel reference, fixture | 0.485 | 0.503 | 178.2 | 175.4 |

Full compiled speed improves modestly (about 4-5%); Mac compiled memory falls
31%, Intel compiled memory 13%. Mac reference times overlap. Intel reference
is about 3.8% slower in these samples while peak memory falls 16%. The small
fixture pays about 10-20 ms more preparation; its memory is broadly unchanged.
This is a memory/compiler-coverage improvement, not a large overall speedup.

An unchanged quarter-disc expression at norm=10^10 isolates the numeric
function improvement. An independent lattice sweep checks the result outside
the timer; parsing/setup are also outside. Three alternating pairs give
**5.976 -> 2.744 ms on Mac**, **14.197 -> 6.996 ms on Intel**. Full-program
single crossover controls on Mac: new source/old runtime 2.967 s / 1158.3 MiB;
old source/new runtime 2.081 s / 1176.2 MiB. These are single controls, not medians.
A segmented sieve prototype reduced some temporary storage but took about
2.9 s on Mac and was not selected.

## Verification

TypeScript build; 181 focused checks on each architecture, including 51 Euler
checks, 10 square-root function checks, 47 adaptive-loop checks and 73 adjacent
numeric-function/tensor/scalar checks. Independent Gaussian square divisors
cover small inputs, statement cases include N=10^8, and N=10^14 runs on Number,
exact and reference backends. Quarter discs cover perfect-square boundaries.
Compiler checks cover safe-integer square boundaries, negative/wide fallback,
reshapes, builtin availability, completed ranges, empty ranges, early exits,
overflow replay and aliases. Two filtered differential checks pass on each host.

The existing `numeric-function.test.ts` additionally has 41 passing cases and
five failures asserting use of a specific compiler route. All five reproduce
unchanged on the frozen base, with semantic comparisons passing; they are not
claimed fixed here. Exhaustive audits/full npm test were not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler556.mjs compiled
node benchmarks/euler556.mjs reference
node benchmarks/euler556.mjs compiled fixture demos/euler/556_squarefreegaussian_test.ra
node benchmarks/euler556-disc.mjs 10000000000
```

`RANK556_RUNTIME` selects another built runtime; `RANK556_MODULE` chooses the
module imported by the fixture; `RANK556_EXPECTED` checks its answer. Profiling
and diagnostics are opt-in (`RANK556_PROFILE`, `RANK556_DIAGNOSTICS=1`).
Raw samples: `baselines/2026-11-09-euler556.json`.
