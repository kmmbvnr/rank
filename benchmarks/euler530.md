# Euler 530: segmented totients and fused quotient sums

The full result at N=10^15 remains **207366437157977206**. The original
examples F(10)=32 and F(1000)=12776 agree with the
[problem statement](https://projecteuler.net/problem=530). The existing
F(10000)=201008 fixture remains. The main demo returns to filtered differential
execution; its historical 55-second/1.6-GB exclusion is removed.

## Algorithm and memory

For each pair of complementary divisors x*y=n, expand
`gcd(x,y) = sum(phi(t) for t dividing both x and y)`. Writing x=t*a and y=t*b
gives the exact identity

    F(N) = sum(phi(t) * D(floor(N/t^2)), t=1..floor(sqrt(N)))
    D(m) = 2 * sum(floor(m/a), a=1..floor(sqrt(m))) - floor(sqrt(m))^2

This is the original algorithmic identity; there is no answer table or
approximation. The old source retains full totient and residual arrays through
floor(sqrt(N))=31,622,776 and completes large quotient vectors repeatedly.
The new source computes totients in blocks, retaining only the current block.
Each prime power removes one occurrence of its prime from the residual;
phi is adjusted once at the first power. A remaining factor greater than one
is prime and contributes its final phi adjustment. Broadcasting primes against
exponents builds the finite prime-power schedule once. There is one explicit
loop over that schedule, and no nested Rank loops.

A corrected integer cube-root split K=100000 separates the small t values,
which use the hyperbola formula, from the tail. The tail reads the precomputed
divisor-count prefix D(m) through floor(N/K^2)=100000. Existing `divisors count`
and `scan + with 0` replace the old second sieve loop. `repeat` advances tail
blocks and retains only the current scalar total. Every Rank line fits 40
columns. N=0 returns zero before taking a square/cube split; squares, cubes,
empty tails and multiple block boundaries are covered independently.

Blocks of 65,536, 262,144 and 1,048,576 were compared. The smallest saved
little peak RSS but forced hundreds of thousands of interpreted schedule
iterations: reference time was 14.93, 8.81 and 7.55 seconds respectively.
The final block is 1,048,576, balancing the reference overhead against bounded
sieve storage. The reference path trades a small time increase for much lower
peak memory; it is not claimed as a reference speedup.

## General compiler changes

A scalar helper containing a completed range and a scalar sum previously
entered the general scalar-function tier. That tier materialized the range
and elementwise quotients, bypassing the existing fused numeric-function
backend. Such pure, nonrecursive integer helpers now retain the function-body
path. Existing native completion, container and array-write cases keep their
previous entry rules. The ordinary numeric-function backend remains first,
including its closed-form affine sums and input/cancellation checks.

Straight-line scalar reductions can also use the private loop prefix when
the numeric-function backend declines a wide result. This no longer requires
an artificial `for` wrapper. Mixed exact/Number variants retain the same
return-only publication set: discarded completed scratch arrays need not be
boxed on successful return. Errors still publish preceding bindings and
ordinary demand-budget execution keeps its original work units.

Pure checked integer division is admitted to the existing wide-sum cell path.
Safe cells accumulate numeric subtotals; an overflowing cell is retried exactly,
without recomputing completed subtotals. Zero divisors still raise the original
located error. This is a general range/vector reduction improvement, not a
recognizer for Euler 530 or its formula.

## Measurements

Node v24.15.0, isolated fresh processes on the Mac (arm64), alternating three
compiled before/after pairs. Baseline runtime/source: d34beca8. Measurements
include parsing and program execution; RSS is process peak, not live heap.

| Mac workload | Before | After |
| --- | ---: | ---: |
| Compiled median, three alternating pairs | 11.604 s / 1294 MiB | 4.233 s / 895 MiB |
| Reference, one final pair | 7.006 s / 2413 MiB | 7.405 s / 906 MiB |

Compiled time falls by 2.74x and median peak RSS by 31%. Reference time rises
by about 6%, with 62% lower peak RSS. The final reference pair is a single
observation, not a precise small-regression estimate. Cross-controls separate
the changes: new source with the old runtime takes 9.697 s / 976 MiB; old
source with the new runtime takes 4.753 s / 1208 MiB. Most of the speedup comes
from the general compiler repair; segmentation provides additional memory
savings. Other-demo controls are unchanged within noise: Euler 526 is
3.970 -> 3.956 s, and Euler 529 is 4.264 -> 4.256 s (one pair each).

The Intel machine was running an independent corpus controller, with a worker
active and CPU package temperature at 100 C. Its final asserted run was
12.41 seconds / 493 MiB with nice=19. This is a correctness and memory observation
under load, not a quiet-host speed comparison. No other user's process was
stopped, and no Mac speedup is assumed to transfer to Intel.

## Verification

An independent oracle enumerates every divisor and takes gcd with its
complement, without totients, the hyperbola identity or the segmented sieve.
It covers zero, one, the official examples, values adjacent to squares/cubes,
N=10000 and multiple block boundaries in all three execution modes. The full
compiled result is asserted separately. Compiler tests cover positive/negative
and unsafe scalar inputs, safe-integer rounding boundaries, descending negative
divisors, wide sums, zero-divisor errors, empty ranges, snapshots, ranked calls,
demand budgets, warm cancellation and subsequent ordinary execution.

Mac: 16 selected ordinary files, 603 passing tests and 6 inherited failures
of 609. All 21 new compiler cases and 55 Euler 530 cases pass. The inherited
failures are five backend counter expectations in `numeric-function.test.ts`
and one in `integer-function-reductions.test.ts`. A clean source checkout of
d34beca8 reproduces all six, plus one wide-sum counter failure now repaired.
Intel: 76/76 focused compiler tests pass; the full final answer is asserted
in a separate process. Filtered differential passes both the main program and
its fixture (2 files and 1 embedded test block, about 12 seconds).

The full suite and exhaustive audits were not run. The unrelated inherited
real-function backend counter failures were reproduced from clean d34beca8
sources with the same package runner; their value/error assertions agree.
The old baseline also fails the mutated-input/wide-sum backend counter test,
which now passes through the added private reduction fallback. None of those
existing tests or assertions was weakened.

Reproduction from the repository root:

    node benchmarks/euler530.mjs compiled
    node benchmarks/euler530.mjs reference
    node benchmarks/euler530.mjs compiled 1000

From `packages/interpreter`:

    node scripts/test.mjs test/euler530.test.ts
    node scripts/test.mjs test/range-reduction-dispatch.test.ts
    node scripts/test.mjs test/differential.test.ts -t euler/530_gcddivisors

Original source: `fixtures/euler530-original.ra`. Raw results and source hashes:
`baselines/2026-11-09-euler530.json`. Set `RANK530_RUNTIME` to a frozen
interpreter's out/index.js and `RANK530_EXPECTED=207366437157977206` to assert
an independent before/after run. `RANK530_DIAGNOSTICS=1` enables counters;
diagnostic runs are separate from timed comparisons.
