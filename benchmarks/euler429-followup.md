# Euler 429: native array modular arithmetic

Default `N=100000000`, modulus `1000000009`, answer **98792821**.
Baseline runtime/source: `eb46c1616a69c5b791e1571023cfeddeb3cd330c`.

The formula is unchanged: each unitary divisor of N! takes each prime power
wholly or not at all, giving the product of `1 + p^(2 v_p(N!))`.
The original array program did much more work than this formula requires:

- Every Legendre iteration traversed all 5761455 primes until the smallest
  prime finished its powers, including millions of already exhausted entries.
- The global binary-exponent loop similarly continued processing every entry
  until the largest exponent finished. Wide intermediate products require exact
  arithmetic; diagnostics show one correct speculative Number-loop replay.
- A handwritten pairwise modular-product loop created slices and intermediate
  vectors instead of using the existing exact modular reduction.

The new source starts every exponent at `N // Primes`. Only the 1229 primes
up to sqrt N need the remaining Legendre terms. Those terms use one small-array
loop. Existing vector `powmod` evaluates each exponent to its own completion;
`reduce * with 1 mod Mod` performs the exact product directly. The program has
one loop, no nested loops or new helper, and all lines fit 40 columns. Empty and
unit factorials now return 1, with explicit fixtures.

No additional compiler change is needed for this workload. The existing stored
integer ternary mapper and native modular-power/reduction kernels already
support these arrays and exact arithmetic. The original speculative overflow is
a valid exact fallback, not a wrong result. The native array solution works in
reference mode too; compilation disabled still permits ordinary native builtins.
No language semantics, compiler thresholds or public operations are changed.

## Measurements

Apple M5 arm64 and Intel Core i7-10750H x86_64, Node v24.15.0. Three fresh-process
pairs per engine, reversing order in the middle pair; full parsing/loading and
diagnostics are included. Other sessions were active on both machines. Whole
process peak RSS is not a precise count of retained array cells.

| Engine / source | Mac seconds | Mac peak MiB | Intel seconds | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| compiled / before | 13.240 | 681.3 | 31.230 | 476.9 |
| compiled / after | 0.675 | 323.9 | 1.504 | 293.4 |
| reference / before | 28.498 | 721.2 | 66.199 | 611.2 |
| reference / after | 0.672 | 324.0 | 1.607 | 291.9 |

The historical issue row's approximately 44 seconds is not the current measured
baseline. Its old exclusion reason also referred to Euler 417's measurements;
those are not Euler 429 measurements. The obsolete full-default exclusion is
removed, preserving the full input in the normal audits without increasing a
timeout. A dedicated test asserts the full answer in both execution modes.

## Verification

- Independent oracle factors the exact small factorial, enumerates every
  unitary divisor, and sums its square. It uses no prime sieve, Legendre sums
  or production modular arithmetic: 33 inputs (0 through 32) in three modes,
  **99 comparisons on each host**.
- Both original fixture tests remain; the added zero/unit test makes three
  fixture tests, all passing in all three modes on each host.
- Full default answers match in every compiled and reference measurement.
- **194 focused Mac tests** cover the demo, array `powmod` and modular folds. Build
  test typecheck, semantic boundaries, application forms and exclusion tests
  pass. No exhaustive types/differential/Nurikabe audit or full `npm test` run.

[Raw samples](baselines/2026-11-06-euler429.json).

After building, from the repository root:

```sh
node benchmarks/experiments/euler429-verify.mjs
node benchmarks/experiments/euler429-pairs.mjs
```

The paired runner retains the original Rank source and validates the full answer
in every fresh process. Run focused tests through `packages/interpreter/scripts/test.mjs`
from the package directory.
