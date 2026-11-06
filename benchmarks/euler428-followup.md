# Euler 428: necklace triplets

Full input: `N=1000000000`; exact answer **747215561862**.
The circle-equation/divisor-counting algorithm remains exact. The original
quotient-table helper repeatedly completed several arrays before five sums.
This was primarily a function compiler gap, with additional repeated small-table
work in the program.

## Compiler

The numeric array-function tier now fuses independent integer sums, sharing
common element expressions and traversing each distinct frame once. It supports
tracked Int32 inputs, ranges, integer gathers, broadcasting, comparisons and
numeric `choose` branches, with scalar/array/tuple integer results. Changing
quotient sizes reuse generated code through dynamic traversal sizes. Both the
prepared-plan cache and code cache retain at most 32 entries.

Revision-checked bounds prove exact element arithmetic. Reduction prefixes and
final scalar operations retain safe-integer guards. Failed guards replay the
ordinary function without publishing speculative results. Custom readers,
missing cells, wide integers, shared buffers, native overrides, dependent sums,
unused ordinary assignments and unsupported deferred bindings retain ordinary
execution. Boolean gather masks retain filtering semantics; a regression test
checks that a constant source cannot turn a ten-element selection into a
20-element integer gather through closed-form reduction.

Real array functions retain their result kinds. The real-only composed call-loop
ABI rejects integer buffers. Cancellation, inspection and demand-budget paths
remain ordinary; no new execution-mode transition is introduced.

## Rank program

Small convolution counts are now prefixed once from prime-factor coefficients
using existing `factors`, `unique .counts`, ranked application and `scan`.
Only the large quotient half calls `statistics`, halving repeated calls from
63244 to 31622. The prime-power Mobius sieve and large-table helper each have one
loop. The main powers-of-two/three enumeration is an array grid with one loop;
there are no nested Rank loops. Functions use short meaningful names and all
production/fixture lines fit 40 columns.

An early small-divisor-sieve prototype was rejected for reference memory:
against the initial baseline its full reference run improved 21.536 to 11.341 s
but peak RSS rose from 1039.7 to 1457.0 MiB. The retained library-factor variant
avoids that table. These scouts used an earlier runtime; they are not samples in
the controlled comparison below.

## Controlled measurements

Node v24.15.0 on Apple M5 arm64 and Intel Core i7-10750H x86_64. Three
fresh-process samples
per variant, reversing variant order on the middle repetition. Baseline is
`a6ae09c53d980547324b4d24765f11e74bf27ec7`; compiler/source variants isolate the two
changes. Other sessions were active on both hosts; repeated paired comparisons
reduce, but do not eliminate, host-load noise. Time includes parsing, module
loading, execution and diagnostics. RSS is whole-process peak, not live DP size.

| Variant | Mac seconds | Mac peak MiB | Intel seconds | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original source/runtime | 14.283 | 1181.9 | 54.269 | 612.3 |
| Compiler only | 3.469 | 540.8 | 12.006 | 486.0 |
| Rank program only | 8.647 | 1163.5 | 31.302 | 589.1 |
| Both changes | 2.749 | 572.6 | 10.265 | 538.5 |

Combined compiled speedup: **5.20x on Mac / 5.29x on Intel**.

| Reference | Mac seconds | Mac peak MiB | Intel seconds | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| before | 15.615 | 1446.7 | 58.005 | 516.7 |
| after | 10.078 | 1449.5 | 37.214 | 525.9 |

Reference memory is effectively unchanged on Mac (+0.2%) and increases slightly
on Intel (+1.8%, approximately 9 MiB); the strong memory reduction is in compiled
execution. Separate integration checks after merging
`76d64b62` preserve the full answer: 2.753 s compiled / 10.041 s reference on Mac.
The corresponding Intel controls take 9.929 / 36.547 s. These are controls, not
additional primary samples.

The existing FFT-stage control (1000 warmup calls, 20000 measured calls, three
pairs) takes 298.5 / 301.2 ms before / after on Mac: no robust change is claimed.
Intel FFT medians are 1089 / 1037 ms, with no observed regression.
An affine range-sum control (20 warmed calls) takes 69.5 / 0.14 ms on Mac and
174.1 / 0.32 ms on Intel; its sum
remains a closed form instead of introducing
an unnecessary traversal. Controls import storage from the same runtime as the
interpreter, preserving tracked-array ownership.

## Verification and execution lane

- Independent oracle enumerates factor pairs of `12 b^2`, `2 b^2` and `4 b^2`.
  The last equation requires **both** factors to equal `-b mod 3`. It does not use
  Mobius inversion or the production prefix/quotient decomposition.
- 43 inputs, including zero and square boundaries, are checked against this
  oracle with normal compilation, Number loops/array functions disabled, and
  compilation disabled: **129 comparisons**. This does not claim every internal
  numeric primitive is disabled in the middle configuration.
- Existing fixture checks 1, 20, 300 and 3000 remain; zero/24/25 checks are added.
  All four fixture tests pass in all three configurations.
- A dedicated test retains the full golden answer and verifies the general
  array-function tier handles the large statistics table without loop overflow.
- Build/test typecheck, semantic-boundary and application-form checks pass.
  The integrated Mac selection passes **280 focused tests in ten files**; the
  Intel selection passes **263 tests in nine files**.
  Exhaustive types, differential corpus, Nurikabe and full `npm test` were not run.
- Full reference and compiled answers pass on both hosts. The old full-main
  exclusion, justified by roughly 22 seconds compiled, is removed; its ordinary
  fixture and new full compiled assertion remain. No timeout is increased.

Raw samples and checks are in
[the baseline artifact](baselines/2026-11-06-euler428.json).

After building, reproduce the oracle/fixture checks with:

```sh
node benchmarks/experiments/euler428-verify.mjs
```

For four-way full-size comparisons, build the baseline in a separate checkout,
then set its interpreter URL (including its matching language dependencies):

```sh
export RANK428_BASE_RUNTIME=file:///path/to/baseline/packages/interpreter/out/index.js
node benchmarks/experiments/euler428-pairs.mjs
node benchmarks/experiments/euler428-pairs.mjs reference
```

Run focused tests through `packages/interpreter/scripts/test.mjs` from that
package directory. `euler428-run.mjs reference` also supports a standalone full
reference check. The original Rank source is retained alongside the runner.
