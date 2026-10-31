# Euler 292 investigation

## Delivery

Euler 292 now uses the streaming slice formulation together with the general
compiler improvement described in [disjoint slice operands](euler292-slice-compiler.md).
It retains the bounded descending-perimeter DP, parity/radius/shift pruning,
and uses no `Old` table. RHS parentheses only wrap the statement for readability.

Fresh serial delivery series against `220d12bc`, 3 processes/case:

| Workload | Before | Shipping |
| --- | ---: | ---: |
| Full N=120 compiled | 2.223 s | 0.406 s |
| Reference fixture | 27.764 s in research | 2.240 s |
| Full N=120 reference | not measured | 12.444 s |
| Same streaming source N=60, compiler-only comparison | 1.540 s | 0.180 s |

The shipping fixture retains N=4/30/60 and adds zero/odd/boundary cases. Its
reference comparison therefore includes more checks than the original fixture.
Full answer `3600060866` remains; the full compiled golden additionally requires
two Number regions, 11,616,448 directly read slice cells, zero operand snapshots,
zero ordinary COW copies and no overflow. The private rollback buffer remains.
New full peak RSS medians are 221 MiB compiled and 604 MiB reference.

The scalar alternative remains slightly cheaper, particularly in reference
execution; the pre-delivery paired exploratory runs were 14.57 s streaming vs
11.97 s scalar. The streaming form was selected to preserve array operations
and exercise the general compiler path, at comparable compiled speed. No extra
snapshot tables or Number admission thresholds were introduced.

Validation: TypeScript build, 1104 focused interpreter tests, 20 language tests,
full 289/290/291/292 goldens, four scoped type/differential checks for the two
292 files, and another 68 independent oracle comparisons for shipping source.
After integrating concurrent main commit `28366c99`, the build, 225 focused
checks (including its wide-cell tests), all four golden checks and another 68
oracle comparisons passed. Full integration smoke checks returned the same
answer in both engines: 0.363 s compiled / 15.038 s reference, one sample each;
these do not replace the three-sample medians above.

The main program exclusion is removed; its fixture already belongs to the
audits. Full suites/exhaustive audits were not run. New raw samples and source
hashes are in `baselines/2026-10-31-euler292-delivery.json`.

```sh
python3 benchmarks/euler292-delivery-series.py 3
python3 benchmarks/euler292-verify.py shipping
```

## Earlier research

Subsequent local compiler work is recorded in
[disjoint slice operands](euler292-slice-compiler.md). The measurements below
retain the pre-change algorithm investigation.

Research baseline: `220d12bcb96ade9548db817a9beaafc560932ffb`, macOS arm64,
Node v24.15.0. That research phase left the interpreter, demo, fixture and catalogue unchanged.
Issue #447's next unfinished pair is `292_pythagoreanpolygons.ra` and its fixture.

The [problem](https://projecteuler.net/problem=292) counts convex integer-coordinate
polygons with integer edge lengths, up to translation, at perimeter at most 120.
Its supplied checkpoints are P(4)=1, P(30)=3655 and P(60)=891045. The existing
fixture preserves all three checkpoints and does not repeat the full default.

## Result

The original algorithm is a sensible half-plane edge-set knapsack, but its
innermost loops visit many impossible states. Compiler coverage is already good:
both the original and bounded variants execute two Number regions with no
reported fallback or overflow in the full diagnostic runs. This investigation
found no missing compiler construction blocking those numeric kernels.

| Workload | Current source | Compact bounded prototype |
| --- | ---: | ---: |
| Full N=120, compiled | 2.472 s | 0.368 s |
| Actual N=4/30/60 fixture, reference | 27.764 s | 1.218 s |
| Full N=120, reference | not measured | 10.662 s |
| Actual fixture, compiled | not measured in final series | 0.209 s |

Final values are three fresh-process medians. Full compiled time is 6.7x faster;
the unchanged reference fixture is 22.8x faster. All completed full runs assert
`3600060866`. Do not present the old issue's 266.7-second fixture observation
as the current baseline, or extrapolate a completed original N=120 reference time.

Peak RSS medians: full compiled original 194 MiB versus prototype 206 MiB;
reference fixture 452 -> 375 MiB; full prototype reference 448 MiB. The dense
DP's layout is unchanged: at N=120 it has 893,101 integer cells (about 3.4 MiB
in Int32 storage). The main saving is work and allocation churn, not compressed
DP storage. Whole-process RSS includes imports, compiler and GC state.

## Why the bounds are safe

For each primitive up-vector (p,q) of length r, the knapsack chooses either no
edge or one multiple m of that direction. Perimeter T is traversed downwards,
so every source at T-m*r still belongs to the state before this direction.
Moving m before the coordinate loops therefore preserves the at-most-one-edge
rule; moving m outside the descending T pass would require a source snapshot.

The prototype combines these restrictions:

1. Only m <= min(Half//r, T//r) can contribute. Source coordinates must remain
   in the allocated grid, so intersect the destination X bounds with the
   shifted source bounds and start Y at m*q. This removes the original loop's
   per-cell Ax/Bx/Cx tests and hoists displacement/index arithmetic.
2. Every integer-length edge satisfies r = p+q modulo 2. Thus every state has
   T = sx+sy modulo 2; iterate Y with stride two at the matching parity.
3. A partial edge set of perimeter T and displacement v needs at least |v|
   further perimeter to close. It also satisfies |v| <= T. Hence its radius
   is at most min(T,N-T), giving a disk rather than a full coordinate box.
   Dropping such a partial state is safe before the remaining directions too:
   after adding an edge w of length l, T+l+|v+w| >= T+|v| by the reverse triangle
   inequality. A discarded state cannot become closable within N later.
4. Skip the destination update when the source cell is zero. Use the existing
   `gcd` builtin and short-circuit the direction test instead of manually
   interpreting Euclid for every grid point.

Geometric candidate visits, independently counted without running the DP:

| N | Original innermost visits | Shift-clipped | Also parity | Also radius |
| --- | ---: | ---: | ---: | ---: |
| 60 | 10,922,416 | 5,110,742 | 2,555,394 | 660,832 |
| 120 | 187,300,256 | 88,448,192 | 44,224,148 | 11,616,448 |

The zero check further reduces actual writes; these visit counts do not claim
all source cells are nonzero. No Number admission threshold or arithmetic
semantics was changed.

## Alternatives and compiler findings

* The array-slice prototype snapshots `Old = Dp` once per primitive direction,
  then accumulates row slices from it. It is correct, but the full diagnostic
  run enters 7,416 Number kernels instead of two, with outer mutable-alias
  rejections. Copy-on-write copies 34 tables / 30,365,434 cells. Its full
  compiled median is 0.796 s and 361 MiB, versus 0.368 s / 206 MiB for compact;
  one full reference exploratory run took 20.0 s and 1.4 GiB. Compiler alias
  handling could be improved generally, but this algorithm no longer needs
  those snapshots when T stays outermost and descending.
* A named eager `Value = Dp Src` plus conditional update initially appeared
  slower in one compiled sample. This did not reproduce: the final named
  variant median was 0.358 s, essentially the same range as compact. Both
  compile into two Number regions. Do not infer a compiler defect from the
  early single observation. The chosen compact form also removes the manual
  gcd loop and is shorter.
* `Value' = Dp Src` is not a valid replacement: both engines reject mutation
  of Dp while its live plan reads Dp. This is ordinary capture protection,
  not an interpreter-versus-compiler discrepancy. An eager scalar read or
  inline read needs no extra table snapshot here.
* Factoring the linear displacement further and reordering by target X both
  preserved answers, but their single full compiled/reference probes did not
  improve the balanced result. No extra lookup tables were introduced.

## Verification and measurement scope

The independent oracle directly enumerates 79,107 half-edge sets using the
14 primitive up-directions available at perimeter 40. It does not run a
knapsack, clip coordinates, use circle bounds or skip parity states. It groups
complete half sets by displacement and pairs matching sums with perimeter
within the limit, explicitly rejecting pairs with fewer than three edges.
This independently checks the new knapsack traversal/pruning. It shares the
mathematical half-plane decomposition, rather than being a separate proof of
that original decomposition.

Eleven valid variants, two modes and 34 inputs each passed: **748 comparisons**.
Inputs include 0..30, 35, 39 and 40, covering empty/small bounds, odd perimeters
and additional primitive directions. All variants tested at full scale also
match the original full answer; supplied N=60 checks passed during exploration.
The deferred-plan experiment is intentionally invalid and excluded from this
count. Its errors are retained in the raw JSON.

The final series is serial, alternates case order, includes parse/JIT time,
and excludes Node module-import time. No other tests or benchmarks from this
investigation overlapped it. External host load was uncontrolled, and individual
samples vary: small differences between fast variants are not robust rankings.
The interpreter build fingerprint was unchanged across the full series.
No package suites or exhaustive audits were run for research-only files.

Recommended implementation: use the compact bounded knapsack, preserve the
existing fixture checkpoints, add independent odd/boundary cases and a full
compiled golden, then verify whether the default can return to ordinary audits.
A compiler change is not required for this improvement. General mutable-alias
fusion can be investigated separately with its own workloads and contracts.
No GitHub content was written and no commit or push was performed.

## Reproduction

```sh
./node_modules/.bin/tsc -b packages/language packages/interpreter
python3 benchmarks/euler292-series.py 3
python3 benchmarks/euler292-verify.py
python3 benchmarks/euler292-verify.py factored rowwise
python3 benchmarks/euler292-work.py
DIAGNOSTICS=1 node benchmarks/euler292-investigation.mjs compiled compact 120
PHASES=1 node benchmarks/euler292-investigation.mjs reference compact 120
```

Raw medians, samples, diagnostics, errors, source hashes and oracle results:
`baselines/2026-10-31-euler292-investigation.json`. Frozen variants are under
`experiments/euler292-*.ra`. Full original reference N=120 was not benchmarked;
use a process-level deadline if attempting it.
