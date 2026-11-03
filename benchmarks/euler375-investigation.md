# Euler 375 investigation

The first sections record the initial investigation at `67a50cf3`. The
production implementation and final verification are in the Delivery section
below. All comparisons isolate unrelated edits in the shared worktree.

The existing algorithm is already linear in the period, rather than in the
2,000,000,000 requested elements. It generates 6,308,948 values, then scans two
periods forward and two backward with a monotone stack. It retains A, Prev and
St. Compilation succeeds for all three loops. The full final accumulator
exceeds safe Number integers: one speculative overflow correctly triggers
exact replay, followed by a mixed integer loop. This is not a precision bug or
an arbitrary admission limit.

## Measurements

Node v24.15.0. Three fresh sequential processes per compiled variant, alternating
order. Time includes parsing/preparation/execution and excludes imports. RSS is
whole-process peak, not retained storage. All full runs return
`7435327983715286168`.

| Host | Existing compiled | Stream prototype | Existing / prototype peak RSS |
| --- | ---: | ---: | ---: |
| Apple M5, arm64 | 1.354 s | 0.460 s | 367.5 / 285.2 MiB |
| Intel i7-10750H, x86_64 | 2.934 s | 1.037 s | 347.2 / 267.4 MiB |

Full Mac reference controls: 94.391 s / 498.9 MiB existing, 45.726 s / 228.9 MiB
prototype. These are single samples. The original reference process overlapped
brief small profiling/control jobs; the reference speedup is indicative, not a
repeated isolated estimate. No full Intel reference run was attempted.

A reduced reference CPU profile (100,000 elements/period) spreads time across
expression dispatch, binding/frame reads, applications, statement execution,
assignments and selectors. Its largest sampled function accounts for about
250 ms of the 1.55 s run; no single builtin dominates. The main reference cost
is many scalar evaluations in the stack passes.

## Selected algorithm prototype

For global minimum m, every subarray contributes m plus its minimum excess over
m. The baseline contribution is exactly `m * N * (N + 1) // 2`.

A monotone stack computes the sum of excess minima for all suffixes ending at
each position. A zero excess resets that suffix state. Consequently the state
is periodic after the first minimum. Scan one period and then its prefix before
the first minimum to obtain the steady-state correction. Track the requested
partial-period prefix at the same time.

In the prototype, let:

- F be the total excess for the first period;
- C be the difference between the warmed and initial prefixes before the first
  minimum;
- R be the initial excess for the requested partial period;
- D be the corresponding warmed-prefix correction;
- q be the number of complete requested periods.

For q > 0 the excess total is `q * F + (q - 1) * C + R + D`; otherwise it is R.
The wide final formula runs outside the hot loops with exact integer arithmetic.

The first minimum is 3 at zero-based position 2,633,996. Stack processing drops
from 4P to P + 2,633,996 iterations. Prev disappears, leaving two arrays. Both
loops compile as Number loops with zero overflow/replay. The largest observed
loop total is 6,241,221,865,192,860, still below MAX_SAFE_INTEGER. Other inputs
retain the runtime's ordinary exact overflow fallback; the formula does not
assume arbitrary periods always fit Number.

The stack is inherently sequential state. Replacing it with repeated sliced
array minima would sacrifice the linear algorithm. Array allocation and indexing
remain normal Rank constructs; no Euler-specific runtime primitive is needed.

## General compiler opportunity: growing private arrays

The full prototype's maximum stack depth is only 38, yet it reserves P slots.
A fixed 64-slot **control only**, on this exact full input, returns the golden
in 0.448 s / 231.2 MiB. This demonstrates roughly 54 MiB of remaining peak-memory
headroom. A hardcoded capacity is not a correct general solution.

The correct growth prototype starts with `Period min 64` slots and doubles on
exhaustion using `concat St St copy`. At 100,000 elements it returns the same
answer, but the outer loop fails admission (`loop:unbound-name:NameExpression`),
leaving 178,378 small compiled inner invocations. It takes 1.139 s versus 0.134 s
for the fixed-size prototype on that reduced input (single controls). Starting
at one slot forces actual resizing and also matches the original at limit 100.

Useful follow-up: support a growing local numeric array inside a compiled loop,
including `len` and completed concat/copy rebinding. Preserve separate aliases,
ordinary binding snapshots, allocation failures, cancellation and exact replay.
Audit the precise admission failure before implementing: the diagnostic alone
does not prove concat is its only cause. Rebinding one private array must not
force scalar dispatch for every iteration. Do not increase global copy or
Number thresholds to hide this problem.

A separate loader prototype skipped redundant Int32 zero fills in private-loop
allocation. Three Mac samples had essentially unchanged RSS (285.3 MiB) and
runtime (median 0.469 s). It is not selected as an optimization from this evidence.

## Manual JavaScript control

The same stream recurrence in hand-written JS uses Int32 arrays and an exact
BigInt final formula. Single controls: Mac 0.319 s / 77.1 MiB; Intel 0.346 s /
80.0 MiB. This excludes Rank parsing, bindings, guards, cancellation and replay
contracts. It demonstrates remaining runtime overhead; it is not evidence that
all those guarantees can be removed or that the whole RSS gap belongs to the
stack. Native stack pages are mostly untouched because only 38 slots are used.

## Verification and scope

894 comparisons pass against an independent quadratic exact-integer subarray
minimum oracle. Both runtime modes compare the original and stream versions
for generated periods 1..20 and limits spanning zero, partial, complete and
multiple periods. Synthetic periods additionally verify the stream prototype
with repeated minima, zero minima, all-equal, increasing and decreasing values.

The original reverse stack can overrun its P+1 capacity on an artificial
all-equal period; those synthetic cases are checked against the independent
oracle, not treated as an original-program oracle. The generated full period
is not that case. Both existing fixture goldens are also checked explicitly.

The initial investigation made no production edits or external updates and ran
no full suites or exhaustive audits. Its proposed production checks were to add regression tests,
check the growth compiler change with alias/error/cancellation/replay cases,
and remeasure it on Mac and Intel before delivery.

## Reproduction

Build the committed runtime first. RUNTIME may name an absolute isolated built
interpreter index.js to avoid concurrent worktree changes.

```sh
node benchmarks/euler375-investigation.mjs
node benchmarks/euler375-investigation.mjs \
  benchmarks/experiments/euler375-stream.ra compiled
node benchmarks/euler375-investigation.mjs \
  benchmarks/experiments/euler375-stream.ra reference
DIAG=1 node benchmarks/euler375-investigation.mjs
node benchmarks/experiments/euler375-verify.mjs
node benchmarks/experiments/euler375-native.mjs
DIAG=1 node benchmarks/euler375-investigation.mjs \
  benchmarks/experiments/euler375-grow.ra compiled 100000 100000
```

Raw measurements:
`baselines/2026-11-03-euler375-investigation.json`.

## Delivery, 2026-11-04

The production demo now uses the minimum/excess recurrence and a dynamically
growing stack. Capacity starts at `P min 64` and doubles as needed; 64 is an
initial allocation, not a correctness or compiler admission limit. The stack
needs 38 live entries for the full input. Independent tests force growth from
64 to 512 slots with an increasing synthetic period.

Small inputs generate only `min(Period, max(N, 1))` values: unused tail elements
cannot affect their subarray minima. Nonpositive limits retain the empty sum.
Capacity is kept in a scalar and updated only when growing, avoiding repeated
reference `len` dispatch. The original fixtures and backend coverage remain.

General compiler changes:

- Completed `concat A B ... copy` over named, homogeneous numeric vectors
  lowers to a fresh private buffer. Integer and real vectors are supported;
  lazy concatenations, mixed types and other axes retain their evaluator.
- Scalar stores can coexist with entry-array replacement. An entry snapshot
  stays private; both replacement and preceding cell stores publish correctly.
  Local allocations are already dirty, so they need no repeated dirty mark.
- Later rebindings invalidate entry-shape address proofs even for stores that
  precede the rebinding syntactically. Shrinking-buffer tests cover this.
- Mutable aliases, escaping intermediate array results and rebound bulk
  selections retain fallback. Demand-budgeted entry rebinding also retains the
  existing publishing path because binding contracts may consume budget.
- Concatenation copies poll in bounded chunks. Overflow abandons the private
  attempt and repeats exactly; ordinary errors/cancellation publish only
  completed preceding statements. No admission/copy threshold was raised.

Final compiled medians, three alternating-order fresh processes per variant:

| Host | Original, prior runtime | Production, selected runtime | Peak RSS, before / after |
| --- | ---: | ---: | ---: |
| Apple M5 | 1.352 s | 0.459 s | 375.4 / 231.9 MiB |
| Intel i7-10750H | 2.970 s | 1.065 s | 348.1 / 220.6 MiB |

Every full answer is `7435327983715286168`. The final Mac reference control is
50.920 s / 415.5 MiB; the original reference control was 94.391 s / 498.9 MiB.
Reference measurements are single samples, with the original's overlap caveat
above. Do not substitute the earlier fixed-stack prototype's 228.9 MiB reference
measurement for the delivered program.

On the *same growing-stack research source* at N=P=100,000, compiler-only
medians are 1.205 -> 0.151 s on Mac and 3.663 -> 0.343 s on Intel. The unchanged
original full algorithm does not benefit: 1.352 -> 1.387 s on Mac and 2.970 ->
3.027 s on Intel. The main default speedup comes from the recurrence; compiler
support lets its small growing buffer retain whole-loop execution.

Neighbour controls (milliseconds, before -> selected):

| Host | Euler 350 | Euler 364 | Euler 365 |
| --- | ---: | ---: | ---: |
| Mac | 188.2 -> 188.4 | 235.5 -> 229.4 | 437.9 -> 444.1 |
| Intel | 446.5 -> 453.4 | 520.1 -> 529.6 | 1381.2 -> 1387.7 |

All neighbour goldens match. Differences are small compared with observed
sample variation; there is no demonstrated neighbour speedup. Mac samples had
occasional stalls, including an unchanged-source 2.247 s selected-runtime run
versus two around 1.38 s. Earlier noisy controls prompted a five-pair follow-up;
those historical samples are retained separately rather than discarded.

The full main is restored to ordinary corpus execution now that reference
execution fits the previous 120-second exclusion budget. Focused verification
and scoped corpus results are recorded below after the delivery checks.

Reproduce the comparison using an independently built prior runtime:

```sh
BASELINE_RUNTIME=/absolute/prior/packages/interpreter/out/index.js \
  OUTPUT=/tmp/euler375-delivery.json \
  node benchmarks/euler375-delivery.mjs
```

Final raw series are in
`baselines/2026-11-04-euler375-delivery-mac.json` and
`baselines/2026-11-04-euler375-delivery-intel.json`.

Final verification passes:

- TypeScript build, 65 semantic owners and whitespace checks.
- 524 focused tests across 13 files on Mac; 130 across four files on Intel.
- All five pre-existing Euler 375 tests are retained, including the Number
  backend disabled. New tests cover boundary limits, nonpositive inputs,
  repeated minima, forced stack growth and the full golden.
- 894 independent manual oracle comparisons plus eight existing fixture-golden
  comparisons pass on the delivered source.
- Scoped default + fixture audits: two differential, two inferred-type and two
  name-facts cases. The full differential reference run took 101.7 s under the
  auditor, compared with 50.9 s in the standalone timing control.
- Demand-budget fallback, cancellation, partial writes, widening, exact replay,
  growing/shrinking buffers and retained loop results have dedicated coverage.

No full ordinary suite or exhaustive corpus audit was run.

An integration build also passed in the shared worktree, followed by 118 tests
from the interpreter package (Euler 375, concat and vector suites). An earlier
root-level invocation accidentally collected sibling `.worktrees` as well and
failed only in the separate `turbo-loop` checkout on its missing
`rankedAddressAssignmentForm` export. That checkout was not modified. The
package-scoped run avoids those unrelated tests.
