# Euler 316: decimal-pattern expectations

Investigation and compiler repair, 2026-11-01. The production demo remains
unchanged; the general declared-call compiler gap described below is fixed.

## Finding

`demos/euler/316_decimals.ra` already uses an efficient overlap formula and
compiles successfully. It takes a median 0.590 s on Apple M5 and 0.685 s on
Intel i7-10750H for the full problem. Its algorithm is not a simulation.

A refactoring exposed a separate compiler gap: a declared scalar call with
multiple arguments to the right of the function name is not supported by the
scalar-function proof or integer-loop expression emitter. A disposable
prototype removed that cliff. The production repair now supports eligible
strict data calls, but does not improve the existing demo.

## Mathematics and correctness

For a decimal word of length L, the expected first starting position is

```
10^L - L + 1 + sum(10^k for matching proper prefix/suffix lengths k).
```

The existing helper implements this formula with integer prefix and suffix
comparisons. See the [official problem](https://projecteuler.net/problem=316).
The full exact answer is `542934735751917735`; the statement's smaller sum is
`27280188`.

Exact arithmetic is necessary. The original diagnostic run compiles the outer
loop and calls Number helpers, with nine legitimate helper fallbacks: the
largest quotients require a decimal power of 10^16, beyond safe Number
integers. Both Num and the full answer also exceed the safe range. Removing
these guards would compromise correctness.

Verification uses two distinct approaches:

- An exact BigInt Markov-chain oracle constructs decimal-prefix states and
  solves their expectation equations by fraction-free elimination. It checks
  1,108 nonnegative individual inputs, including repeated patterns, large
  integers, and safe-integer boundaries. One additional case preserves the
  helper's legacy negative-input behavior, outside the problem domain.
- A string prefix/suffix oracle, cross-checked against the Markov oracle,
  independently computes the full aggregate and the statement example.

Seven variants in compiled and reference execution pass 15,526 individual
comparisons per runtime. A further 924 aggregate checks cover empty ranges,
zero, negative legacy inputs, decimal boundaries and integers up to 10^40.
Both sets pass on Mac and Intel, with baseline and prototype runtimes. These
are targeted investigation checks, not a full interpreter regression suite.

## Measured alternatives

Three serial fresh processes per case, rotating order; Node 24.15.0 on both
hosts. Imports are excluded; parsing and execution are included. Memory is
median process peak RSS, not live DP/array storage. Machine load and GC add
noise, especially to small percentage differences.

| Full compiled variant | Mac ms / MiB | Intel ms / MiB |
| --- | ---: | ---: |
| Original | 590.3 / 174.4 | 685.0 / 159.6 |
| Group quotient decimal-length bands | 573.0 / 177.2 | 629.1 / 166.5 |
| Carry decimal width, declared helper call | 2913.0 / 438.5 | 8402.6 / 408.1 |
| Same carried arithmetic, postfix helper call | 625.6 / 175.0 | 752.7 / 161.6 |
| Original inside solve helper | 590.7 / 173.7 | 686.1 / 159.3 |
| Grouped inside solve helper | 567.1 / 176.0 | 623.5 / 164.1 |
| Declared carried call on prototype compiler | 622.7 / 175.1 | 728.2 / 160.8 |

Grouping computes the non-overlap term once per quotient decimal-length band,
then checks borders for each quotient. It reduces repeated work, but its
compiled gain is only about 3% on Mac and 8% on Intel and it requires more
code. Wrapping the aggregate in a function changes little.

Full reference execution on Mac benefits more from grouping: median
10,767.1 ms becomes 7,562.8 ms, about 1.42x. The three-run ranges are
8,932.5–10,843.3 ms and 7,256.3–7,697.8 ms respectively. Median peak RSS is
429.5 MiB for original and 440.4 MiB for grouped: no demonstrated memory
saving. The speed improvement is real in these samples but is accompanied
by additional band-management code.

Reduced reference runs (Top=9,999, same Num=10^16) give 154.9 versus 149.4 ms
on Mac and 484.8 versus 464.5 ms on Intel. Full reference execution was not
measured on Intel.

## General compiler gap

The carried variant uses the ordinary declared call

```rank
Answer += Q waiting_at Power Len

fun N waiting_at Power Len
  ...
end
```

The AST is `DeclaredCallExpression`. Both
`jit/scalar-function-proof.ts` and `jit/integer-loop-expressions.ts` reject
it. The ordinary interpreter handles it correctly. Changing only the call
layout to `Q Power Len waiting_at` and declaring the corresponding postfix
helper restores compilation.

The small `euler316-declared-repro.ra` reproduces the same rejection with
three integer arguments and an addition helper, without any Euler-specific
logic. It produces 21 in all engines; the prototype compiles its loop and
removes the rejection.

`experiments/euler316-declared-prototype.mjs` modifies only a copied built JS
runtime. It normalizes a restricted declared call to the existing application
lowering. The same carried source then improves about 4.7x on Mac and 11.5x
on Intel, with substantially lower process peak RSS. These are gains for a
previously rejected refactoring, not gains over the original Euler demo.

This is an experiment, not a production-ready lowering. A production fix
must share argument normalization with language semantics and verify strict
evaluation order, omitted/default/word arguments, deferred and function
parameters, rank/axes fallback, binding guards, error locations and tail
calls. The prototype's loop normalization does not establish all those
contracts. Broadly admitting every declared call would be unsafe.

## Production repair

Both the scalar-function proof and integer-loop emitter now consume declared
arguments in the parser's existing bound order. They reuse linked callee proofs,
precision checks, entry guards and tail-call handling. Calls with rank/axis
modifiers, deferred/function/optional-word parameters retain ordinary execution.
The loop path checks the actual callee signature and never treats a declared
user call as a namesake builtin.

The implementation was built and tested in an isolated checkout of the staged
changes, excluding the uncommitted Euler 315 repair. Targeted coverage passes
727 tests across 17 files; final integration with parent `09219f64` passes
757 tests across 18 files, including array-region coverage. Nineteen new
regression tests cover operand placement,
nested links, direct entries, recursive tail calls, real arithmetic, exact
integer overflow, argument error order, unused deferred operands, configured and
ranked fallbacks, and helper replacement. Full corpus audits were not run.

The production runtime passes 15,526 Markov-pattern comparisons and 924 aggregate
range comparisons on each of Mac and Intel, in compiled and reference modes.
Three fresh full-input measurements per case give:

| Production runtime | Mac ms / MiB | Intel ms / MiB |
| --- | ---: | ---: |
| Original demo | 600.0 / 174.0 | 669.6 / 159.9 |
| Carried width, declared call | 619.3 / 175.0 | 744.2 / 159.9 |
| Same arithmetic, postfix call | 615.1 / 176.0 | 748.1 / 160.0 |

The formerly rejected call is now close to its equivalent postfix form, and
about 4.7x / 11.3x faster than the investigated rejected version. The original
demo stays within measurement variation. Full answer remains
`542934735751917735`. This is compiler coverage and allocation improvement for
the refactoring; it is not an algorithmic speedup of the original program.

Delivery timings use isolated runtime sources based on `8598c2ba` plus this
repair, without the Euler 315 changes. The timing harness's Git revision may
name a later workspace commit because another session committed during the
measurements; delivery provenance records runtime source hashes and base
separately. Final integration checks also cover the new parent revision.

## Recommendation and reproducibility

The general support for eligible declared scalar calls is implemented. Keep
the current compact demo: the reference-only speedup would require the longer
grouped implementation. There is no large algorithmic defect in the current
solution and no evidence of a memory win from the tested algorithm changes.

All variants are frozen in `benchmarks/experiments/euler316-*.ra`. Main entry
points are `euler316-investigation.mjs`, `experiments/euler316-series.mjs`,
`experiments/euler316-verify.mjs`, `experiments/euler316-ranges.mjs` and
`experiments/euler316-reference-full.mjs`. The last three accept an output
JSON path. Verification accepts `full` as its second argument to run the
full aggregate oracle. `RANK_BENCH_RUNTIME` selects an alternate built
interpreter; `RANK316_DECLARED_RUNTIME` adds the prototype to the timing series.

Raw evidence is saved as `baselines/2026-11-01-euler316-*.json`, including
diagnostics, individual and aggregate verification, timings and source
provenance. Mac measurements record revision `8598c2ba`; the working runtime
also includes the uncommitted captured-length compiler repair researched for
Euler 315. The copied Intel runtime's two call-lowering modules have identical
hashes. Intel has no Git checkout, so its series revision field is empty;
the frozen Rank source hashes and provenance record identify the experiment.
The prior Euler 315 changes and unrelated workspace edits remain intact.
