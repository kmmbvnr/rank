# Euler 268: numbers divisible by at least four small primes

Investigated on 2026-10-30 from `080fbbc5`, following completed Euler 266 in
issue #447. The initial investigation below is retained as experimental evidence.
The production implementation, final measurements and verification are recorded
in Delivery at the end of this report.

The inclusion-exclusion algorithm is sound. Most avoidable work comes from
rebuilding masks, subset sizes and weight lookups for each left subset. A compact
array rewrite improves both execution modes. A separate recursive experiment
exposes a general compiler return-inference limitation.

## Full-input comparison

Node v24.15.0, macOS arm64. The frozen runtime from the preceding Euler 266
delivery has identical interpreter TypeScript sources to the current checkout:
`3c5fb2fd` plus the final `sequence-order.ts` change from `080fbbc5`. It is isolated
from other sessions' builds. Fingerprints and all raw samples are in
[the baseline JSON](baselines/2026-10-30-euler268-investigation.json).

Each cell below is the median of three fresh, serial processes in the final
18-process series. Cases rotate by round. Parse and execution are timed; imports
are excluded. Diagnostics and a scalar-function execution counter are enabled.
No own tests/builds overlap this series. External load is uncontrolled and was
substantial: the final original samples span 9.80–10.51 s compiled and
15.11–16.25 s reference, versus exploratory samples of 4.12 and 6.39 s earlier.
Do not pool those separate series or treat the absolute times as an idle-machine
baseline. Within-round speedups remain 3.49–3.61x compiled and 2.48–2.73x reference.

| Variant | Reference | Compiled | Reference / compiled peak RSS |
| --- | ---: | ---: | ---: |
| Original | 15.558 s | 9.846 s | 463 / 487 MiB |
| Sorted right products + cached weight rows | 5.984 s | 2.807 s | 362 / 379 MiB |
| Recursive quotient search, explicit base return | not measured full-scale | 4.292 s | — / 177 MiB |
| Same recursion without base return, compiler prototype | not measured full-scale | 4.358 s | — / 176 MiB |

The preferred array rewrite improves reference **2.60x**, compiled **3.51x** and
reduces median peak RSS by about **22%** in both modes. Every full run asserts
`Answer = 785478606870985`. The historical minutes-long budget exclusion was
not reproduced. Existing audit exclusions and timeouts remain unchanged.

## Where the original spends work

There are 25 primes below 100. The left half has 4,096 subsets and the right
half 8,192: 33,554,432 potential pairs. Only 9,597,723 pairs, including the
empty subset, have product below Limit. The largest right product needs 79 bits;
Max itself exceeds Number's exact integer range. BigInt arithmetic is required.

Original diagnostics report zero compiled scalar loops, 8,192 compiled tensors,
8,192 mask materializations and 19,195,446 output cells from those selections.
The loop compiler rejects deferred assignments. Making the three local stages
stored instead exposes the next blocker, `MaterializeExpression`; simply
removing the deferred-binding check cannot compile this region correctly.
The two subset-building loops also lack compiled array concatenation here.

CPU profiling of the original finds generic scalar operators, dense array
mapping, array construction, readers and GC among the leading self samples.
There is no evidence that the 4,096 outer interpreter iterations alone explain
the cost: changing the array operations within those same iterations is enough
for the main improvement.

## Preferred compact array rewrite

Keep subset generation and the inclusion-exclusion coefficients. After building
Pb/Kb, sort both by product once:

```rank
Ord = Pb argsort
Pb = Pb Ord
Kb = Kb Ord
```

Add `use algo`. After computing Weights, prepare all possible weight rows:

```rank
Counts' = (0 to H array) reshape (H + 1) 1
BySize = Weights (Counts + Kb)
```

This is only 13 × 8,192 entries. Replace the final loop with:

```rank
Answer = 0
for I in 0 till (Pa len)
  A = Pa I
  Q = Max // A
  N = Pb upperindex Q
  Ds' = Pb take N array
  Row' = BySize (Ka I)
  W' = Row take N array
  Mult' = Q // Ds
  Answer += (W * Mult) sum
end
```

The boundary search replaces a full mask scan. The cached rows replace repeated
`Kb + Ka I` and `Weights Sizes`. Positive integer division satisfies
`Max // (A * D) = (Max // A) // D`, avoiding per-cell wide multiplication.
Deferred stages remain deferred; the ordinary BySize assignment explicitly
stores the reusable table. No additional search loop is introduced.

Diagnostics for the full compiled prototype have zero mask materializations,
8,192 compiled tensors and only 8,445 cells counted through ordinary computed
array readers, compared with 19,195,699 in the original. This counter does not
include all cells executed inside native kernels, so it is not a total-work ratio.

Other experiments are retained in the runner. Merely storing Ds does not help;
storing Ds/Sizes/Mult does improve time, but has higher RSS than the chosen
variant. Sorting alone leaves repeated size/weight construction. A frontier
that retains all valid subsets used about 1.44 GiB in one exploratory full run.
The recursive alternative is compact and saves more memory, but did not beat
the chosen array version in the final instrumented compiled comparison; its
full reference performance was not established.

## General compiler finding

The recursive quotient search maintains `Q = floor(Max / product)` and visits
only valid subsets. The body starts with `Result = 0` and ends with
`return Result`. Current scalar-function proof cannot establish the recursive
call's result type before visiting that call, reporting
`scalar-function:call-graph` and `scalar-function:unsupported-op:visit`.
Adding a logically redundant early `return 0` establishes the type and enables
compilation of the whole recursive helper.

An isolated runtime prototype instead seeds the return candidate from the
closed initializer of a returned local in the straight-line assignment prefix.
It then runs the existing complete flow proof, including binding-type checks
and all returns. It does not evaluate an initializer early, force a plan, or
remove a deferred-binding guard. Only `jit/scalar-function-proof.js` differs
between the two isolated JS runtimes. The exact exploratory patch is in
[experiments/euler268-return-seed.patch](experiments/euler268-return-seed.patch).

The no-base-return helper then compiles and produces the full correct answer;
the scalar-function hook records 9,597,723 calls. This is a general compiler
improvement, independent of Euler-specific constants. It does **not** accelerate
the original array program: its mask/gather/materialization pipeline is a
separate compilation capability. The generated-JS patch here is the original experiment; the TypeScript
implementation and regression coverage are recorded in Delivery below.

## Verification and reproduction

140 fresh-process answer comparisons passed:

- 100 comparisons of the original and four initial variants in both modes;
- 20 of the preferred cached-row variant in both modes;
- 20 of the no-base-return recursion using the prototype runtime in both modes.

Each group covers ten input configurations, including empty prime sets,
exclusive prime boundaries, impossible Least, an exact product boundary and all
four existing fixture inputs. Nine configurations use an independent direct
sieve counting the number of distinct eligible prime divisors of every integer;
the 10^12 configuration uses its unchanged fixture golden answer.
Eight additional recursive-return checks pass with the prototype: integer and
real accumulators and preservation of the type-changing-assignment error.
No ordinary package suite or exhaustive audit was run because production code
was not changed. Full default answers were checked separately in every timed run.

```sh
RUNTIME=/absolute/path/to/frozen/out/index.js \
  node benchmarks/euler268-investigation.mjs compiled sorted-cached
RUNTIME=/absolute/path/to/frozen/out/index.js \
  node benchmarks/euler268-verify.mjs
RUNTIME=/absolute/path/to/prototype/out/index.js VARIANTS=recursive-no-base \
  node benchmarks/euler268-verify.mjs
RUNTIME=/absolute/path/to/prototype/out/index.js \
  node benchmarks/euler268-return-seed-verify.mjs
```

The recommendation is to ship the compact array rewrite and separately promote
the small general return-inference fix with focused compiler regression tests.
Retain the inclusion-exclusion algorithm and the exact integer semantics.

## Delivery

Implemented the cached-row array rewrite in the production demo and the general
return-inference fix in `src/jit/scalar-function-proof.ts`. The initializer is
used only to propose a scalar domain; existing full-flow validation remains
mandatory. Parenthesized terminal names are also recognized. Deferred stages,
ordinary assignment boundaries and error order are preserved. No input, golden
answer, audit lane or timeout was changed; the fixture's obsolete minute-long
runtime comment was updated.

The production source is read directly by the new `shipping` runner variant.
A separate 15-process series compared the original frozen runtime/source with
an isolated build containing exactly the final compiler TypeScript change.
Only `jit/scalar-function-proof.js` differs between those JS trees. The series
uses three fresh serial processes per cell, rotated cases, the same diagnostics
as before, and no overlapping own tests or builds. Raw samples and hashes are
under `delivery` in the baseline JSON. External load was lower than during the
initial investigation; do not pool their timings.

| Isolated delivery comparison | Reference | Compiled | Reference / compiled peak RSS |
| --- | ---: | ---: | ---: |
| Original | 6.428 s | 4.211 s | 464 / 493 MiB |
| Production array rewrite | 2.423 s | 1.189 s | 356 / 375 MiB |
| Recursive helper without base return, final compiler | not measured full-scale | 1.816 s | — / 176 MiB |

This isolates a **2.65x reference / 3.54x compiled** improvement, with median peak
RSS reductions of **23% / 24%**. The helper is a compiler regression workload;
the production demo retains the faster compact array approach.

Concurrent upstream commit `adbd8e95` lowered integer-array packing from 4096 to
64 cells. It was merged normally, preserving both histories. After integration,
workspace and isolated TypeScript builds passed, as did:

- **381 checks across 10 focused files**, including the new return-inference
  regressions, recursion/depth/error contracts, scalar dependencies, function
  plans, explicit-plan demos, sorting/search and tensor copy storage;
- **two scoped type/differential checks** for the unchanged Euler 268 fixture;
  4,191 other audit cases were skipped, and the budget-excluded main was not
  included in those audits;
- **60 independent answer comparisons** of the actual production demo, original
  demo and no-base-return recursive helper, in both modes, across ten inputs.

The seven new compiler checks were first run against the old proof: three
compilation assertions failed as expected while four contract checks passed.
They all pass with the fix. The demo checks additionally verify the stored
weight table and deferred size grid.

Before integration, the same 60 oracle comparisons passed with the isolated
compiler-only build. Semantic-boundary checks passed for all 65 owners again
after integration.
No full package suite or exhaustive audit was run.

The actual integrated shipping source was also run in three fresh processes per
mode: medians **2.997 s reference / 1.521 s compiled**, peak RSS **417 / 360 MiB**.
A separate full helper run took 2.282 s and recorded 9,597,723 compiled scalar
calls. These are a separate post-merge series, with changing host load; they are
not a controlled estimate of the packing commit's effect. Every full run still
asserts `Answer = 785478606870985`. Integrated samples and verification are under
`integration` in the baseline JSON.

Late unchanged-baseline controls also rose to 7.366 s reference / 4.860 s
compiled. These single controls are retained, not substituted for the three-run
medians or used to attribute a regression to the packing threshold.
