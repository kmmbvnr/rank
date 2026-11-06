# Euler 423: private inverse table and packed prime completion

2026-11-06, base 8776a98e. The linear recurrence remains O(L). Both loops
compile; the program no longer needs wide accumulation or an inverse-table
snapshot. Default answer: **653972374** at L=50,000,000.

## Changes

- Build modular inverses in a function that owns its fresh table. Existing
  compilation can fill that table without the original 200,000,008-byte
  rollback snapshot and 50,000,002-byte dirty bitmap. Alias/rollback rules for
  arbitrary captured arrays remain intact.
- Accumulate Total modulo Q explicitly. The old exact total exceeds Number's
  safe range; silently changing it would violate observable binding semantics.
  This source change avoids the original speculative overflow and replay.
- Cancel the inverse/factor work undone by prime steps, keeping the two row
  updates separate. Guard the prime-array read through scalar short circuit.
- Use the existing `primesieve` packed completion in the demo; also support
  ordinary finite `primes ... array` through the native completion registry.
- Return zero for the empty sum at L=0 and add boundary fixtures.

The runtime change is general: bounded constructor-owned prime plans can fill
Int32 chunks and a final buffer without retaining every yielded prime as an
object. The iterator still polls cancellation. Inspection, demand budgets and
observable host polling use ordinary iteration, as do small slices, unbounded
plans and bounds beyond Int32. The registry checks iterator/size identity.
Unused deferred plans stay unevaluated. No parser syntax or JIT specialization
for this demo was added.

## Final comparison

Node 24.15.0, fresh process per sample, three alternating samples per variant on
Mac and Intel, diagnostics enabled. Peak RSS is not retained heap. Machines
were under uncontrolled load; do not compare absolute times to another batch.
Both hosts and both runtimes used the same language operation registry checksum
(recorded in the raw samples).

| Variant | Mac median | Mac peak MiB range | Intel median | Intel peak MiB range |
| --- | ---: | ---: | ---: | ---: |
| Original source/runtime | 8.579 s | 754–861 | 7.902 s | 809–810 |
| Delivered demo/runtime | 4.872 s | 352–384 | 5.179 s | 354–355 |
| Delivered recurrence with ordinary `primes` | 4.824 s | 379–389 | 5.421 s | 377–380 |

Median peak RSS falls from 859 to 382 MiB on Mac and 810 to 355 MiB on Intel.
All eighteen full executions returned the known answer. The original source
and benchmark runner are retained under `experiments/euler423-*`.
`euler423-delivery-pairs.mjs` requires `RANK423_BASE_RUNTIME` to point to a
separately built baseline interpreter URL; build its language dependency too.

An earlier research batch gave 3.539 → 2.140 s on Mac and 6.567 → 4.398 s on
Intel for the equivalent source strategy. Those observations are from a
separate, less loaded batch and are not substituted for the final measurements.
A separate wide-RHS JIT experiment was rejected: despite promising Mac scouts,
Intel before/after pairs regressed 6.288 → 6.967 s. That patch is not included.

## Verification and remaining cost

The new tests compare the recurrence with independent exact adjacent-face DP
at sixteen limits including zero, using Number compilation, exact compilation
and the interpreter. A full fifty-million golden test also passes. Diagnostics
require two Number loops, no overflow, packed prime completion and no copied
bytes. Sequence tests cover chunk joins and exact bounds, overridden iterators,
changed size evidence, unused deferred plans, budgets, inspection, observable
polling, cancellation during construction and retry.

Targeted Mac verification: 80 tests across six files (79 before adding the
unused-plan case, followed by all nine prime-completion cases). All 80 tests
also passed together on Intel. TypeScript
source and test builds pass. Full reference execution and exhaustive corpus
audits were not run. Full reference execution remains outside the corpus
budget, so the exclusion now points to the dedicated compiled golden and the
small cross-mode fixture rather than stale timings. The earlier single
L=1,000,000 reference probes showed only a modest source improvement; this does
not solve the interpreter's general per-iteration overhead.

Raw final samples: `baselines/2026-11-06-euler423-followup.json`.
