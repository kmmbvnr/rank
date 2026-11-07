# Euler 456: triangles containing the origin

The full two-million-point answer remains **333333208685971546**. The
algorithm already groups primitive directions, sorts their angles and counts
weighted triples. Its O(N log N) structure is appropriate. The avoidable cost
was a manual merge/sort/scan/scatter implementing lower bounds: `lowerindex`
previously accepted only integers, so the program could not use it on angles.

The program now uses `Circle lowerindex Opposite`, retaining array operations
and no loops. This removes a second merge and sort of 5,957,919 cells, plus
several intermediate masks, scans and index arrays. The doubled circle has
3,971,946 cells and supplies 1,985,973 queries in one native batch. Redundant
absolute values before `gcd` are removed; signed gcd already handles them.
Antipodal angles still use atan2 of the opposite coordinates to retain the
original floating-point boundary comparisons.

## General runtime and compiler support

`lowerindex` and `upperindex` now support real and mixed numeric inputs, with
exact BigInt/Number relational comparisons rather than converting wide
integers to Number. Scalar searches still inspect only their logarithmic
search path. Infinities are supported; a NaN target or visited source cell
raises an error. Sortedness remains the caller's precondition.

Stored Float64 batches reuse the integer galloping search and preserve target
tensor shapes. A NaN-free proof scans completed logical input cells only when
its cost is bounded by the batch's ordinary binary-search work. Otherwise the
batch declines. Encountering NaN also declines, leaving scalar evaluation to
report an error only when that query is demanded. This keeps tiny queries
logarithmic and avoids publishing errors from unused lazy queries.

The Number loop compiler can now lower real-source and real-target searches.
NaNs replay through the ordinary path; wide integer exactness guards remain.
Arbitrary host polling, inspection, demand budgets and externally shared
buffers retain observable scalar behavior. Scalar polling reads the current
array storage after each checkpoint rather than retaining a stale buffer.

An initial prototype checked NaNs in the hot search predicate and regressed
random Int32 batches by over 50%. It was rejected. The final proof runs before
the search. Separate warmed integer controls cover Int32 and BigInt64 sources,
ordered and shuffled queries, and lower/upper bounds. Their three-pair median
changes range from -4.4% to +4.8% on Mac and -0.3% to +6.1% on Intel. These
millisecond controls do not establish statistical equivalence, but exclude
the large regression observed in the rejected prototype.

## Measurements

Three alternating before/after pairs per mode and host, fresh Node v24.15.0
processes. Both source variants use the same candidate runtime, isolating
the program's use of the new library capability. Timings include parsing,
analysis and execution; process startup is excluded. RSS is the process peak.
The issue's historical 24.1/21.5-second figures are not the fresh baseline.

| Host | Mode | Seconds before → after | Peak RSS MiB before → after |
| --- | --- | --- | --- |
| Mac arm64 | compiled | 2.711 → 1.789 | 1129 → 960 |
| Mac arm64 | reference | 2.754 → 1.904 | 1113 → 956 |
| Intel x64 | compiled | 5.962 → 3.883 | 1104 → 942 |
| Intel x64 | reference | 6.134 → 4.011 | 1056 → 909 |

These are medians; all ranges and raw samples are retained in
[the baseline artifact](baselines/2026-11-07-euler456.json). Foreign Node jobs
were checked before and every second during execution. Before each Intel
sample the host was at least 98% idle with zero swap-in/swap-out activity.
No samples were removed from this final series. The final metadata-only
placement of the batch's Int32 index-width guard was retested afterward.

## Verification

- Independent integer cross-product triangle counts at eleven small sizes
  on Number, exact compiled and reference backends.
- Five explicit point sets cover repeated rays, opposite pairs, zero points,
  boundary exclusion and nearly parallel directions on all three backends.
- Official 600/40000 fixtures on all three backends; full golden in tests and
  every benchmark process on both hosts.
- Real/mixed search tests include signed zero, infinities, wide integer ties,
  strided sources, tensor targets, lazy NaN errors, foreign readers, mutation,
  opaque host polling and budget fallback. A test asserts Number compilation.
- 1843 focused interpreter tests in 61 files and 98 language tests in 6 files
  passed on each host. A final 39-search-test rerun also passed on each.
- Source/test TypeScript checks, semantic boundary checks and application-form
  checks passed on Mac. Exhaustive corpus audits were not run.

Reproduce from the repository root after building language/interpreter:

```sh
node benchmarks/euler456.mjs compiled
node benchmarks/euler456.mjs reference
node benchmarks/euler456.mjs compiled 2000000 benchmarks/fixtures/euler456-original.ra
node benchmarks/sorted-index-control.mjs /path/to/old /path/to/new
```

`RANK456_RUNTIME` selects another built interpreter entrypoint;
`RANK456_DIAGNOSTICS=false` disables counters. The original source fixture and
its SHA-256 in each result make the comparison reproducible. The integer
control imports each runtime's storage constructors separately, so ownership
checks are valid on both sides.
