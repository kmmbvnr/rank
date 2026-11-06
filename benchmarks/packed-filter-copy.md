# Packed integer filters and tensor runner lifetime

The compiler previously collected filtered integer copies in a JavaScript
array and packed that array afterward. It now appends to private integer
storage, starting with at most 4,096 cells and growing with the selected
prefix. Int32 values widen to Int64 or arbitrary precision only when needed.
Completion drops unused capacity; sparse and empty filters retain no large
backing buffer. Real and mixed-domain filters keep their existing traversal.
Explicit copies of native numeric selections also use the existing typed
gather implementation, preserving independent cells and binding contracts.

A separate compiler defect retained input buffers in cached Number tensor
variants: the fallback wrapper closed over a `bindRun` activation whose other
closures referenced those buffers. A module-level factory now captures only
the generated exact and Number runners. A subprocess regression test forces
collection after clearing the inputs, then reuses the cached code. An inline
wrapper control fails that test; the factory passes. The test uses `mod` to
exercise this runner rather than the separate bounded-arithmetic path.

## Filter-copy measurements

Node v24.15.0, serial fresh processes, three alternating before/after samples
on each host. The input has 10,000,000 integers; the predicate keeps its first
half. Every run verifies the exact sum `12500002500000`. Times include Rank
parsing and execution after interpreter construction; RSS includes process
startup. The baseline runtime is `aa1e931f`.

| Host | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 342.39 | 155.07 | 512.67 | 257.17 |
| Intel x86_64 | 902.01 | 398.55 | 492.17 | 231.40 |

These are medians. Raw samples and source hashes are in
[the baseline record](baselines/2026-11-07-packed-filter-copy.json).
Reproduce after building with `node benchmarks/packed-filter-copy.mjs`.
Set `RANK_BENCH_RUNTIME` to a baseline interpreter `out/index.js` file URL
for the control. A separate build of only the selected changes reproduced
roughly 258 MiB peak RSS; other Euler 445 experiments are not required.

## Verification and remaining work

The 281 tests in 13 focused files pass on Mac and Intel. The same selection
passes against an isolated build of the staged sources on Mac. Coverage
includes sparse/empty/dense filters, capacity growth, exact values beyond
Int64, copy aliases, repeated and reversed indices, numeric domains, kernel
fallbacks, masks and native tensor completion. TypeScript build/test typecheck,
semantic-boundary and application-form checks are retained. Exhaustive audits
and the full test corpus were not run.

These general runtime changes were found while investigating Euler 445.
That task remains unfinished: its current array-event prototype still needs
a better time/memory tradeoff before replacing the original demo. No Euler
fixture, default input, golden answer or issue completion status changes here.
