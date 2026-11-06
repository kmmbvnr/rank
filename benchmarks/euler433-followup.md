# Euler 433: current search and a scalar-compiler gap

Default N=5000000; full answer **326624372659664**.
Measurement baseline: `31347309a0c2eeb8f67aa7c84ac790a955d2fc4e`.
Delivery also integrates `3acde14d` from main and verifies its tensor changes.

## Decision

The production main remains byte-for-byte unchanged. Its Mobius inversion,
quotient blocks and paired floor sums already compile into two Number loops
without overflow replay. Current compiled execution is much faster than the
historical approximately 22-second observation in issue #447. The remaining
large gap is in reference execution of the scalar arithmetic loops.

Several source variants were compared. A staged small-prime-power sieve used
array operations and private buffers; a native positive Int32 divisor stripped
prime factors in place. It reduced compiled RSS, but reference controls became
slower. A simpler all-prime sieve also produced an unacceptable Mac reference
peak. Those variants are retained as experiments rather than replacing the
production program. Existing nested search loops are unchanged.

The delivered change closes a general compiler gap found when extracting the
arithmetic into ordinary functions. Number scalar-function kernels now share
the bounded integer quotient already used by Number loops. For safe integer
operands and `abs(a) < 2^52`, `floor(a / b)` cannot round across an integer
boundary. Zero divisors are checked first and integer zero is normalized.
Wider numerators retain checked remainder-based floor division and ordinary
replay. Real arithmetic, modulo, binding guards, call depth, ownership,
cancellation and demand budgets are unchanged.

This generates one guarded kernel. The rejected experiment that added a separate
unpolled function body is not included. No public operation, language syntax,
copy-cost threshold or compiler-size limit changes.

## Controlled measurements

Apple M5 arm64 and Intel Core i7-10750H x86_64, Node v24.15.0. Three fresh
processes per variant, reversing order in the middle repetition. Timing includes
Rank file read, parsing, execution and diagnostics, after JS imports and
interpreter construction. RSS is whole-process peak. Other sessions were active;
small differences are not claimed as speedups.

| Unchanged production main | Mac s / MiB | Intel s / MiB |
| --- | ---: | ---: |
| Baseline | 1.747 / 375.9 | 6.022 / 396.7 |
| Delivered runtime | 1.754 / 376.1 | 6.056 / 393.2 |

The production main has no material speed or memory change from this compiler
patch. It already uses the faster Number-loop division path.

The committed helper probe performs the full calculation with the floor-sum
walk in a Number function. It returns the same golden answer. Its three-trial
medians isolate the scalar-function compiler change:

| Function probe | Mac s / MiB | Intel s / MiB |
| --- | ---: | ---: |
| Baseline runtime | 4.640 / 273.9 | 8.845 / 279.5 |
| Delivered runtime | 1.563 / 301.3 | 5.834 / 294.8 |

The compiler improvement is **2.97x on Mac / 1.52x on Intel** in this probe.
Its process peak RSS is about **10% / 5.5% higher**. That measured tradeoff is
not described as a memory saving or as retained live-data growth; no allocation
or post-GC live-heap diagnosis is claimed. The probe is not the production main.

## Rejected source tradeoffs and reference scope

| Full reference control | Mac s / MiB | Intel s / MiB |
| --- | ---: | ---: |
| Original main | 198.173 / 489.3 | 545.612 / 482.5 |
| Staged sieve candidate | 204.342 / 455.6 | 616.339 / 490.4 |

These expensive full-reference runs are single observations, not medians. A
shorter three-trial, interleaved reference control at N=100000 also favored the
original: **2.494 vs 2.659 s on Mac**, **6.978 vs 7.581 s on Intel**. The staged
candidate saved compiled RSS (364.4 / 359.3 MiB) but did not satisfy the overall
speed/memory tradeoff. The all-prime candidate raised Mac full-reference RSS to
605.8 MiB and was also rejected.

The original source's full reference controls are baseline measurements. The
compiler patch is disabled by `compilation: false`; no new full-reference
speedup is claimed. The full-main audit exclusion remains a reference-budget
limit on Intel, with its obsolete compiled-time explanation refreshed. The
small fixture remains in the audits; no deadline or golden assertion is reduced.

## Verification

- **457 tests / 18 files pass on each host**, including integer boundaries,
  signs, unsafe/wide arithmetic, zero division, scalar plans, real/private arrays,
  iterators, membership and the integrated tensor-modular/Euler 743 controls.
- **186 direct-Euclid square comparisons per host**, across ordinary compiled,
  disabled Number-loop compilation and disabled compilation modes; all three
  fixture tests also pass in each mode. N=0, small squares and existing fixture
  checkpoints are retained.
- **603 independent direct lattice-strip comparisons per host** validate the
  preserved function probe in the same three modes.
- Full compiled default/golden controls pass after main integration. TypeScript
  source/test build, 65-owner semantic boundaries, source checks and exclusion
  checks pass. Intel executes the locally built architecture-neutral JS and
  transpiles the same sources for its ordinary tests.
- One real-array test already failed on the clean baseline: returning a wide
  integer also replays its Number bridge (three Number entries / two fallbacks),
  while the real-result case has one entry / one fallback. Exact values agree
  before and after. The precise counter expectations are repaired; assertions
  are not weakened.

No exhaustive type, differential or Nurikabe audit, or full `npm test`, was run.
Raw measurements are in `baselines/2026-11-06-euler433.json`. Its historical
matrix labels `source-only` and `after` refer to the rejected staged source;
`runtime-only` is the delivered production variant. Source hashes disambiguate
the recorded paths. Runners and both probes are under `experiments/euler433-*`.
