# Selection through stored views

The Euler 585 profile exposed repeated reads of a Boolean slice in
`Values (Mask Indices)`. Selection checked the slice for table field names
and integer offsets by collecting its cells before reading the actual mask.
A trusted view over homogeneous storage now supplies its scalar kind.
Opaque readers and observable demand use the original path.

Value sorting also copies ready Int32 or known-wide Int64 buffers directly.
It retains compact results when all Int64 values fit Int32 and keeps the
source buffer independent of the sorted result.

The benchmark sums a million selected integers ten times and checks
`499999500000`. The timed section excludes setup. Peak RSS includes setup.
Each row is the median of three alternating pairs in fresh processes
with Node 24.15.0 and compilation disabled. The comparison uses
`e8247119` as the base.

| Host | Before (s) | After (s) | Before (MiB) | After (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 | 7.676 | 1.387 | 444.3 | 399.9 |
| Intel i7-10750H | 22.638 | 3.891 | 423.7 | 388.2 |

Run `node benchmarks/selector-views.mjs reference`. Set
`RANK_SELECTOR_RUNTIME` to another built interpreter's `out/index.js` to
compare runtime versions. The benchmark exercises selector classification.

129 focused checks passed on each host. They cover integer and Boolean
views, reader replacement, demand budgets, mixed domains, exact wide
sorting, compact storage and source aliases.
