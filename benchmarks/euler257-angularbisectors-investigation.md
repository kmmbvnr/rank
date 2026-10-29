# Euler 257: tighter parameter ranges and cooperative numeric GCD

Euler 257 is the next unfinished task by number in issue #447. The selected compact algorithm is now implemented in
[the demo](../demos/euler/257_angularbisectors.ra), together with explicit
cooperative Number-kernel registration and cancellation regression tests.

## Diagnosis

The full original already runs as one Number loop without overflow or copying
large arrays. Its profiled default takes about 38 seconds, mostly in generated
code and checkpoints. The work is the issue: it enumerates **500,036,682** D
candidates, runs a manual Euclidean loop for every candidate and another small
GCD for coprime pairs, constructs three sides, and rejects most of them.

The existing fixture includes Limit=1,000,000. Its old timings in #447 and the
90-second comment are historical observations, not current-machine benchmarks.

## Parameter reduction

Keep the source's parameterization, with M equal to the area ratio minus one
(M=1 or 2). Side ordering and the strict triangle inequality give:

| M | lower bound on D/Y | upper bound on D/Y |
|---|---|---|
| 1 | strictly above 1/2 | at most 2-sqrt(2) |
| 2 | strictly above 1 | at most 3-sqrt(3) |

Let `G = gcd(D, M*(M+1))`, `D = G*Q`, and `K = M*(M+1)//G`. The perimeter
simplifies exactly to:

```
Per = Y * (K*Y - M*Q)
```

The primitive-parameter conditions become `gcd(Y,G)=1` and `gcd(Q,K*Y)=1`.
These also enforce that G is the exact original GCD, rather than just a divisor.
Loop over the two/four divisors of M*(M+1), using a tiny bounded integer range
and skipping nondivisors. The number of multiples remains `Limit // Per`.

Compute `Root = isqrt((M+1)*Y*Y)+1`. Since M+1 is 2 or 3 and Y is positive,
this is exactly the ceiling square root; no floating-point irrational bound is
needed. The admissible Q interval is:

```
First = M*Y // (2*G) + 1
Last  = ((M+1)*Y - Root) // G
First = max(First, ceil((K*Y - Limit//Y) / M))
```

A group stops once `M*Y*Root > G*Limit`, which increases monotonically with Y.
An initial safe Y cap is `isqrt(G*Limit//M)`. These conditions imply valid side
order, nondegeneracy, positive integer perimeter and the perimeter limit, so
there is no need to build and test all three sides. `Ky = K*Y` is evaluated once
per Y. The equilateral count `Limit//3` is unchanged.

At the full default, the proposed program visits **55,741** Y rows and
**13,402,394** Q candidates, finding **6,759,015** primitive non-equilateral
triangles. It returns the same full answer **139012411**. Both GCDs use the
existing builtin, avoiding hand-written Euclidean loops and intermediate arrays.

## Algorithm measurements

Apple M5, macOS arm64, Node 24.15.0. Three serial fresh processes per row, reversed
variant order on alternate repetitions. Imports excluded; parse/preparation,
evaluation and diagnostics included. External host load was uncontrolled.
Profiles and instrumented counts were collected separately. The main algorithm
cohort uses 9ece2317; supplemental validation on the newer c2ad9c94 is below.

| variant | compiled Limit=100,000,000 median ms | reference Limit=100,000 median ms |
|---|---:|---:|
| original | 38410.381 | 1861.023 |
| tighter D/Y and Y ranges | 2274.014 | 237.290 |
| also direct perimeter formula | 1548.208 | 201.985 |
| divisor groups with builtin GCD | 650.741 | 134.141 |
| same groups with manual GCD | 671.865 | 157.702 |
| builtin GCD and explicit Ky reuse | **634.767** | **131.853** |

Original/final full compiled ranges: 38106.994–40185.265 ms versus
631.426–649.345 ms, about **60.5x** by medians. A separate three-sample reference
comparison at the fixture's largest input, Limit=1,000,000, gave
**18500.416 ms -> 221.491 ms**, about **83.5x**. The full optimized reference
completed in one run in **7857.539 ms**. A current full original reference run
was not completed; do not derive a full-reference ratio from the older exclusion.

The proposed source differs from the timed hoisted variant only in comments.

## General engine opportunity: GCD under cancellation

The existing Number implementation of GCD is already fast in headless execution.
However, `prepareCompiledBuiltin` disables Number kernels whenever interrupts
are enabled. Under an ordinary opaque Atomics cancellation flag, as in turbo
execution without inspection, GCD consequently goes through argument conversion
Number -> BigInt, checked native invocation, then conversion back to Number.
The surrounding loop still compiles; the unnecessary cost is at each call.

A copied-runtime, GCD-only admission experiment retains the native boundary
checks before and after each call and the ordinary safe-GCD work checkpoint.
It admits the Number kernel only for opaque polling. On the exact same proposed
program and cancellation signal, the original 9ece2317 cohort measured
1491.086 -> 985.826 ms. While the investigation was running, main advanced to
**c2ad9c94**, adding positional calls and scalar inlining. That change leaves
the interrupt exclusion in place. Rebuilding it and repeating the experiment
gave these three-sample medians:

| runtime | median ms | range ms |
|---|---:|---:|
| current c2ad9c94 | 1573.536 | 1531.447–1647.760 |
| guarded kernel prototype | **1007.945** | 1005.749–1062.249 |

That is about **1.56x** on current main for this cancellation-enabled workload. It is separate
from the mathematical speedup before delivery. The production implementation now uses a general per-signature
cooperative registration instead of the GCD-only probe.

Simply adding a periodic checkpoint was rejected: an already-cancelled run
published Total=511 instead of Total=0 and reported a different interruption
activity. Native entry/exit checks are part of the behavior to preserve. The
final probe matches 15 boundary comparisons: zero/negative/safe/wide GCD values
against exact BigInt arithmetic, cancellation and demand-budget partial writes
and formatted errors, inspection/custom-signal fallback, and typedNativeCalls=false.
Inspection/custom callbacks retain their previous execution path; wide inputs
retain exact arithmetic. Numeric precision and copy thresholds are unchanged.

The copied JavaScript patches and observations for both baselines are archived
in the baseline. The newer calling convention was retained; its changes were
not duplicated or reverted.
The production implementation expresses and tests the polling contract of each admitted
kernel, rather than enable all native kernels indiscriminately. LCM and other
operations were not changed by the probe. The comparator is
[euler257-gcd-boundaries.mjs](experiments/euler257-gcd-boundaries.mjs).

## Verification and next step

An independent oracle directly enumerates **6,986,111** nondegenerate ordered
integer triangles up to perimeter 1000, testing divisibility of
`(a+b)*(a+c)` by `b*c`. It does not use the proposed parameterization. Six variants,
46 boundary/sample limits, and both engines pass **552 comparisons**, including
0..30, the existing small goldens, and cases near 500 and 1000.

The research source also passed the original four-run fixture in both engines,
including Limit=1,000,000. All timed full defaults match 139012411. The delivered fixture adds the full default and limits 0 and 3: two blocks,
seven runs in both engines. The full reference workload is restored to routine
differential audits. The production source passes 92 fresh small-limit oracle
checks and 15 parent-versus-shipping native-boundary comparisons.

Delivery also fixes an independently reproduced compiler failure from current
main: a compiled tail transfer skipped its callee's specialized return contract.
Both compiled dispatch carriers now check it after executing the callee, outside
the discarded caller's error frame. Existing index-domain tests and an added
multi-hop warmed-contract regression compare exact errors with reference execution.

[Raw observations, source snapshots and probe patch](baselines/2026-10-29-euler257.json).
To reproduce after building the current checkout:

```sh
node benchmarks/euler257-angularbisectors.mjs
node benchmarks/euler257-angularbisectors.mjs --Limit=1000000 --reference
node benchmarks/euler257-angularbisectors.mjs --reference
node benchmarks/euler257-angularbisectors.mjs --fixture --reference
node benchmarks/euler257-angularbisectors.mjs --interrupt
node benchmarks/experiments/euler257-oracle.mjs
```

Use `--runtime=/absolute/path/to/packages/interpreter/out/index.js` for a separate
build. `--interrupt` installs an opaque cancellation signal without inspection.
The kernel comparator additionally takes `--probe=/path/to/probe/out/index.js`.

## Delivery verification

Three serial fresh processes per variant on c2ad9c94 and the delivered runtime,
using the same selected source (external host load uncontrolled):

| workload | parent median ms | delivered median ms |
|---|---:|---:|
| 257-headless | 594.478 | 596.659 |
| 257-flag | 1537.752 | 983.265 |
| 257-reference-1m | 222.124 | 225.937 |
| 255-control | 1367.744 | 1350.734 |
| 250-control | 200.670 | 198.602 |

Headless execution remains within run variation; cancellation-enabled execution
is about 1.56x faster. Controls retain the same answers. Fixture verification
took 0.616 s compiled and 8.594 s reference (two blocks/seven runs), and the
full source and fixture pass all four targeted type/differential audit checks.
Both files pass CLI checking; exclusion-policy tests pass (3 tests).
All 296 focused checks pass in seven suites.

Ordinary interpreter run: 9,261 passed, 28 failed in eight suites. All 28 failures
reproduce with the unchanged parent sources; there are no delivery-only failures.
The parent additionally fails the linked-helper return-contract regression that
this change repairs. Source, test and CLI TypeScript builds pass.
