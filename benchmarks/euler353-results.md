# Euler 353: exact geometric search

Apple M5, Node v24.15.0. Baseline investigation started at `c3bcdfff`.
Times include parsing and execution after importing the interpreter. Each sample
uses a fresh process; medians below use three samples. Raw timings are in
`baselines/2026-10-23-euler353.jsonl`.

| Change | First nine radii, through 511 | Relative to baseline |
| --- | ---: | ---: |
| Original program and interpreter | 5.719 s | 1.00x |
| Direct `isqrt` and `acos` lowering, original program | 4.648 s | 1.23x |
| Also permit mixed integer/real/boolean Number regions, original program | 0.809 s | 7.07x |
| Also reduce points and prune bidirectional search | 0.207 s | 27.61x |

The final program computes all fifteen radii through 32767 in **21.796 s**
(median; 21.277–22.191 s), with about 202 MiB RSS at completion. The result is
`1.2759860331`. A separate instrumented run checks every individual radius
against the independent oracle to absolute error below `1e-14`; it took 20.894 s.
No full-input speedup ratio is claimed: the original full workload did not finish
in the bounded investigation. The reduced unidirectional intermediate took
28.859 s in one sample; this is not a repeated statistical comparison.

## Interpreter changes

`isqrt` and `acos` lower inside numeric loops with their ordinary domain checks
and entry-time builtin identity guards. Number `isqrt` corrects a floating seed
with integer comparisons. The exact backend still uses the existing BigInt root.

Private Number regions now accept real/boolean scalar bindings and rank-one
arrays alongside integer values. Each kind has entry guards and typed publication;
integer intermediates still check safe-integer exactness and replay from untouched
inputs on overflow. Mixed stores retain copy-on-write, revisions, partial state
on errors/cancellation, and negative zero. The loop result records its own type.
This is a general interpreter improvement; no Euler-specific runtime primitive
or graph API was added.

## Algorithm and correctness

Generate unordered nonnegative triples `X <= Y <= Z` using exact integer square
roots, first counting them to size storage. Expand the three choices of vertical
axis and both vertical signs, then deduplicate and sort integer point codes.
The last sphere has 34083 representatives. Coordinate storage is proportional to
the actual point count, rather than three buffers of `8*r*r+2` cells.

Horizontal sign changes and horizontal-axis exchange fix the poles. Representatives
have `0 <= X <= Y`; the rearrangement inequality makes their direct dot product
the largest between their orbits. Thus quotient edges have the exact minimum
original edge weight, and each quotient path lifts to a sphere path of the same
cost. Real edge costs remain `(acos(dot/r^2)/pi)^2`.

Reflection of Z exchanges the poles. One distance table also describes the
reflected backward search. Tentative distances at mirrored vertices give feasible
route bounds, and twice the next unsettled distance gives the bidirectional
stopping condition. The initial bound 0.5 uses an equatorial axis station.

An improving edge must have squared chord length below
`(Upper-Best)*pi^2*r^2`, since arc length is at least chord length. Binary searches
in sorted Z coordinates restrict candidate bands; a further chord bound skips
unhelpful edges before `acos`. The integer band includes an extra unit to make
rounding conservative. There is no nearest-neighbor truncation or approximate
edge weight. The graph is implicit: no quadratic adjacency table is retained.
Generation and minimum-distance scans still have quadratic worst-case work.

The independent JS oracle generates points with a different coordinate scan and
runs ordinary dense Dijkstra without pruning or bidirectional stopping. It
reproduces all fifteen radii and the final sum (one 9.820 s run). Small-sphere tests
compare against the complete unreduced graph; point-orbit tests cover every
radius from 1 through 31, including zeros and equal coordinates.

## Reproduction and checks

```sh
npm run build
node benchmarks/euler353.mjs --program=original --last=9
node benchmarks/euler353.mjs --last=9
node benchmarks/euler353.mjs --last=15
node benchmarks/euler353.mjs --last=15 --samples=1 --radii=true
node benchmarks/euler353.mjs --program=oracle --last=15 --samples=1
```

`--runtime=/path/to/baseline/checkout` selects a separately built interpreter.
The unchanged original Rank source is retained under `fixtures/euler353-original.ra`.
The harness checks known rounded sums, and `--radii=true` additionally checks each
unrounded radius against the independent oracle results.

Validation: workspace build; 307 focused Vitest assertions in eight files;
two existing Rank demo assertions; two execution-exclusion metadata tests; and
`rank check` on this demo. No full `npm test` or whole-corpus execution audit was
run. The default demo remains excluded from the differential execution corpus
because its uncompiled exact point-generation loops exceed that corpus's budget.
