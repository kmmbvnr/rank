# Euler 580: direct coefficient state and captured integer iterators

Base: `074180f284668dc9a185210f3e8f61b9a0f1c46a`.
The default bound remains 9999999999999999, with exact result
**2327213148095366**. The [statement](https://projecteuler.net/problem=580)
checkpoint below 10^7 remains **2327192**.

## Program and counting identity

A squarefree Hilbert number has no squared prime congruent to 1 modulo four.
At most one prime congruent to 3 modulo four may have exponent above one,
and its exponent is at most three. Thus it is an ordinary squarefree Hilbert
number, or p^2 times one, for a prime p congruent to 3 modulo four.

If f(x)=(x+3)//4 counts Hilbert integers and mu is ordinary Mobius, the same
inclusion-exclusion as before is

    H(N) = sum over odd v<=sqrt(N) of c(v)*f(N//v^2),
    c(v) = mu(v) + sum over primes p|v, p=3 mod 4 of mu(v/p).

The original sieve stored mu, a count of 3-mod-four factors, a count of their
squares and the remaining cofactor. The replacement stores mu, c and the
cofactor directly. For a new 1-mod-four prime both coefficients change sign.
For a new 3-mod-four prime, c becomes old_mu-old_c and mu changes sign.
At its square, c becomes current_mu and mu becomes zero; its cube clears c.
A squared 1-mod-four prime clears both. The remaining prime applies the same
first-power transform. Invalid higher-power states stay zero even when their
remaining cofactor is composite.

The first odd multiple of an odd prime power Q in a block starting at odd Low
has index ((Q-Low)//2) mod Q. This replaces modular-inverse multiplication
with a smaller exact expression. Only 3-mod-four primes need the cube pass;
redundant counter updates and the inner exponent loop disappear. Chained
positive divisions N//v//v equal N//(v*v) exactly and avoid a wide square vector.
No floating approximation is used for N or its quotients.

Blocks retain the existing two-million-odd-value default, exposed as the
optional Batch argument and clamped to at least one. The program maps a
rank-0 subtotal over block starts; only its prime sieve has an explicit loop.
There is no syntactic loop nesting and every line stays within 40 columns.

## Shared compiler changes

An explicit native range copy can now occur inside another eager arithmetic
operand, rather than only as a whole ordinary assignment. The copy operation
and its guards remain present. Bare range metadata consumers stay lazy;
shadowed copy, unused branches and deferred recipe demand retain their ordinary
behavior. Five newly added admission assertions fail on the old implementation
and pass with this change.

Compiled functions can traverse a completed captured integer vector. Entry
guards check its rank/storage and refresh rebound or revised bindings. The
exact iterator resolves its receiver once when traversal begins, preserving
ordinary iterator and alias behavior. Existing captured scalar/text traversal
retains its previous compilation path. Private typed storage can additionally
use checked Number iteration with a bounded ordinal and per-cell Int64 checks.
Unsafe cells or arithmetic replay exactly. Shared/opaque and unsupported inputs
retain exact or ordinary execution; inspection, budgets and arbitrary polling
callbacks retain ordinary publication. Atomic cancellation remains available.

Read-only integer-input Number graphs also retain real and boolean results.
Recursive self calls and their call bridge no longer impose an integer result
conversion on those domains. Parameters remain integer-only for this added
path, preserving exact recursive error frames and depth checks. Existing tail
recursion is unchanged; text keeps its existing route. No language syntax,
proof budget or Number storage threshold is changed.

The main subtotal still contains vector-index writes unsupported by the whole
scalar-function proof; existing native array-update kernels execute them.
Its time improvement therefore comes from the program rewrite, not a claim
that the complete sieve helper now compiles as one scalar function.

## Measurements

| Host / mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / compiled | 7.081 | 4.221 | 528.7 | 441.3 |
| Mac / reference | 7.766 | 5.024 | 593.4 | 465.8 |
| Intel / compiled | 23.261 | 13.889 | 518.9 | 431.0 |
| Intel / reference | 23.061 | 14.690 | 531.9 | 427.4 |

Three alternating fresh-process old/new pairs for each mode and host, full
input and exact answer checked in every sample. Both program versions use
the same working runtime, isolating the program rewrite. Node v24.15.0 on
Apple M5 arm64 and Intel i7-10750H x64. Diagnostics/profiling are off; timing
includes parsing/execution and excludes interpreter import. RSS is process
high-water, not total allocation. No tests or other benchmarks launched by
this session overlap final primary measurements on the same host. Intel load
at the start was 1.06/0.48/0.23. The measurements use the base runtime plus
these compiler changes. Independent diagnostic reporting from `1bdf9ebc` was
integrated afterwards and validated separately; diagnostics are off here.

The historical 1.7-minute catalogue estimate is not the current baseline.
An initial current-base Mac control was 7.794 seconds / 530.7 MiB compiled;
all primary paired samples, rather than that single control, determine the table.

Unchanged small helper controls compare the frozen base runtime with the new
compiler, independently of the Euler algorithm:

| Host / unchanged compiler control | Before seconds | After seconds |
| --- | ---: | ---: |
| Mac / captured-loop | 0.120 | 0.116 |
| Mac / nested-copy | 0.103 | 0.107 |
| Mac / recursive-real | 0.130 | 0.131 |
| Intel / captured-loop | 0.308 | 0.272 |
| Intel / nested-copy | 0.282 | 0.288 |
| Intel / recursive-real | 0.332 | 0.325 |

These controls do not establish a broad default-speed gain: existing numeric
consumers were already fast. They verify coverage without a substantial default
regression. The intermediate capture-only exact-function prototype took
0.774 seconds versus 0.222 on its base control; adding checked Number traversal
removed that avoidable slowdown. The final tests require Number execution,
including boolean/real recursive results, rather than only matching values.

## Rejected experiments

At 262144 odd values per block, the first direct-coefficient prototype took
11.897 seconds / 432.9 MiB on Mac. A one-million block took 6.562 seconds /
421.1 MiB; the smaller memory saving did not justify its slower traversal.
Filtering zero coefficients before division added gather arrays and showed
reference peaks of 523-562 MiB, so it was not adopted. Splitting coefficient
construction into a separate returning helper gave no consistent time/memory
win. These exploratory single samples use evolving uncommitted compiler
stages and are retained separately, not presented as paired primary evidence.
Early argument-independent helper controls are likewise diagnostic only.

## Verification and reproduction

776 focused interpreter checks pass on each host. A direct small oracle removes
multiples of all nonunit Hilbert squares, without prime factorization or the
coefficient recurrence. It checks boundaries through 20000, including legal
9,117,189,693 and forbidden 25,81,169,441,3969,6237. Tests also cover empty input,
batch sizes -1,0,1,2,7,13,100, the statement checkpoint, the full golden in
compiled/reference and scalar-kernel-disabled modes, and the old sieve through
10^10. Compiler tests cover COW aliases, rebinding, real/unsafe/shared/opaque
vectors, exact ordinals, unused external recipes, shadowed copy, error timing,
budgets, custom polling and running-loop cancellation/recovery in both tiers.

After integrating `1bdf9ebc`, the same 776 checks and 19 diagnostic checks
pass on both hosts. The Euler 263 iterator assertion now checks function
rejections specifically: diagnostics also expose unsuccessful alternative
backend probes even when another backend succeeds.

Six filtered Mac corpus checks pass for the main and fixture: differential,
inferred types and name facts. TypeScript build and five exclusion-policy
checks pass. The full main returns to ordinary corpus execution; the fixture
and its original assertions are unchanged. Full npm test and exhaustive corpus
audits were not run.

```sh
node benchmarks/euler580.mjs compiled
node benchmarks/euler580.mjs reference
node benchmarks/euler580.mjs exact
node benchmarks/euler580.mjs compiled 9999999999999999 benchmarks/fixtures/euler580-original.ra
```

`RANK580_EXPECTED` checks the answer; `RANK580_RUNTIME` selects a built runtime.
`exact` disables scalar function kernels and Number loops, while other compiled
backends stay enabled. `reference` disables compilation. Separate diagnostic
runs use `RANK580_DIAGNOSTICS=1` or `RANK580_PROFILE=path`.
Raw samples: `baselines/2026-11-10-euler580.json`.
