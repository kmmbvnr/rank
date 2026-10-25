# Euler 088: compiled array frames

The unchanged `088_productsum_stack.ra` and its fixture spend most of their
time interpreting the DFS and constructing checked array frames. The existing
nondecreasing-factor DFS is practical at the original limit of 12000, although
its bounds admit unnecessary states. The answer remains **7587457**.

Before this change, diagnostics report zero compiled loops:

- The outer loop is rejected at `UnpackStatement`.
- The inner loop is rejected at the array passed to `Todo push`.
- The integer deque specialization cannot pop an array-valued frame.

The compiler now lowers homogeneous scalar vector literals and rank-one scalar
array unpacking, and accepts integer arrays in native stacks, queues and deques.
Entry guards check container methods, array ranks and cell domains. Pushes retain
the ordinary collection type and ownership checks. Unpack checks arity and
snapshots cells before committing target bindings, retaining placeholder,
duplicate-target, partial-store and error-location behavior.

The complete original DFS now executes as one exact integer loop. No demo,
algorithm, default input, assertion, execution lane or timeout was changed.
Loops that write arrays retained by a deque, including their aliases, keep the
reference path: they need per-statement copy-on-write beyond the existing
region-entry guard. Deferred bindings also retain their existing reference path.
Writes through locally created array aliases also keep the reference path.

## Controlled measurements

Node v24.15.0 / Apple M5. Three serial fresh processes per workload and version,
reversing workload/version order between samples. Baseline: `28e5afe0`, built
and copied before implementation. Both runtimes use identical demo and fixture
sources. Execution includes parsing, all DFS work and the final reduction.
Diagnostics and oracle validation are outside the timed comparison.

| Workload | Before, s | After, s | Speedup | Before peak RSS, MiB | After peak RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Main | 4.322 | 1.706 | 2.53x | 577.6 | 607.1 |
| Fixture, all three tests | 4.400 | 1.746 | 2.52x | 576.7 | 619.5 |

A separate preliminary reference pass measured 4.302 s for the main and
4.359 s for the fixture (three-sample medians). The old issue inventory's roughly
21-second observations came from another runtime and a concurrent audit; they
are not the baseline for this comparison.

Peak RSS is the whole-process high-water mark through execution, including
imports, temporary allocations and GC behavior. It is not retained frame storage.
**This change improves speed, not memory:** median peak RSS rises about 5% for
the main and 7% for the fixture. The 421978 frame arrays are still constructed.
The fixture repeats the default computation once; its four small runs add little
to the total.

## Separate experiments

These variants exist only in the benchmark; none replaces the shipped demo.
Every main run checks all 12001 `Best` entries against an independent numeric
DFS, in addition to checking the answer. All variants retain exact integer
arithmetic in Rank.

| Variant on the updated runtime | Median, s | Process peak RSS, MiB |
| --- | ---: | ---: |
| Original array-frame DFS | 1.706 | 607.1 |
| Bound the next factor using the requested `k` | 0.955 | 617.4 |
| Four integer stack entries per frame, same search | 0.201 | 172.4 |
| Original with deferred `K'` and `Next'` | 6.627 | 495.6 |

For product `P`, sum `S` and factor count `C`, appending `F` gives
`k = (P - 1) * F - S + C + 1`. For `P > 1`, intersect the existing bound
`2 * Limit // P` with `(Limit + S - C - 1) // (P - 1)`. The root needs its
existing bound to avoid division by zero. This reduces frames from 421978 to
204620 and preserves every minimum. It is an independent algorithm improvement,
not a prerequisite for the compiler fix.

Flattening frames into integer stack entries avoids their arrays and already
uses the preceding scalar deque compiler. It demonstrates the remaining
allocation/ownership overhead, but makes the source more verbose. Deferred
scalar bindings add plan construction and demand costs here; they do not remove
a large intermediate collection and still prevent whole-loop compilation.
The rejection was not removed: doing so would change unused-plan and error
timing behavior.

## Reproduction and validation

Build with `npx tsc -b tsconfig.build.json`, then run:

```sh
node benchmarks/euler-product-sums.mjs --samples=3
node benchmarks/euler-product-sums.mjs --samples=3 --baseline-runtime=/path/to/baseline/out/index.js
node benchmarks/euler-product-sums.mjs --cases=stack,fixture --engine=reference
node benchmarks/euler-product-sums.mjs --worker=stack --diagnostics=true
```

[Raw samples and runtime/source hashes](baselines/2026-10-26-euler088-array-frames.json)
also retain the separate diagnostic and preliminary reference runs. Keep builds,
tests and profilers out of the benchmark interval.

Both Euler files passed differential execution and the name/type audit, retaining
all three embedded tests and the full-size golden assertion. Twenty-one new focused
tests cover stack/queue/deque growth, scalar domains, signed literal cells,
unpack placeholders and duplicate targets, arity errors, earlier completed
stores, empty pops, host overrides, copy-on-write fallbacks and unused deferred
expressions. Broader validation is recorded in the compiler progress log.
