# Euler 347: prime-pair maxima

Investigated on 2026-11-02 at `90a3e4f9`. Issue #447 still lists the main
and full-default fixture as unfinished. Euler 343 also remains unfinished,
but has an existing investigation; 347 is the next new investigation after
completed 346. The initial investigation made no production or GitHub changes. The delivery below implements its selected algorithm.

## Findings

The original algorithm enumerates 1,903,878 distinct prime pairs p < q
with p*q <= 10^7. It searches powers of each prime for every pair.
The hot outer loop and all its nested loops already compile in Number mode,
with no overflow or replay. The full answer is 11109800204052.

Only 354,436 pairs can have an exponent greater than one. For the remaining
1,549,442 pairs, p*p*q exceeds the limit; because q > p, every higher power
of either prime also exceeds it. Their maximum is exactly p*q.

The `slice` experiment sums those simple pairs as an array reduction for
each p, and keeps the original exact power search for the remaining pairs.
It uses the existing `upperindex` operation to find the boundaries. This
cuts reference execution by about threefold on both hosts. It also narrows
the prime list from primes below Limit to primes through Limit // 2,
since the smallest possible partner is 2. This reduces the list from
664,579 to 348,513 entries at the default input.

## Controlled full-input measurements

Three serial fresh-process trials per variant/mode, Node 24.15.0.
Mac: arm64; remote Intel: x86_64, reached through SSH port 22022.
Times include parsing, preparation and execution, and exclude runtime module
import and process startup. RSS is whole-process peak. Every full run checks
the golden answer. Medians follow. Background load was not controlled.
The final Mac series had no overlapping benchmark or verification process
started by this investigation. Intel likewise ran one series at a time.

| Variant | Mac compiled s | Mac reference s | Intel compiled s | Intel reference s |
| --- | ---: | ---: | ---: | ---: |
| Original | 0.264 | 4.633 | 0.599 | 13.810 |
| Half-sized prime range | 0.212 | 4.696 | 0.492 | 12.578 |
| Half range + simple-pair slice sum | 0.215 | 1.500 | 0.555 | 4.161 |

| Variant | Mac compiled MiB | Mac reference MiB | Intel compiled MiB | Intel reference MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 234.3 | 257.8 | 215.1 | 245.8 |
| Half range | 192.1 | 191.8 | 184.9 | 182.3 |
| Slice sum | 196.7 | 192.0 | 184.4 | 182.0 |

The slice variant balances both modes: compared with the original, compiled
execution is about 19% faster on Mac and 7.5% faster on Intel. The simpler
half-range change is faster than slice on Intel with compilation enabled,
but retains most of the reference cost.

Other exploratory variants are preserved for comparison:

- `stair`: reduce q powers monotonically as p powers increase. It gives the
  correct answer, but does not remove the per-pair reference dispatch.
- `fast`: skip the power search for simple pairs, but still visit each pair
  through interpreter statements. An exploratory Mac reference run took 2.62 s.
- `prefix`: build cumulative prime sums instead of reducing slices. An
  exploratory Mac compiled/reference pair took 0.252/1.651 s, versus
  0.245/1.732 s for slice in that exploratory pair. These are single samples;
  the controlled series above is the basis for the recommendation.
- `batch`: precompute binary-search boundaries as arrays, restoring Number
  compilation of the remaining loop. Preparing the arrays and prefix sums
  costs time and memory. `batch2` avoids scanning the full prime array to
  select small primes. Neither showed a clear whole-program advantage.

## Compiler and storage follow-up

The original is not blocked by a compiler rejection in its hot loop. The
whole helper itself reports an unbound `primes` name for scalar compilation,
but its integer outer loop still compiles, including nested loops. Removing
that rejection alone would not remove the reference cost.

The slice/prefix outer loops compile through the exact BigInt backend.
A native `upperindex` call is not marked Number-safe, so the speculative
Number backend rejects the enclosing region. Precomputing bounds outside
that region (`batch`) restores Number execution. Supporting this operation
in Number regions would be a general compiler improvement, but the measured
array preparation tradeoff does not establish its whole-program benefit.
The slice reduction is another native operation in that region.

A separate storage opportunity is measurable: `ownedArray` packs homogeneous
integer arrays into BigInt64 cells, including these small primes. The
Number backend then prepares a Float64 read buffer for every prime. The
original diagnostic counted 664,579 converted cells. Existing Int32 arrays
can already be borrowed directly by this backend.

An isolated emitted-JavaScript prototype changes `packedIntegers` to choose
Int32 when every cell fits. It preserves the original Int64/boxed fallback
and eliminates the Number read-buffer copy in the half-range experiment.
Its patch and raw measurements are preserved. This is a storage prototype;
no runtime source change has been made. It needs wider workload measurement
and semantic tests for widening writes, snapshots, aliases, missing values,
large integers, empty arrays and cancellation before shipping. The prototype
adds an unsuccessful allocation/scan for arrays that do not fit Int32.
Small timing differences from separate short series are provisional.

| Variant with Int32 probe | Mac compiled s | Mac reference s | Intel compiled s | Intel reference s |
| --- | ---: | ---: | ---: | ---: |
| Half range | 0.201 | 4.500 | 0.498 | 12.691 |
| Slice sum | 0.206 | 1.497 | 0.523 | 4.317 |

Whole-process peak RSS medians for half-range compiled/reference are
188.4/190.7 MiB on Mac and 177.5/179.9 MiB on Intel. For slice they are
191.8/195.2 MiB and 177.4/180.2 MiB. The Int32 probe modestly reduces
compiled-path memory, but does not establish a universal speedup: Intel
reference slice was slower in this series. Preserve this tradeoff when
choosing whether to promote it.

## Verification and reproduction

`euler347-verify.mjs` uses an independent oracle: factor every integer up to
20,000, keep the largest integer for each family with exactly two distinct
prime divisors, and maintain the sum of those maxima. It checks all limits
0..256, explicit prime-power boundaries, and 64 deterministic random limits.
All eight variants pass 5,456 comparisons on each host in both execution
modes. The same checks pass on both hosts with the isolated Int32 prototype
(21,824 comparisons across hosts and runtimes in total). Full default answers
are asserted in every measured process. No full suite or exhaustive audit
was run for this research-only change.

```sh
RANK347_RUNTIME=/absolute/path/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler347-series.mjs
RANK347_RUNTIME=/absolute/path/packages/interpreter/out/index.js \
  node benchmarks/euler347-verify.mjs
```

Raw samples and diagnostics are in
`benchmarks/baselines/2026-11-02-euler347-investigation.json`.

Recommended next implementation: retain the slice-sum algorithm and smaller
prime range, add boundary/full regression coverage, then consider Int32
packing as a separate general runtime change after broader measurements.

## Delivery verification

The production demo now uses the slice variant, with short bound names and
without the redundant p*q guard inside the already bounded search. All
production Rank lines are at most 40 characters. Default arguments and the
full golden assertion remain unchanged. Both full workloads are removed
from the demo execution exclusions.

The shipped source passes 6,138 standalone oracle comparisons on each host
in both engines (nine variants including delivered), in addition to the
four focused interpreter tests. Those tests check every limit 0..1000
against independent factorization and the full default in both engines.
The two CLI small-input groups, full-default fixture, seven audit
infrastructure tests, Langium generation and TypeScript build also pass.
No full suite or exhaustive audit was run. Compiler/runtime source is
unchanged; the Int32 packing patch remains a research prototype.

Three serial full-target controls of the delivered source on each host:

| Host | Compiled s | Reference s | Compiled MiB | Reference MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac | 0.181 | 1.231 | 197.2 | 194.5 |
| Intel | 0.458 | 3.398 | 183.8 | 182.0 |

Every control asserts the full answer 11109800204052. These later controls
were separate from the original alternating variant comparison; external
load was not controlled. Raw samples are included under `delivery`.
