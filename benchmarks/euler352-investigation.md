# Euler 352: real arrays in compiled scalar functions

Investigation and delivery, 2026-11-03; source baseline `1bcc931f`.
Issue #447 lists `euler/352_bloodtests.ra` as the next unfinished task after 351.
The initial investigation below records the baseline and private experiments.
The production changes and final measurements are documented under Delivery.

## What the program computes

The [statement](https://projecteuler.net/problem=352) asks for the sum of expected
optimal screening costs for 10000 sheep and probabilities 0.01 through 0.50.
The program uses two DP states: T(n) for an unexamined flock, and C(n) when at
least one member is known to be infected. Pow(n)=(1-p)^n supplies probabilities.
C(1)=0: when a single sheep is known infected, no additional test is needed.

The recurrence is suitable; the source nevertheless computes many unused states.
The ordinary T recurrence uses only C(m) for m <= Cap=floor(2/p)+50. Thus C(n)
for n>Cap is never needed by T, nor by earlier C states. Computing C and Pow only
through min(Size,Cap) is an exact dependency reduction within the existing cap.
After that prefix, precompute Cost(m)=(1-Pow(m))*C(m), and update only T(n).
The selected `cost` experiment retains the original `1.0 + T(n-m)` followed by
`+= Cost(m)` ordering, avoiding an unnecessary change to floating arithmetic.

Inner DP iterations fall from **67362140 to 33819950** at the default input.
Two full-size arrays become small prefix arrays; one extra small Cost array is
added. T remains full-sized. All experimental cost source lines are <=40 chars.
This source is longer than the original: it separates the coupled prefix from
the simpler tail rather than introducing a new asymptotic algorithm.

The original Cap is a heuristic in source, not a proved language/compiler bound.
An uncapped JS recurrence at Size=10000 gives bit-identical values for all 50
probabilities, so it does not change this task's default result. This empirical
check does not prove the cutoff for every possible input/probability.

## Main compiler gap

The entire `blood` function already enters a linked scalar kernel. It is not
being interpreted statement by statement in the default compiled run. However,
`compileScalarNumberKernel` in `jit/scalar-function-kernel.ts` admits constructor-
owned local arrays only when their element type is integer. Blood uses real
arrays. Their reads/writes therefore retain the exact kernel's general storage
machinery and BigInt induction/index arithmetic. At Size=100, diagnostics count
50 scalar calls and **zero Number functions** in the original.

The Number scalar emitter already supports much scalar real arithmetic. An
isolated emitted-JS experiment admits local rank-one real constructors, preserves
real fills and writes, and allows real-valued arguments through the direct-leaf
Number argument check. It then records **50 Number functions with zero fallbacks**.
No speculative integer safety threshold was raised. Integer checks remain needed.

There is also a tier-selection issue: disabling scalar entries/functions/calls
lets the existing ordinary function-body path compile its loops in Number mode.
One full-input trial gives 0.470 s on Mac / 1.284 s on Intel for the original,
already much better than the default exact scalar entry. The new private-array
Number function is faster still. This identifies an existing fast backend being
bypassed as well as missing support in the selected backend.

The historical emitted-JS patch is a feasibility probe, **not the production fix**. Before
shipping, make guards depend on proved parameter/destination domains, preserve
integer compound-write safety, and test mixed real/integer arguments, signed
zero/nonfinite values, alias rejection, overflow replay, error locations and
cancellation. The numeric direct-call error-frame path currently converts its
arguments with BigInt; that also needs review for newly admitted real arguments.
No wider correctness or cancellation claim is made from these DP-only checks.

## Full-input compiled measurements

Node 24.15.0; Mac arm64 and Intel x86_64. Three fresh sequential processes per
combination per host. Timings include source parsing/preparation/execution,
excluding imports/process startup. Peak RSS is whole-process; external load was
uncontrolled. The runtime matches the compiler at `2bf0aeac` (351 changed no compiler).

| Source / runtime | Mac seconds | Mac MiB | Intel seconds | Intel MiB |
| --- | ---: | ---: | ---: | ---: |
| Original / stock | 4.403 | 190.2 | 10.280 | 208.0 |
| Reduced DP / stock | 1.212 | 182.8 | 3.158 | 172.8 |
| Original / Number prototype | 0.248 | 179.1 | 0.646 | 166.0 |
| Reduced DP / Number prototype | 0.200 | 178.8 | 0.494 | 168.6 |

The compiler-only experiment is about 17.7x faster on Mac and 15.9x on Intel;
combined changes are about 22.0x / 20.8x. Neither combined series increases RSS
relative to the original stock run. This is a realistic general compiler target,
not a special Euler-only arithmetic trick.

Reference execution was measured at **Size=1000**, not the full default: one
serial trial per source on Mac gives 18.010 s / 282.7 MiB original versus
4.935 s / 243.8 MiB reduced DP. Both produce 37856.758729. Do not present these as
full-input timings or medians. The default original reference was not run.

## Array-oriented alternative

The `vector` experiment uses a gather plus array minimum for the tail:

```rank
M = 1 to Cap array
Cost = 1.0 + (1.0 - Pow M) * C M
for N in Cap + 1 to Size
  T N = T (N - M) + Cost min
end
```

It gives the correct rounded total, but an exploratory full-input Mac trial
uses 8.530 s / 624 MiB. It overlapped other research and is not a controlled
comparison. Size=100 diagnostics show no fused array regions, 2167 typed-array
publications / 130560 cells, and Number-loop input rejection around local M.
The gather/reduction tail is not staying in one compiled numeric region.
This identifies a separate array-fusion/loop-binding follow-up; it is not the
selected source while allocation and speed are worse. The scalar tail plus
real-array Number compilation is the immediate smaller change.

## Verification and result

The full answer remains **378563.260589**. An uncapped native JS DP computes
378563.26058948983 and finds zero differences against the capped recurrence for
all 50 full-size probabilities. It takes one Mac sample of 4.663 s / 59.3 MiB;
this is an independent implementation of the same recurrence, not a proof that
the recurrence covers every possible testing strategy.

126 inputs cover all probabilities at Size=25, boundaries and larger sizes
through 512, and 20 deterministic random cases. Original and reduced sources
in both stock engines give 504 comparisons; both with the Number prototype give
252 more. **756 comparisons per host** pass on Mac and Intel, with maximum
absolute discrepancy zero against the uncapped JS DP. A separate native check
covers 450 capped/uncapped small cases, also with zero discrepancy.
The existing two-block companion fixture passes against the reduced source in
both reference and prototype-compiled execution on Mac. Every measured full
run prints the same golden result (the worker asserts it).

The initial research did not change production or run broad tests. The delivery
work below implements the compiler fix and adds dedicated regression coverage.

## Reproduction

```sh
RANK352_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler352-investigation.mjs demos/euler/352_bloodtests.ra compiled 10000
RANK352_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler352-investigation.mjs benchmarks/experiments/euler352-cost.ra reference 1000
RANK352_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler352-verify.mjs
node benchmarks/euler352-oracle.mjs
```

`RANK352_NO_SCALAR=1` disables scalar entry/call/function backends for the tier
comparison. `RANK352_COMPILED_ONLY=1` restricts oracle checks to compilation.
The worker's fourth argument enables diagnostics; `RANK352_KERNEL_OUTPUT` saves
available compiler hooks' emitted sources. These hooks do not expose the linked
scalar kernel itself. Do not mix diagnostic runs with timing trials.
`experiments/euler352-real-private-arrays.patch` is the isolated emitted-runtime
probe, applied from a private directory containing matching `out/`.
Raw series and caveats: `baselines/2026-11-03-euler352-investigation.json`.


## Delivery

Production admits constructor-owned rank-one real arrays to the scalar Number
kernel. Real fills, unary negation and writes preserve fractional, nonfinite and
signed-zero values; integer expressions and compound writes retain safe-integer
checks and exact replay. Argument admission follows the proved parameter domain,
so a real parameter no longer fails the integer-only gate. The numeric direct
call error frame also preserves real/boolean arguments instead of converting all
arguments to BigInt. Array arguments, ownership, escaping arrays and replay
boundaries retain their existing restrictions.

The final demo adds exact dominated-pool pruning after the short coupled prefix.
A pool of size m has unconditional cost A(m)=1+(1-Pow(m))*C(m). If A(m)>T(m),
replacing that pool by the cheaper partition represented by T(m) improves any
larger partition. Only equality cases need remain. Replacing discarded pools
recursively terminates at smaller retained groups. At the default probabilities,
416 pool sizes remain across all 50 runs, versus a total original Cap of 3382.
This is separate from the existing heuristic Cap: the proof justifies pruning
within that bound, whose default correctness the uncapped oracle checks.

An initial indexed-pool tail gave full Mac reference samples of 8.02–10.03 s,
but raised peak RSS to 412–436 MiB from the original 290 MiB. The final tail
iterates the retained array directly and stops at its zero sentinel. It avoids
explicit selector reads and rebinding M for each candidate. Full reference RSS
then falls to 199–265 MiB (median 212 MiB), while retaining Number compilation.
Both candidates and their raw samples remain available; only direct iteration
is applied to the production demo.

Final full-input medians (three fresh serial runs, same measurement scope as
above; external load uncontrolled):

| Host / engine | Original seconds | Final seconds | Original MiB | Final MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / compiled | 4.403 | 0.154 | 190.2 | 178.0 |
| Intel / compiled | 10.280 | 0.355 | 208.0 | 167.0 |
| Mac / reference | 170.054 | 6.138 | 289.9 | 212.5 |
| Intel / reference | not measured | 19.387 | not measured | 246.1 |

The original full Mac reference has **one sample**, not a median of three.
Original compiled controls come from the earlier three-run research series.
All final full runs assert **378563.260589**. RSS is whole-process peak, not
retained heap; the spread of reference samples matters when comparing hosts.

Validation:

- Langium generation and `tsc -b tsconfig.build.json` pass.
- 648 focused tests on Mac cover scalar kernels, real domains, extrema, integer
  overflow, array borrowing/aliasing, recursion, loops and Euler 352. Seven new
  compiler tests assert actual Number entry, private-write overflow replay,
  signed zero/nonfinite values, wide integer argument rejection, error frames
  through a Number loop, invalid indices, escape rejection and cancellation.
- Current Euler regression tests compare 126 cases against uncapped DP in both
  engines and assert the full compiled golden plus 50 Number entries with no
  fallbacks. The existing fixture also gains Size=1 boundaries.
- 131 current focused tests pass on Intel, including all seven new compiler
  tests, numeric domains and the final demo's oracle/full compiled checks.
- Four scoped type/differential checks cover the final program and fixture,
  including the full reference run. All three exclusion-policy checks, CLI
  source check and companion fixture pass. The default execution exclusion is
  removed. No full suite or exhaustive corpus audit was run.

Full reference runs stay in scoped differential checks and the benchmark series;
the ordinary Euler test file avoids duplicating that expensive full reference
execution. The standalone `euler352-oracle.mjs` verifies the full uncapped sum.
`RANK352_VARIANTS=pool-iteration` selects the final source in the oracle driver.
The historical `.patch` remains an experiment; production TypeScript is the
reviewable implementation. Delivery samples and validation metadata are stored
under `delivery` in the baseline JSON.
