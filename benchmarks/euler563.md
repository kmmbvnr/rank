# Euler 563: bounded area batches and ordered numeric frequencies

Base: `8844cb46ebc3f33ab2a922a2e8e09e8dea9b8be4`.
Full result: **27186308211734760**, an exact integer beyond Number precision.
The old program is retained in `fixtures/euler563-original.ra`.

## Program and correctness

Robot sides contain only prime factors through 23. The prime fold extends each
current smooth number by every allowable power of the next prime. Ragged
lengths, prefix sums and insertion queries construct those products without
nested loops or trying inadmissible powers against every parent.

For an area interval [Low,High), x<=y<=11x/10 implies

```
x >= ceil(sqrt(ceil(10 Low / 11)))
x <= floor(sqrt(High-1))
y >= max(x, ceil(Low/x))
y <= min(floor(11x/10), floor((High-1)/x)).
```

Binary insertion searches in the sorted smooth sides give each x's exact y
range. Prefix sums expand only those pairs. This replaces sorting merged
boundary arrays and rebuilding their inverse permutation. A candidate band
is bisected when it exceeds 1,048,576 pairs. Every accepted band advances its
upper bound, so at most End iterations suffice. One area is never split: if
its own group exceeds the batch target, that indivisible band is kept whole.
Thus the cap controls working batches, rather than changing the counts.

Sorted areas use `unique .counts`; `min by` records the least area for each
requested frequency. Completed bands are disjoint and ordered, so stopping
once every frequency 2..K is found gives the global minima below End. Large
intermediates are local to one band invocation. The original conservative
exclusive area limit End=floor(10L/11)^2 is retained. An incomplete search now
raises `increase L` instead of silently returning a partial sum. K=0 and K=1
return zero; L must be positive and K nonnegative.

The Rank program contains no explicit loops and stays within 40 columns.
The default statement/fixture assertions are retained, and the full demo is
restored to ordinary corpus execution.

## Shared runtime

`unique .counts` recognizes monotonically ordered, completed native numeric
vectors. Two linear scans produce distinct values and exact frequencies in
first-appearance order without a string-keyed Map or neighbor/index arrays.
Ascending and descending inputs work. Int64 comparisons use signed high and
unsigned low words, so each probe avoids allocating a BigInt while preserving
all 64 bits, including adjacent values beyond Number precision. Output keys
and frequencies retain integer storage. Real signed-zero representatives are
preserved; NaN uses the ordinary route.

Unsorted, opaque, mixed, missing, shared-buffer and out-of-int64 inputs retain
fallback. Demand budgets and inspection retain ordinary traversal; native
loops poll cancellation. There are no Number-admission threshold changes.
This is a shared execution kernel used by both compiled and reference modes,
not a problem-specific builtin or a new Rank operation.

## Measurements

Node v24.15.0 on Apple M5 arm64 and Intel i7-10750H x64. Three alternating
fresh-process pairs per mode; each sample checks the full answer and complete
minimum table. Times include parsing/execution and exclude interpreter imports.
RSS is the process high-water mark. Diagnostics/profiling are disabled.

| Host/mode | Old seconds | New seconds | Old peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 3.869 | 3.445 | 2756.3 | 562.7 |
| Mac reference | 3.867 | 3.290 | 2736.5 | 546.0 |
| Intel compiled | 10.885 | 9.036 | 1227.8 | 389.5 |
| Intel reference | 10.809 | 9.107 | 1255.7 | 390.4 |

Time and RSS columns show separate medians. Intel also ran one unrelated
nightly Euler worker, left untouched. Each sample records before/after load
averages; these are loaded-host results. Absolute RSS differs substantially
between hosts, so compare variants on the same host.

The time improvement is modest (about 11-17%); peak RSS falls by roughly 3-5x.
The historical 37-second issue figure no longer reproduces on the current base.
On the same new source with the old runtime, compiled medians are 8.887 s /
638.6 MiB on Mac and 24.812 s / 456.9 MiB on Intel. These three-sample controls
show that replacing manual group construction with `unique .counts` needs the
new native frequency kernel to retain performance. A program-only rewrite
would regress time. Both shared execution and the bounded program structure
contribute to the delivered result.

Exploratory controls compared fixed band ratios 2, 5/4, 9/8 and 17/16, then
adaptive batch targets 256K, 512K and 1M. Smaller batches lowered RSS at the cost
of more planning. The 1M target retained the best measured adaptive time while
keeping peak RSS far below the old program. A separate indexed-product helper
had no measured benefit and was not retained. Profiling/diagnostic runs are
separate from primary timings.

## Verification and reproduction

Passed: TypeScript build; 269 focused checks in nine files on each host; two
filtered differential cases on each host; two inferred-type and two name-fact
cases on Mac; five exclusion-policy checks.

Focused tests independently enumerate small smooth side pairs, compare every
area's frequency across deliberately tiny adaptive bands, and check that an
indivisible repeated area stays together. Full/statement answers run on
Number, exact and reference routes. Native frequency tests cover both order
directions, Int64 sign/carry/precision boundaries, NaN/signed zero, unsorted and
opaque fallback, snapshots, shared buffers, budgets and cancellation.
Exhaustive audits/full npm test were not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler563.mjs compiled
node benchmarks/euler563.mjs reference
RANK563_K=10 node benchmarks/euler563.mjs compiled 3000000
node benchmarks/euler563.mjs compiled 60000000 benchmarks/fixtures/euler563-original.ra
```

`RANK563_RUNTIME` selects another built runtime; `RANK563_EXPECTED` checks an
answer. Every run also requires the complete minimum table. Diagnostics and
profiles require separate `RANK563_DIAGNOSTICS=1` or `RANK563_PROFILE=path`
options. Raw primary samples: `baselines/2026-11-10-euler563.json`.
