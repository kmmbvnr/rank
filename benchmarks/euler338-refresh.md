# Euler 338: range folds without an inner loop

Research for #447 on 2026-11-02. The live table's next unfinished number
after 337 was 338, including its default test. The earlier #365 work already
replaced a slower divisor-sum algorithm with exact sorted-triple counting.
This investigation keeps that algorithm. The research stage below predates
the production delivery documented at the end of this report.

## Findings

The default input is N=10^12. There are 148,534,687 strict (A,B) visits.
The current scalar helper compiles, but its body uses BigInt arithmetic.
The grid result needs BigInt: 999999999600010915614292. The inner quotient
fold can instead use checked Number arithmetic, with exact fallback.

For Q=N//A, L=isqrt(Q), and B=A+1..L, the old contribution is

    sum(6 * (Q // B - B) + 3)

An arithmetic-progression identity rewrites this as

    6 * sum(Q // B) - 3 * (L - A) * (L + A)

This removes the explicit B loop and moves repeated arithmetic outside
the fold. The experimental Rank form is:

```rank
Part = Q // (A + 1 to Last) sum
Count = Last - A
Sum += 6 * Part
Sum -= 3 * Count * (Last + A)
```

The pair-count helper also uses `(N // (1 to Root)) sum`, removing its
explicit loop. The quotient-block walk in `products` and the dependent A
traversal remain explicit: these have stateful bounds. The asymptotic
complexity stays O(N^(2/3)); this is a representation/constant-factor win.

## Compiler experiment

Merely spelling the inner sum as an inline range is slower on the current
compiler. `emitIntegerSum` deliberately declines inline ranges, preserving
native analytic/streaming consumers rather than allocating a range or
turning a constant-time sum into a huge loop.

A named range is already accepted by the Number-region compiler:

```rank
B = A + 1 to Last
Part = (Q // B) sum
```

That is faster, but the generated code calls `rangeArray`, fills a pooled
temporary buffer, and then reads it for the fold.

The isolated JS prototype adds a direct range producer to `numberVector`:
capture scalar bounds once, calculate a checked length, and generate each
cell from its index inside the consuming fold. The inline-range admission
experiment is restricted to expressions containing integer division; bare
and affine range sums keep the existing fallback. This is a research guard,
not a complete classification of native analytic consumers.

The generated default triple loop has no `rangeArray` allocation. Both full
diagnostic runs report one Number loop, no overflow replay, no CoW copies,
and zero typed-array publications. `products` continues to calculate the
wide result exactly. The pair-count sum currently retains the ordinary
consumer; this prototype does not compile every scalar helper.

The patch under experiments targets built JS in a private runtime only.
Before delivery, port it to TypeScript and add focused regression tests for
analytic range preservation, evaluation/error order, cancellation/demand
budgets, broadcasting and exact overflow replay. Do not simply remove the
inline-range guard or force unbounded ranges through linear folds.

## Measurements

Node v24.15.0. Mac: Apple M5 arm64. Intel: Core i7-10750H x86_64.
Three alternating, serial, fresh-process samples per variant and host.
Times include parsing/compilation/execution, excluding module imports.
Memory is median whole-process peak RSS, not retained or incremental memory.
Other machine activity was not controlled.

| Variant | Mac ms | Intel ms | Mac MiB | Intel MiB |
| --- | ---: | ---: | ---: | ---: |
| Current scalar demo | 2004.142 | 5775.451 | 175.5 | 163.3 |
| Hoist arithmetic, keep B loop | 1865.777 | 5654.505 | 175.3 | 162.9 |
| Inline range sum, current compiler | 4320.431 | 12248.857 | 268.4 | 262.2 |
| Named range, current compiler | 656.368 | 2095.742 | 183.0 | 171.9 |
| Inline folds plus range-producer prototype | 447.928 | 1687.377 | 177.2 | 166.2 |

The selected prototype is about 4.47x / 3.42x faster. Compiled peak RSS is
roughly unchanged; this is not a demonstrated overall memory reduction.
Every full compiled sample asserts 999999999600010915614292.

Reference execution on Mac, one fresh process each, without the compiler
patch or any generated code:

| N | Scalar demo | Inline array-style demo |
| --- | ---: | ---: |
| 10^10 | 1968.120 ms / 178.0 MiB | 704.137 ms / 186.0 MiB |
| 10^12 | stopped after 20 s | 7949.952 ms / 267.1 MiB |

The full reference result also matches. Its peak RSS remains materially
higher than the compiled run. The timed-out baseline has no completed RSS
sample, so no full-input reference memory improvement is claimed.

## Validation and isolation

- Existing Euler 338 suite: 2 tests pass on the isolated unchanged source.
- Named-range and prototype variants match independent direct divisor enumeration
  for 315 inputs in both engines, including negatives, zero, and square/cube
  boundaries. Named-range and prototype variants pass on Mac; the prototype
  also passes on Intel.
- 64 range-fold comparisons per runtime cover to/till, descending strides,
  empty ranges, zero divisors, signed numerators and values around 2^53.
- A final prototype check retains the analytic-range guard restriction and
  passes the same checks on both hosts.
- No exhaustive corpus audits were run.

Mac uses the isolated a52e99eb delivery build at
`/tmp/rank337-delivery-local`; Intel uses `/tmp/rank336-delivery` at d10cdfbc.
The relevant original integer-loop-expressions and number-loop-runtime
SHA-256 hashes match. No foreign shared-workspace compiler edits entered
these comparisons. Each prototype has its own interpreter directory.

Raw samples, source hashes and diagnostics:
[2026-11-02-euler338-refresh.json](baselines/2026-11-02-euler338-refresh.json).
The three-run series precedes the final guard restriction, which leaves
this division-containing workload's generated loop unchanged.

## Reproduction

Point `RANK338_RUNTIME` at a built, isolated interpreter's `out/index.js`.

```sh
node benchmarks/euler338-refresh.mjs original compiled 1000000000000
node benchmarks/euler338-refresh.mjs range compiled 1000000000000
```

The historical JS patch records the initial experiment; it is not the
production fix and lacks the final sequence-zip safeguards. Use the current
built TypeScript implementation and the `production` variant for delivery
checks. The historical variant can still be measured with that build:

```sh
node benchmarks/euler338-refresh.mjs inline compiled 1000000000000 diag
node benchmarks/euler338-refresh-verify.mjs inline
```

Set `RANK338_KERNEL_OUTPUT` to a temporary file to capture generated source
in diagnostic mode. The Function-constructor capture is research-only and
is never enabled in timing samples. Production Rank files remain unchanged.


## Production delivery

The demo now writes `Q // (A + 1 to Last) sum` and
`N // (1 to Root) sum`, removing both explicit inner loops and the redundant
outer parentheses. Rank lines, including comments, stay within 40 columns.
The exact sorted-triple algorithm and wide product calculation are retained.

The TypeScript compiler now admits reciprocal range folds with one inline
progression and scalar pointwise operands. It generates each range cell
inside the consuming sum rather than allocating its vector. Checked bounds,
lengths, cells, division and accumulation retain exact overflow replay.
Ordinary bindings and unused deferred plans retain their existing boundaries.

A delivery regression found that two sequences zip to the shorter length;
this differs from array broadcasting. Multiple ranges and sequence/array
combinations therefore keep the existing consumer. The direct progression
is enabled only for the validated fold, not for unrelated array expressions.
Bare/affine range expressions and division occurring only in scalar bounds
retain their native consumers and analytic shortcuts. This changes no Number
copy thresholds or admission constants.

Final default-input samples (three per case and host):

| Host | Old median s | Final median s | Old peak MiB | Final peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 2.037 | 0.450 | 175.4 | 177.6 |
| Intel x86_64 | 5.927 | 1.710 | 162.9 | 164.8 |

About 4.53x / 3.47x faster. Whole-process peak RSS is roughly unchanged;
there is no claim of an overall memory reduction. Both full diagnostic runs
show one Number region, no overflow replay or CoW copies, and zero typed
array publications. Every timed full run asserts the exact golden answer.

Validation on an isolated 6fc3115f source copy plus this delivery:

- Langium generation and `tsc -b tsconfig.build.json` pass.
- 542 tests pass in nine focused files: Euler 338, range folds, Number
  vectors/bounds/exact consumers, function prefixes, Number loops, loop
  control and modular folds. The new range suite contains 21 tests.
- Three metadata tests and nine CLI assertions (small and full fixtures) pass.
- Actual production functions match independent direct enumeration for 315
  inputs in both engines on both hosts, plus 64 range boundary comparisons.
- Tests cover overflow replay, signed/empty/zero-step ranges, errors, scalar
  snapshots, unused deferred plans, demand budgets and sequence zip behavior.
- The final full reference program also returns the golden answer: one run
  took 19.393 s / 269.4 MiB. This differs from the earlier 7.950 s research
  sample; no stable full-reference speedup factor is claimed from these
  single runs. It remains in the manual lane; exhaustive audits were not run.
  Their reasons now describe the current coverage.

Shared-workspace compiler edits from another session were excluded. Removing
only this task's patch restores the original foreign file byte for byte.
Intel uses an independent interpreter directory with the same delivered
integer-loop expression code and the unchanged stable dependencies.

Raw final measurements and diagnostics:
[2026-11-02-euler338-delivery.json](baselines/2026-11-02-euler338-delivery.json).
The `production` worker reads the actual demo without rewriting it for timing.
