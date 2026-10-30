# Euler 287: quadtree encoding

Investigated on `855dff4ec99cc923941aba6126ff538f0fd56902`, Node v24.15.0,
macOS arm64. The next unfinished problem by number in issue #447 is 287.
Only its default program is execution-excluded; the small test fixture is
already included in type and differential audits.

The [problem statement](https://projecteuler.net/problem=287) specifies a
2^N square image and an inclusive circular black-pixel condition, with N=24
as the requested input. The prototype retains that exact pixel geometry.

## Findings

The existing algorithm is a sensible boundary traversal, not a full image
scan. A stack contains square origins and sizes. Nearest and farthest pixel
distances determine whether each square is monochromatic; mixed squares
split into four children. Time grows with the circle boundary, O(2^N), and
the stack uses O(N) cells. However, the default visits 178,934,569 squares.

The whole loop compiles to checked Number arithmetic: one compiled loop,
one Number loop, no overflow, no mixed-integer fallback, no compiler
rejection. There is no materialization or unsupported-helper blocker here.
All squared-distance intermediates at N=24 fit safe integer arithmetic.

Three program-level controls reduce the work:

1. Count mixed squares rather than encoding every leaf. A full four-way tree
   with I internal nodes has 3I+1 leaves, so its bit length is 2+7I.
   A mixed 2x2 square therefore increments I without visiting four pixels.
2. Exchange of x and y preserves the pixel image and dyadic partition.
   Visit only X0 <= Y0; give off-diagonal mixed squares weight two.
   Reflection about the circle center is not used: pixel coordinates on
   the opposite image edges are not symmetric about that center.
3. Reuse the four existing corner-distance squares to compute the nearest
   distance. Only the root straddles the axes through the center; every
   other aligned square lies entirely in a quadrant. The root gets an
   explicit nearest-distance value of zero.

The original investigation used isolated variants under
`experiments/euler287-*.ra`. The delivery below adopts the combined variant
in the production demo; no runtime or compiler implementation is changed.

## Timing

Fresh serial processes, three samples per case, rotated order. Timing
includes parsing and compilation but excludes module imports. Known overlap
with our own checks was discarded and the original sample replaced. Other
host load was uncontrolled. RSS is whole-process peak, not retained memory.

| Mode | N | Variant | Median seconds | Peak RSS MiB, median |
| --- | ---: | --- | ---: | ---: |
| Compiled | 24 | Original | 4.751 | 176.9 |
| Compiled | 24 | Count splits, stop at 2x2 | 2.880 | 175.9 |
| Compiled | 24 | Also use diagonal symmetry | 1.570 | 177.1 |
| Compiled | 24 | Also reuse corner distances | 1.533 | 176.0 |
| Reference | 16 | Original | 3.288 | 176.0 |
| Reference | 16 | All three changes | 1.072 | 176.1 |

The combined prototype is 3.10x faster at the full compiled input and 3.07x
faster on the smaller reference input. Memory is effectively unchanged.
The full answer is `313135496` in every compiled default-scale sample.
Full N=24 reference execution was not attempted; its manual exclusion
cannot be removed based on these measurements.

## Remaining compiler overhead

A direct Number-only JavaScript translation of the original traversal has
a three-sample median of 0.701 s at N=24, versus 4.751 s for compiled Rank.
It uses the same three small Int32 stacks and the same traversal, but does
not implement Rank's error, interrupt, exact-integer or variable-publication
contracts. This is evidence of remaining overhead, not a proven 6.8x safe
compiler optimization.

Generated code checks safe integer results, array coordinates and possible
Int32 widening, and maintains statement locations, scalar publication and
changed-cell metadata. Unsafe attribution controls removed selected checks
in memory for this fixed workload only:

| Control | Single sample, seconds |
| --- | ---: |
| Identity replacement for safe-integer check | 4.006 |
| Remove twelve Int32 widening branches | 4.936 |
| Both changes | 4.406 |

These controls still return the full answer, but they are not safe Rank
backends and were not run through a general regression suite. Removing
widening branches alone did not improve performance. The safe-check sample
does not account for the full native gap. There is no validated general
compiler patch yet; changing Number admission thresholds would not address
this case, which already enters Number mode. A further compiler experiment
should attribute publication/polling/check costs separately and preserve
overflow replay and observable error state before claiming a useful fix.

## Verification and reproduction

- TypeScript build of language and interpreter passed.
- `node benchmarks/euler287-verify.mjs`: 80 comparisons passed for N=1..10,
  four variants, compiled and reference modes. The independent oracle builds
  real pixels and a prefix-sum image, then recursively measures each square
  by black-pixel count; it uses none of the geometric or symmetry shortcuts.
- Scoped existing fixture type and differential checks passed: 2 tests,
  4,237 skipped. The fixture covers N=2,3,8,12.
- Full compiled golden assertions passed for every measured variant.
- No full ordinary suite, exhaustive audit, Intel comparison or full
  reference default was run.

Build with `./node_modules/.bin/tsc -b packages/language packages/interpreter`.
Run `node benchmarks/euler287-investigation.mjs compiled corners 24` or
`node benchmarks/euler287-investigation.mjs reference original 16`.
The native control is `node benchmarks/euler287-native.mjs 24`.
Unsafe research controls use
`GUARDS=safe node --import ./benchmarks/experiments/euler287-guard-loader.mjs benchmarks/euler287-investigation.mjs compiled original 24`;
other GUARDS values are `stores` and `both`.

Raw samples, discarded overlaps, source hashes, diagnostics and oracle
answers are in `baselines/2026-10-31-euler287-investigation.json`.

## Delivery

The production demo now uses all three reductions. Its fixture retains the
existing N=2,3,8,12 assertions and adds N=1,4,5,10. The full-scale compiled
suite now asserts the N=24 answer and requires Number execution without
overflow. The full reference input remains manual; the exclusion text now
points to both the compiled golden and the small cross-mode fixture.

The final source passed 100 independent pixel-oracle comparisons (five
variants in both modes for N=1..10), the focused full-scale compiled test,
and both scoped fixture audits. Final repeated timing samples and source
hashes are recorded in the baseline's `delivery` field. The unsafe guard
controls remain research-only; no integer checks were removed from Rank.

Final delivery medians (three fresh serial samples, same parent runtime):

| Mode | N | Original seconds | Shipping seconds |
| --- | ---: | ---: | ---: |
| Compiled | 24 | 4.802 | 1.538 |
| Reference | 16 | 3.530 | 1.122 |

This confirms approximately 3.1x speedup in both measured workloads. Peak
process RSS remains about 176 MiB for the full compiled input.
