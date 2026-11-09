# Euler 538: order statistics for neighbourhood events

The full answer remains **22472871503401097**. The
[statement](https://projecteuler.net/problem=538) gives f(U5)=59,
f(U10)=118, f(U150)=3223 and the prefix sum through 150 equal to 234761.

## Algorithm

For a fixed largest side, increasing any of the other three sides toward it
increases the maximum cyclic quadrilateral area. Thus an optimum uses four
consecutive entries of the sorted prefix multiset. Keeping only the first
four copies of each distinct value is sufficient: an extra copy cannot
introduce a new quartet of side lengths.

The previous demo already used these events, but rescanned every smaller
and larger distinct side on each event, then expanded their multiplicities
to recover three neighbouring sides. The replacement uses the existing sum
segment tree. After adding a copy, a prefix sum locates its block, and
`firstatleast` finds the three multiset neighbours on either side. Only
windows intersecting the inserted block need rescoring. Counts never exceed
four because the event extraction already discards later copies.

Event preparation now uses `sort .indexed` instead of separate argsort and
gather operations. Sorted ranks themselves are the group numbers, so the
full-length prefix scan and subtraction used to reconstruct those numbers
are removed. B(2n)=B(n) also avoids an unnecessary multiplied input array.
The program retains one explicit loop, uses library operations, and stays
within 40 columns per Rank line.

Brahmagupta's product 16*area^2 is now compared exactly as an integer,
including perimeter tie-breaking. The previous floating conversions are
unnecessary. Prefixes with fewer than four sides return zero.

## Shared runtime

Stored Int64 lowerindex/upperindex batches compare signed high words then
unsigned low words, rather than constructing a BigInt for every target and
probe. This preserves distinctions between neighbouring integers above
2^53, low-word rollover and negative endpoints. The existing galloping search
and checkpoint accounting remain. Other inputs and observable/custom-host
polling retain their existing paths. No public operation or syntax is added.

An isolated 3-million-query benchmark beyond 2^53 gives these single controls:

| Host | Shuffled old/new ms | Ordered old/new ms |
| --- | ---: | ---: |
| Mac arm64 | 108.3 / 96.0 | 22.2 / 20.7 |
| Intel x64 | 216.1 / 191.0 | 48.0 / 42.9 |

This is a modest general improvement. Full-demo old-runtime/new-source controls vary substantially on Mac; on
Intel they take 7.575 s versus the 7.535 s final median. The Euler gain is
primarily algorithmic; these controls do not establish a separate full-demo
speedup from the search kernel.

## Full measurements

Frozen baseline: 2967244d, Node 24.15.0, N=3000000. Three alternating
compiled pairs, separate processes, no overlapping benchmark jobs per host.
Times and peak RSS are medians. CPU seconds include user and system time.

| Host | Old time / RSS | New time / RSS | Old/new CPU |
| --- | ---: | ---: | ---: |
| Mac arm64 | 4.454 s / 775.4 MiB | 2.227 s / 679.3 MiB | 5.999 / 3.235 s |
| Intel i7-10750H | 13.217 s / 752.2 MiB | 7.535 s / 648.3 MiB | 17.496 / 9.904 s |

Mac peak RSS varied considerably: old 679.5-1078.1 MiB, new 669.4-682.8 MiB.
Intel ranges were old 746.6-752.2, new 645.3-667.1 MiB. Mac load was about
2.6-3.2, so do not infer small effects from individual samples. Intel recorded
zero other Node processes before every sample; load was 0.08-1.14 as this
single benchmark ran. The historical issue estimate is not the baseline.

Reference mode remains faster, with a memory limitation that the compiled
numbers should not hide. Three alternating Intel reference pairs give
**14.276->7.974 s**, but peak RSS increases **702.6->832.9 MiB** (medians;
new range 832.6-833.5 MiB). Thus reference memory is a remaining allocation
target. A clean-build Mac reference single is 3.943->2.378 s and
741.8->760.3 MiB; it is not a repeated median.

Mac final measurements were repeated after a forced TypeScript rebuild.
The rebuilt unchanged tensor/bits modules were checked byte-for-byte against
the frozen baseline; only sorted-search.js differs. Earlier Mac series made
with stale prototype output were discarded. Intel was isolated before that
prototype and did not contain it. Unrelated nightly report updates on main
are integrated separately and do not change interpreter code.

## Alternatives and verification

A per-input online scan, repeated first-occurrence scatter passes, and an
all-popcount-combination table were slower or used more memory. A prototype
adding popcount and checked powers to numeric tensor recipes could fuse the
expression but slowed this demo; it was removed. Ordinary staged arrays
remain preferable for this workload. No extra syntax or speculative compiler
feature is retained just to make a prototype compile.

The independent small oracle enumerates every quartet of distinct positions
rather than using sorting, event reduction or the consecutive-window theorem.
It checks every prefix through 35, zero/small inputs, statement examples,
the 120/3000 regressions and full result on Number, exact and reference modes.
An observation-only tuple exposes local event perimeters to those tests;
measurements execute the original, uninstrumented demo source.

Int64 batch tests include both endpoints, negative values, duplicates, low-word
rollover, neighbours above 2^53, Int32 targets, trusted strided views and point
edits. Existing sort, segment and popcount regressions remain covered.
Mac: 108 focused tests and both filtered differential files pass. Intel: the
same Euler/search/segment checks pass (69 tests across the selected runs),
including a rerun of the final demo. TypeScript build passes. Exhaustive
corpus/type audits and the full npm test were not run. The full demo now
returns to the ordinary differential corpus.

Raw samples, controls and explicitly labelled exploratory runs:
[JSON](baselines/2026-11-09-euler538.json).

Reproduce from the repository root:

```sh
node benchmarks/euler538.mjs compiled 3000000
node benchmarks/euler538.mjs reference 3000000
node benchmarks/sorted-search-wide.mjs
```

`RANK538_RUNTIME` selects a frozen interpreter entry point; use
`benchmarks/fixtures/euler538-original.ra` as the third argument for the old
source. `RANK_SEARCH_ROOT` selects the baseline out directory for the isolated
search benchmark. Reported primary runs disable diagnostics and profiling.
