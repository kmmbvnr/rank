# Euler 388: array sieve and quotient tables

Delivered against integrated main `16e1375e`, Node v24.15.0, Apple M5 arm64
and Intel Core i7-10750H x86_64 (`root@jack.lan`). The array-oriented Rank
program remains exact, with unchanged default N=10^10 and Cut=4641589.
The obsolete default-input corpus exclusion is removed.

The full answer is `831907372771451255456805129931`, formatted as
`831907372805129931`. The [problem statement](https://projecteuler.net/problem=388)
requires the first and last nine digits and supplies the N=10^6 checkpoint.

## Measurements

Three sequential fresh processes per case on each host, interleaving cases.
Medians include parsing, analysis, compilation and execution; imports and
interpreter construction are excluded. RSS is total process peak, not retained
buffers. No other investigation tests or benchmarks ran on the same host in
these timing series. General machine load was not controlled.

| Full compiled case | Mac s | Intel s | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original demo | 1.883 | 5.571 | 452 | 421 |
| New demo, original compiler admission | 1.061 | 2.829 | 452 | 435 |
| New demo and compiler repair | **0.565** | **1.230** | **277** | **265** |

Combined speedup is 3.3x on Mac and 4.5x on Intel. Compiled peak RSS falls
by about 39% and 37%. The compiler repair alone improves the new array demo
by 1.9x and 2.3x; changing only the demo does not give the final memory saving.

The compiler control loads only the original built `vector-entry-work` module
from the matching integrated base; other runtime modules and the new Rank
source are identical. This isolates the cost-admission change.

Full Mac reference: median **16.601 s / 605 MiB**, three fresh processes.
No full original-reference median was obtained: its unbounded research run
was stopped, and a scan-only variant still exceeded a 90-second deadline.
No reference speedup ratio or reference memory saving is claimed.

A full compiled run with Cut=1 returns the same answer in 1.881 s / 179 MiB
(single control). Normalizing the small cutoff trades time for smaller tables;
the default still selects the faster larger sieve.

Final raw records: `baselines/2026-11-04-euler388-delivery.json`.
Earlier research: `baselines/2026-11-04-euler388-investigation.json`.
The historical research hook measurements are not the final delivery numbers.

## Rank program

The mathematics remains Mobius inversion grouped by equal floor quotients.
No lattice-point enumeration or hard-coded answer table is introduced.

- Retain strided sieve writes and materialize the small prime vector once.
- Use the library `scan +` for the Mertens prefix values.
- Fill large Mertens quotient slots in dependency order, replacing millions of
  recursive helper invocations and index-cache lookups with array reads.
- Carry the previous Mertens boundary into the next sum group.
- Keep the final wide integer accumulator exact. Its first Number attempt
  overflows once and safely replays with the existing mixed exact backend.

At the default cutoff, the large cache contains 2154 useful entries. Its
recurrence visits 18,269,186 quotient groups; the final sum has 199,999 groups.
This repeated helper/reader dispatch was the main reference cost.

The effective sieve bound is `max(1, min(N, max(Cut, floor(sqrt(N)))))`.
Both the sieve and quotient cache therefore stay bounded for a custom tiny Cut;
the cache has at most floor(sqrt(N))+1 cells. A huge cutoff is also clamped to N.
N=0 retains a one-cell sentinel beyond index zero and returns zero. The default
bound is unchanged. At N=10^6, Cut=1, the two arrays have 1001 and 1000 cells.

## General compiler repair

Packed-vector entry-work admission already counted complete nested `for`
passes but ignored strided slice stores. It inspected only the first and last
vector cells. In a prime sieve, the first pass alone is insufficient to pay
for a destination snapshot, while the final prime has almost no work.

The proof now counts selected cells in already-lowered native range stores
with guarded known bounds, and inspects at most the first two and last trusted
vector cells. Short vectors are deduplicated. A possible break/return restricts
inspection to the first entry. Unknown bounds, calls, shared source/destination
storage and incomplete paths retain existing conservative admission.

For Euler 388, the first two prime passes, including square multiples, prove
more than enough work for one private snapshot. No workload name or prime
property is embedded in the compiler. Both existing copy thresholds (64 and
262144 cells), Number safety guards, polling policy, publication and exact
replay are unchanged. Small cutoffs below the cap retain the existing bounded
probe rather than bypassing that policy.

Reading captured integer arrays from raw Number helpers remains a separate
opportunity. It was not necessary to introduce that larger feature here: the
final program exposes table reads to the existing loop compiler.

## Verification

- **295 focused tests on Mac**, across 13 files; **129 on Intel**, across seven
  files (the final additional zero-step regression reran its file separately).
- Two full Euler 388 goldens pass on each host, using default Cut and Cut=1.
- Four scoped type/differential audits pass for the restored full main and
  expanded fixture. Existing statement assertions are retained.
- Independent research verifier: **588 program comparisons** across seven
  saved/delivered variants, both engines, selected N=0..1000 and cutoff choices.
  Expected values use trial-factorization Mobius sums, cross-checked by exhaustive
  three-coordinate gcd enumeration for N<=15.
- New production tests cover quotient/cutoff boundaries, empty input, zero and
  oversized cutoffs, the N=10^6 checkpoint and bounded table sizes in both engines.
- Nineteen compiler regressions cover forward/reversed traversal, descending
  stepped slices, short/insufficient sampled vectors, unknown/mutated bounds,
  early exits, exact overflow replay, later bounds/zero-step errors, visible
  budget boundaries, custom interrupt readers, cancellation and finally.
  Existing alias, helper-call, nested-pass and snapshot tests also pass.
- Euler 379's independent divisor oracle and full two-sieve compilation golden
  pass on both hosts.
- TypeScript test build, 65-owner semantic boundaries, application forms and
  whitespace checks pass. No full suite or exhaustive corpus audit was run.

Handwritten JS with the same linear-sieve/quotient-table arithmetic was a
research control: 0.198 s Mac and 0.523 s Intel, one sample each. It excludes
Rank parse/analysis/guard costs and uses explicit typed buffers. It does not
establish a promised further speedup. The selected array form is as fast as
the linear-sieve Rank prototype compiled and faster in the full reference
control (about 16 vs 40 seconds).

## Reproduce

Build `tsconfig.build.json`, then run fresh processes:

```
node benchmarks/euler388-investigation.mjs
node benchmarks/euler388-investigation.mjs demos/euler/388_lines.ra 10000000000 1
node benchmarks/euler388-investigation.mjs demos/euler/388_lines.ra 10000000000 4641589 reference
node benchmarks/experiments/euler388-verify.mjs
```

For the isolated compiler control, build a clean matching `16e1375e` checkout
and set BEFORE_VECTOR_WORK to its absolute built
`packages/interpreter/out/jit/vector-entry-work.js` path:

```
BEFORE_VECTOR_WORK=/path/to/baseline/vector-entry-work.js node --import ./benchmarks/experiments/euler388-before-loader.mjs benchmarks/euler388-investigation.mjs
```

The historical `copy-probe` and `slice-work-probe` loaders are research artifacts
for the unmodified pre-repair runtime; do not use them on the delivered compiler.
`DIAG=1` or `PROFILE=/tmp/388.cpuprofile` enables separate instrumented runs.

For targeted tests, from `packages/interpreter`:

```
node ../../node_modules/vitest/vitest.mjs run --config ./scripts/type-audit.config.mjs --maxWorkers 1 test/vector-entry-work.test.ts test/vector-slice-work.test.ts test/euler-388.test.ts
node ../../node_modules/vitest/vitest.mjs run --config ./scripts/type-audit.config.mjs --maxWorkers 1 test/full-scale-demos.test.ts -t 'full Euler 388'
node ../../node_modules/vitest/vitest.mjs run --config ./scripts/type-audit.config.mjs --maxWorkers 1 test/types.test.ts test/differential.test.ts -t 'euler/388_lines'
```
