# Euler 328: second investigation

Research against c39c6b28, following the previous #359 optimization recorded
in `euler328-results.md`. The fresh issue #447 still lists 326 as unchecked;
it was already investigated in the preceding session. This investigation
selects the next unchecked problem, 328, without marking either one complete.
The initial research left production unchanged. The delivery follow-up below
records the implementation and additional validation.

## Cause of the remaining cost

The current program already executes its full numeric loop through the Number
compiler. It visits 500,427,464 candidates at N=200000. Diagnostics show one
compiled loop, one Number entry and no overflow. The scalar-function compiler
rejects the whole helper on its budget, but the loop backend compiles the work:
raising that budget alone is not a demonstrated performance improvement.

The old recursive source was optimized on October 23. Repeating that earlier
rewrite would miss the remaining quadratic search. The present opportunity is
primarily algorithmic; reference execution also pays for execution-driver,
statement, iteration and indexing machinery.

## Exact dominance and crossing search

Retain the existing candidate window, small-N search and allowed tree shapes.
For a fixed input i, subtree size s and height h, write the candidate cost as

    max(L(s), A(s), B(s))
    L(s) = i-s + Dp[i-s-1]
    A(s) = (h+1)*i + a[s]
    B(s) = h*i + b[s]
    a[s] = LongOffsets[s] - (h+1)*s
    b[s] = ShortOffsets[s] - h*s

Within a height group, L is nonincreasing if the computed Dp prefix is
nondecreasing. The precomputed b values are also nonincreasing over the
eligible sizes. Check this condition when preparing the table, rather than
assuming it for arbitrary future input sizes.

When a later size has a <= that of an earlier size, its A, B and L are all
no greater. Remove the dominated earlier size with a monotone stack. The
retained a values strictly increase, while max(B,L) decreases. The minimum
is therefore at the crossing or its predecessor, found by binary search.
The stack is updated only as the candidate window expands: a future size
must not discard a candidate before it becomes eligible.

`experiments/euler328-frontier.ra` implements this search. It checks the b
condition and Dp monotonicity and falls back to the existing enumeration if
either fails. A separate forced-fallback test exercises that branch. The
numerical JS model counts 11,417,195 binary-search/candidate evaluations,
instead of 500,427,464 original candidate visits; the two counts describe
different operations, not an instruction-level speedup.

`experiments/euler328-compact.ra` also removes the two-dimensional Offsets
table. These canonical trees have paths at only two paid depths. Propagate
just the longest and next-longest depth offsets from the children, using
child heights to select the matching depth. This reduces typed publications
from 960381 to 360113 cells on the full compiled input. It does not by itself
establish a reduction in peak process memory.

## Measurements

Apple M5 and Intel i7-10750H (root@jack.lan), Node 24.15.0. Three serial fresh
processes per cell; medians below. Execution includes parsing, excludes
imports. RSS is peak process RSS. Instrumented and profiled runs are separate.
Intel uses the unchanged interpreter build at `/tmp/rank319-delivery` and
copied, frozen benchmark sources, not the demos in that partial checkout.

| Host | Engine | N | Current s | Compact frontier s | Current MiB | New MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Mac | compiled | 200000 | 3.531 | 0.398 | 193.6 | 203.0 |
| Intel | compiled | 200000 | 8.578 | 0.972 | 179.0 | 213.8 |
| Mac | reference | 10000 | 3.937 | 1.350 | 194.9 | 318.8 |
| Intel | reference | 10000 | 12.191 | 4.145 | 179.8 | 299.3 |

The initial frontier with the full depth table takes 0.416/1.014 s compiled
on Mac/Intel; compacting the table gives a smaller additional improvement.

Full Mac reference execution of the compact version returns 260511850222 in
40.982 s with 468.9 MiB peak RSS (one uninstrumented control). The unchanged
full reference was stopped by a cooperative 10-second budget, at 338.1 MiB;
that is an incomplete execution, not a full baseline timing or peak. Do not
extrapolate the reduced reference timings into a claimed full-input speedup.

### Memory limitation and interpreter follow-up

The prototype is faster but does increase RSS in the repeated comparisons:
about 5% on Mac and 19% on Intel for compiled execution, and about 64-66% for
reduced reference execution. It is not yet an optimization satisfying a
strict no-memory-growth requirement.

A separate full reference run with an explicit pre-run GC and profiling takes
41.648 s, peaking at 349.9 MiB. Heap used is 23.2 MB before, 71.4 MB after
execution and 44.5 MB after GC; arrayBuffers return to their 31.6 KB baseline.
This supports distinguishing temporary allocation/heap policy from retained
DP arrays, but does not prove all retained heap is eliminated. GC/profile
instrumentation changes the peak and is not mixed into the default medians.

Diagnostics report no COW copies or selection snapshots in the reduced
reference run. The full reference profile includes execution-driver stream
resumption, prepared statements, sequence iteration, assignment and indexing;
GC is visible but is not the sole dominant cost. There is no evidence that
DP array copying is responsible here.

One general follow-up worth measuring is context reuse for prepared loop
bodies: `eval/blocks.ts::prepareLoopBody` currently calls `execute`, which
creates a new ExecutionContext for every iteration in reference execution.
Nested loop stream/body setup adds more short-lived objects. Reusing the
stable context could reduce allocation, but this investigation does not
implement it or claim a measured gain. Return/break/continue, protected blocks,
debugger suspension and recursive calls would need regression coverage.

## Verification

`euler328-oracle.mjs` reproduces the previous table/enumeration algorithm and
checks its monotonicity conditions. It separately computes unrestricted
interval minimax costs through 256, trying every guess independently of the
candidate-window/tree-shape shortcuts.

The frontier and compact Rank prototypes each match all 200001 DP cells of
the original enumeration at N=200000 on Mac with compilation. Compact also
matches all cells on Intel. Reference and exact-loop modes are checked at
N=10000, and small inputs exercise zero/singleton cases, the N=100 switch,
power boundaries and forced fallback. See the baseline JSON for the exact
case counts and raw results. The full answer remains 260511850222.

The existing focused minimax test passes in both engines (2 tests). The
TypeScript build passes. No full suite or exhaustive audit was started.

## Reproduce and recommendation

    node benchmarks/experiments/euler328-series.mjs
    node benchmarks/experiments/euler328-verify.mjs 200000 compiled compact
    node benchmarks/experiments/euler328-verify.mjs 10000 reference compact
    node benchmarks/experiments/euler328-small-verify.mjs
    BUDGET_MS=10000 node benchmarks/euler328-investigation.mjs reference 200000 current

The dominance/crossing algorithm is promising: roughly 9x compiled and 3x
reference at the measured sizes, with the original answers preserved. Before
production adoption, address the measured RSS increase or explicitly accept
that tradeoff. General reference-loop allocation work is more directly
motivated here than changing a compiler budget that already permits the
numeric loop to compile. That was the initial research recommendation; the delivery follow-up below
records the subsequent implementation.

## Delivery follow-up

The production demo now uses the checked frontier and the two-depth table.
Frontier storage is sized to the number of eligible sizes, not the entire tree
size range. Comments and Rank source lines stay within 40 columns.

The interpreter now reuses the execution context for prepared reference loop
bodies and existing branch contexts. Control carriers remain specific to their
traversal/call. This removes repeated context object construction; it does not
turn reference arithmetic into a compiler backend. A more elaborate synchronous
condition-loop experiment was tested and rejected: its extra code did not show
a convincing benefit and increased RSS. That experiment is not in the change.

On the same compact prototype, paired context-only measurements show no stable
speed improvement: Mac medians 1.438 -> 1.437 s, Intel 4.066 -> 4.101 s. Intel
RSS changes 299.8 -> 292.5 MiB; Mac 312.7 -> 313.4 MiB. These small differences
must not be described as a general speed or RSS win. The concrete improvement
is avoiding a fresh context object per reference iteration/branch. Two earlier
exploratory series overlapped tests/builds and are excluded from these results.

Final production-source medians (three fresh processes):

| Host | Engine | N | Seconds | Peak MiB |
| --- | --- | ---: | ---: | ---: |
| Mac | compiled | 200000 | 0.396 | 198.7 |
| Intel | compiled | 200000 | 0.996 | 209.6 |
| Mac | reference | 10000 | 1.261 | 317.1 |
| Intel | reference | 10000 | 3.909 | 290.6 |

A final full Mac reference control finishes in 38.476 s, but reaches 610.3 MiB
peak RSS. Together with the earlier controls, this reinforces that peak RSS is
not solved; fewer table cells/context allocations must not be advertised as
lower peak memory. No heap limit or forced GC is applied to production runs.

Final production verification compares all 200001 DP cells against the previous
500-million-candidate enumeration in both compiled and reference engines on
Mac, and compiled execution on Intel. Exact-loop mode checks all 10001 cells
at N=10000. The focused independent interval minimax test is extended to 512.
New regression tests retain the full golden, assert Number backend execution
without overflow and exercise forced fallback in both engines.

The shared workspace contains unrelated concurrent language/demo changes.
The initial selected run passed 469 tests and failed the two existing Euler 213
binding checks (`reshape dimensions must follow reshape`); that same error
reproduces using the interpreter saved before this task. A clean HEAD archive
with only this change is built and tested separately for delivery; its result
is recorded in the delivery baseline. No full suite or exhaustive audit is run.

Clean-HEAD validation (with the required archived fixture restored) passes
all 200 explicit-demo tests, including Euler 213. Together with the 268
focused runtime tests and three Euler 328 regressions this is 471 passing
tests. The unrelated shared-workspace failures are not present in this change.
The ordinary Rank fixture and manual full-input golden fixture both pass.
