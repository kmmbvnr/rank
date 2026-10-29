# Euler 255: interval traversal overhead

The optimized traversal is implemented in
[the demo](../demos/euler/255_roundedroots.ra). It retains the full Digits=14
assertion and fixes Digits=1. The main and full-default fixture retain their
manual execution-budget exclusions: reference execution still takes about
152 seconds. Small cases remain in the ordinary audits, and a full compiled
regression now runs in full-scale-demos.test.ts.

## Diagnosis

The whole default search already executes as **one private Number loop**, with
one amortized copy probe and no overflow/replay. The original unprofiled default
completed in 1922 ms. The powers reported as unsupported scalar expressions are
one-time setup expressions; they do not block the hot loop.

This is an interval search over 90 trillion integers, not enumeration of each n.
Nevertheless, the default visits 57,941,868 states and partitions 80,846,888
quotient groups. It pushes and pops 57,941,868 stack entries, each carrying four
cells including the depth. Those operations are inexpensive in the generated
loop and expensive through ordinary assignment, scope, mutation and array-cell
machinery in reference mode.

The reference profile at Digits=10 is concentrated in expression evaluation,
block execution, binding assignment/lookup and stack-array stores. The compiled
profile is dominated by the generated body, with about 10% in checkpoints.
There is no hot-loop compilation refusal or repeated large-array copying to fix.
No compiler precision or copy-admission thresholds were changed.

## Candidate algorithm

Count the work performed at each visited interval, rather than multiply terminal
interval sizes by a stored depth. Initialize Total with the entire population
for the first iteration; each subsequent state adds Hi-Lo+1 for its next step.
This removes the depth stack.

After one update, X is at least the rounded square root r. Indeed, if the next
estimate were below r, then n would be at most
`X * (2*r - 1 - X)`, whose maximum over integer X is `r*(r-1)`; that contradicts
the definition of r. Since `n <= r*(r+1) <= X*(X+1)`, the fixed-point condition
reduces to `n > X*(X-1)`. Count the current step, then discard that stable suffix
by clamping Hi to `X*(X-1)`. Only the remaining prefix needs partitioning.

Process the last child immediately in scalar registers, and push only its
siblings. The default still visits the same 57,941,868 states, but partitions
fall to **51,513,297** and stack entries to **16,067,309**. Three stack arrays
remain instead of four. This is an access/work reduction; the small removed
400-cell array is not a major memory saving.

A simple whole-interval fixed-point shortcut alone did not improve compiled
execution. Counting active work and trimming the stable suffix helped; continuing
the last child directly helped further.

## Measurements

Apple M5, macOS arm64, Node 24.15.0. Three serial fresh processes per row;
variant order reversed on alternate repetitions. Imports excluded; parsing,
preparation, execution and diagnostics included. External load was uncontrolled.
Instrumented counts and CPU profiles were collected separately from timings.

| source variant | compiled Digits=14 median ms | reference Digits=10 median ms |
|---|---:|---:|
| original traversal | 1942.800 | 2796.398 |
| whole-interval fixed-point shortcut | 1962.126 | 2619.005 |
| count active work and trim stable suffix | 1612.811 | 2117.298 |
| also continue the last child directly | **1283.900** | **1354.381** |

Original/tail compiled ranges were 1929.784–1954.441 ms and
1276.948–1301.956 ms. Reference ranges were 2768.902–2831.780 ms and
1326.882–1355.406 ms. This supports about **1.51x compiled** and **2.06x reference**
on these workloads.

The full optimized default also completed with compilation disabled in one run:
**151970.622 ms**, exact Total **400266100622279**, Count **90000000000000**,
Answer **4.447401118**. The full compiled original and all default prototypes
produce the same exact Total, not only the same rounded average.

Current original reference measurements were 363 ms at Digits=8, 2764 ms at
Digits=10 and 29599 ms at Digits=12. A current full-default original reference
run was not completed: the issue's older “over fifteen minutes” description
is historical evidence, not a refreshed measurement. Use the repeated
Digits=10 comparison for relative reference claims.

## Edge case and verification

The original fails at **Digits=1**: its even-digit initializer evaluates
`10 ** -1`, establishes X0 as real, then the odd-digit branch assigns an integer.
The existing type error is correct. Initialize the odd-digit expression first
and override it only for even digit counts. The timed/verified comparison
variants all include this setup repair; the mathematical setup for Digits>=2
is unchanged.

An independent oracle exhaustively applies the integer recurrence to every n
with 1–6 digits. All four variants, both engines and six digit counts pass:
**48 checks**, comparing exact Total and Count as well as the rounded Answer.
The delivered small fixture covers Digits=1..6 and checks exact Total/Count as
well as Answer. The full-default fixture retains Answer=4.447401118 and also
checks Total=400266100622279 and Count=90000000000000. The continuous full-scale
compiler regression requires Number-loop execution without overflow. See the
delivery validation below for the checks on the shipping files.

The stable-suffix/work-count traversal, last-child continuation and Digits=1
initialization repair are applied. Reference interpreter assignment/storage
costs remain a separate potential general investigation, requiring their own
contracts and cross-program benchmarks. The compiler already handles this hot
loop, so no compiler patch or numeric threshold change is included.

Raw samples, source snapshots, oracle results, diagnostics and instrumented
counts are in [the baseline](baselines/2026-10-29-euler255.json). The delivered demo differs from the timed tail snapshot only in its
explanatory comment. Historical prototype sources remain in the baseline JSON.

After building the current checkout:

```sh
node benchmarks/euler255-roundedroots.mjs
node benchmarks/euler255-roundedroots.mjs --Digits=10 --reference
node benchmarks/euler255-roundedroots.mjs --reference
node benchmarks/euler255-roundedroots.mjs --fixture
node benchmarks/euler255-roundedroots.mjs --default-fixture
node benchmarks/experiments/euler255-oracle.mjs
```

Pass `--runtime=/absolute/path/to/packages/interpreter/out/index.js` to use a
separate build. `--fixture` selects the small fixture; `--default-fixture` selects
the retained full assertion. Source overrides are loaded under the same module ID.

## Delivery validation

The shipping source matches the saved proposed-source hash. Twelve fresh checks
against the independent Digits=1..6 oracle pass (six cases in both engines).
The expanded six-run small fixture and the retained full-default fixture pass
in both engines. The shipping full reference fixture took 161375 ms in its
verification run; that is separate from the earlier 151971 ms benchmark.

All four full-scale interpreter tests pass, including the added full 255 check
requiring Number execution without overflow. The TypeScript test project builds,
all three CLI checks pass, and the small fixture passes its scoped differential
and type audits. Full production interpreter suites and exhaustive corpus audits
were not rerun: the implementation change is confined to the demo and its tests.
The long reference cases retain manual-budget exclusions; no assertion is removed.
