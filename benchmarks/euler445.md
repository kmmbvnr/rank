# Euler 445: retractions

The full input still returns **659104042**. The selected implementation keeps
an SPF factor walk, uses array operations to construct modular factor tables,
and has no nested Rank loops. A signed remainder distinguishes numerator and
denominator factors. Repeated equal primes are grouped before updating the
unitary-divisor product. The sum of the binomial coefficients is subtracted
once as `2^N - 2`, rather than maintained by another recurrence and inverse table.

Only primes up to `sqrt(N)` need exponent counters. Large primes have exponent
at most one and use a separate inverse table. A function constructs the SPF
table privately; its prime copy and writes now compile as one Number region.
The large SPF and inverse tables are read without speculative copies. The
existing rollback snapshot covers only the small exponent counters.

The previous source is available as `ddae8f36:demos/euler/445_retractionsa.ra`.
Both variants below use the same runtime, `ddae8f36`, so this comparison isolates
the demo change. Three alternating pairs use fresh Node v24.15.0 processes per
host and workload. Timings include parsing and execution; memory is process
peak RSS. Intel samples include `vmstat` readings: about one core was busy,
with roughly 90% aggregate CPU idle and no active swap traffic.

| Host / workload | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, compiled, N=10,000,000 | 1427.71 | 865.25 | 569.42 | 272.88 |
| Intel, compiled, N=10,000,000 | 4035.25 | 2553.34 | 465.37 | 261.13 |
| Mac, reference, N=100,000 | 1229.81 | 1372.62 | 189.59 | 184.84 |
| Intel, reference, N=100,000 | 3556.88 | 3647.94 | 177.50 | 169.83 |

The compiled program is 1.58–1.65 times faster, with 44–52% lower peak RSS.
**Reference execution is not faster:** these bounded measurements regress by
about 12% on Mac and 3% on Intel. One full Mac reference validation takes
117.58 s / 271.30 MiB and returns the full answer; it is a correctness and
memory observation, not a controlled reference speedup claim.

Array-event alternatives run the reference workload much faster, but build
large event streams, peak around 800–1400 MiB on Mac, and lose compiled speed.
Chunking reduces memory but increases repeated setup. They were not selected.
The remaining reference bottleneck is the scalar factor walk; this delivery
does not claim to close the interpreter/compiled performance gap.

Investigation also delivered general improvements independently, with scoped
correctness, cancellation, budget, aliasing and cross-architecture checks:

- `7963a7e5`: bounded argument previews and single-pass sequence `last`.
- `f3b46c20`: packed filtered completion and tensor input lifetime fixes.
- `66ec8383`: native reference array updates and packed range concat;
  see [measurements](native-reference-arrays.md).
- `62998718`: dense modular keyed folds;
  see [measurements](packed-modular-keyed.md).
- `52683ca7`: packed column concat and narrow broadcasts;
  see [measurements](packed-column-arrays.md).
- `ddae8f36`: bounded prime copies in function/loop regions;
  see [measurements](compiled-prime-copy.md).
- `363afd97`: corrected stale bitwise compilation-counter expectations;
  mathematical and alias checks remain intact.

Final verification: 318 focused tests pass on both hosts, including the new
Euler oracle and the affected compiler suites. The Rank fixture's four tests
pass on both hosts. An additional independent BigInt binomial/trial-division
oracle checks 48 inputs across Number compilation, exact compilation and the
interpreter (144 comparisons), including zero, one, odd/even and power-of-two
boundaries. Full compiled answers pass all twelve controlled samples; the
full Mac interpreter answer also passes. A dedicated test preserves the full
compiled golden answer; the expensive full reference workload remains in the
manual lane, while the bounded Rank fixture stays in the audits. Exhaustive
audits were not run.

Raw observations: [24 controlled samples and full reference run](baselines/2026-11-07-euler445-final.json).

Reproduce from repository root, one process at a time:

```sh
git show ddae8f36:demos/euler/445_retractionsa.ra > /tmp/euler445-before.ra
node benchmarks/euler445.mjs compiled 10000000 /tmp/euler445-before.ra
node benchmarks/euler445.mjs compiled 10000000
node benchmarks/euler445.mjs reference 100000 /tmp/euler445-before.ra
node benchmarks/euler445.mjs reference 100000
```
