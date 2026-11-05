# Euler 416: A Frog's Trip

Research base: `200fcffb`, Node v24.15.0, 2026-11-05. Selected from the
fresh unfinished rows of #447, after Euler 415. This records the initial
investigation and isolated compiled-JS prototypes. See the
[delivery report](euler416-followup.md) for production changes and validation.

## Findings

The issue's old approximately 20-second exclusion is stale for this checkout.
The full current demo answers **898082747** in approximately 3.2 seconds on
Mac. Reference execution takes almost the same time. The dominant cost is the
shared linear-algebra implementation, not interpreted loop dispatch.

The algorithm already uses a good reduction: 2M legs are aggregated by the
counts of consecutive skipped squares. At M=10 there are 231 states. T covers
visited internal squares and Z covers a skipped square. Exponentiation uses
dual-number coefficients (T + e Z), e²=0, so it counts zero or one unvisited
square in about 40 squarings rather than enumerating 10^12 squares.

The `mm` helper splits the left operand at 2^15. Existing `denseMatmul` proves
that each resulting dot product stays within the exact Number integer range,
then uses `numberMatmul`. Thus the manual split already gets a fast, exact
numeric path even when Rank compilation is disabled. There is no evidence that
simply compiling this helper would remove the dominant cost.

The current full calculation still does 240 dense matrix products from the
squarings alone, about 2.96 billion scalar multiplications, plus much cheaper
matrix/vector products. The last squaring is unused and can eventually be
removed, but saves only about 1/40 of squaring work. State construction and
transitions are not a significant performance target.

A phase-instrumented full Mac run:

| Phase | Time |
| --- | ---: |
| Parse/imports and state construction | 0.139 s |
| Transition construction | 0.009 s |
| Matrix powering | 3.021 s |

A separate V8 CPU profile attributes 71.7% of samples to `numberMatmul`,
5.7% to stored Int32 binary arithmetic, 4.0% to `denseMatmul`, 1.7% to compact
binary arithmetic and 1.4% to integer-bound checking. GC accounts for 0.9%.
Profiling/phase observations are not used as the unprofiled timing baseline.

## General kernel experiment

Keep the Rank program and its exact bound proofs unchanged. In an isolated
copy of `interpreter/out`, specialize only canonical stored rank-two products:
transpose the right operand to contiguous columns and calculate four output
columns together. Each output still accumulates in the original inner-axis
order. The scalar left cell is reused across four independent accumulators.
Other ranks, layouts and non-private polling retain the existing path.

This applies to both reals and proved-exact integers; it does not recognize
Euler-specific syntax or add a language operation. Transposition alone helps,
but four independent accumulators account for much of the gain.

| Full default variant | Mac seconds | Intel seconds |
| --- | ---: | ---: |
| Current Rank, median of three | 3.213 | 7.544 |
| Transposed four-output prototype, median of three | 1.539 | 3.899 |
| Transposition only, one probe | 2.472 | not measured |
| Hand-fused JS modular control, median of three / one Intel probe | 2.221 | 4.704 |
| JS per-product modular `imul` control, one probe | 2.636 | 7.265 |
| Current Rank reference, one probe | 3.225 | 7.791 |
| Prototype reference, one probe | 1.557 | not measured |

The general kernel prototype is approximately **2.1x faster on Mac** and
**1.9x faster on Intel**. All full answers agree. Samples were fresh processes;
load was not controlled and the full sample sequences were not all alternating.
The JS controls share Rank transition construction, then use native typed
residue matrices; they are controls, not production interpreter implementations.

Current peak RSS ranges are 261.5–265.8 MiB (Mac), 242.3–248.3 MiB (Intel).
Prototype peaks are 268.1–269.6 MiB and 246.2–247.6 MiB respectively. Memory
is roughly unchanged, with about 4 MiB higher median on Mac. The prototype
allocates a transposed Float64 operand per product; this is not a memory-saving
result, and no claim of reduced retained memory is made.

## Verification and next step

- An independent oracle enumerates one-way jump routes and combines visited
  square masks over 2M legs. M=1..3 and N=2..8 plus published F(2,100)
  give 44 reference/compiled checks. Both the original and the four-output
  prototype pass; the latter also passes on Intel.
- Thirty-six additional products match direct scalar oracles for integer and
  real inputs, rectangular matrices, four-column remainders and contractions
  over 256 cells. They pass on both hosts.
- The unchanged Euler 416 differential fixture passes. No exhaustive audit or
  full suite was run.

The next useful implementation is a general stored 2-D `numberMatmul` kernel,
not a rewrite of the recurrence or duplication of the `mm` formula. Preserve
the original budget charging and cancellation cadence (the research prototype
only checks by row); keep guarded fallbacks for other layouts and observable
execution. Add production tests for stored permutations, shape boundaries,
unsafe integer bounds, real edge values and execution budgets. Consider compact
transpose storage and bounded per-invocation reuse to avoid extra peak memory.
The old full-reference exclusion can then be reassessed with fresh timings.

The initial investigation did not change production code or GitHub.
Its follow-up implements the general kernel and restores the full audit.

## Reproduction

Build the checkout, then run:

```sh
node benchmarks/experiments/euler416-run.mjs
node benchmarks/experiments/euler416-run.mjs reference
node benchmarks/experiments/euler416-verify.mjs
node benchmarks/experiments/euler416-native.mjs
```

Copy `packages/interpreter/out` and make its dependencies resolvable in an
isolated directory. Never patch the checkout's normal `out` for this experiment:

```sh
node benchmarks/experiments/euler416-matmul-prototype.mjs /isolated/interpreter/out
RANK416_RUNTIME=/isolated/interpreter/out/index.js \
  node benchmarks/experiments/euler416-run.mjs
RANK416_RUNTIME=/isolated/interpreter/out/index.js \
  node benchmarks/experiments/euler416-verify.mjs
RANK416_OUT=/isolated/interpreter/out/ \
  node benchmarks/experiments/euler416-matmul-verify.mjs
```

The prototype patch script requires a fresh compiled file. Restore that file
before trying the optional `dot` variant (transposition without four outputs).
Raw measurements: [baseline JSON](baselines/2026-11-05-euler416-investigation.json).
