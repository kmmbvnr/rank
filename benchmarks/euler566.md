# Euler 566: finite cut orbits and parity words

Base: `def74ea37056c2e81f9d86ac8b68c06723f0d3d2`.
Full answer: **329569369413585**. The original source is retained in
`fixtures/euler566-original.ra`.

## Program and verification

The circle map for a sector of size s reflects [0,s) onto (1-s,1] and
translates [s,1] onto [0,1-s]. On the closed interval it is a bijection.
Finite forward orbits of endpoint 1 in all three phases therefore include
their predecessors, endpoint 0 and each cut. The program closes these orbits
using dynamic integer indices, rather than expanding several forward/inverse
candidates in fixed hash and work-list arrays.

Endpoints retain integer coefficients p/Scale + q/sqrt(c). Perfect-square c
uses a common rational denominator. Floating comparisons order the endpoints
with the existing 1e-12 tolerance; the integer coordinate encoding is retained.
Validation covers the problem range through N=53, not arbitrary larger bounds.

Sorting once by phase and coordinate orders the intervals. A bounded geometry
pass constructs the signed interval permutation and resolves target keys with
sorted insertion searches. A 65536-row batch caps temporary vectors; this is
a workspace choice, not a claimed universal optimum.

Cycle parity prefixes use an array scan. The binary parity words are joined
as text and aligned with the existing overlapping substring search. Exact
congruence merges find the first valid shift for each phase, and the minimum
positive result gives F(a,b,c). This checks icing parity, not permutation
identity. Array broadcasting generates the 14190 triples. CPU helpers each
have one loop, with no syntactically nested loops; Rank lines fit 40 columns.

The largest observed refinement is **2,891,475 phase endpoints**, at
(13,14,53), substantially above the old exclusion's estimate. Its flip count
is 329422932751440. Removing fixed workspace capacities matters for correctness:
a trial smaller fixed work list overflowed at the full input and was rejected.

The independent oracle directly flips colored intervals, retaining exact
integer endpoint coefficients. It uses neither a cut graph, cycle matching
nor CRT. It verifies all stated F and G examples through G(17); it is intended
for small inputs. Full golden checks run separately on the compiled, reference
and Number-loops-disabled configurations on Mac, and compiled execution on Intel.

## Shared implementation

Number index transactions now append new keys directly to their guarded native
storage even when it contains seeds. Existing-key updates keep an overlay.
Insertion order provides the rollback journal: an overflowing attempt removes
only the added tail, preserving original values and order before exact replay.
Aliases share a transaction. Ordinary errors publish completed stores. Native
Map intrinsics avoid host iterator hooks, and accessor-backed entries retain
fallback. No Number admission thresholds changed.

Stored private Int32/Int64 vectors can also use native integer `join`, avoiding
boxing the whole input and dispatching formatting per cell. Decimal formatting
remains exact above Number precision. Shared, opaque, mixed/missing inputs,
inspection, demand budgets and interrupt scopes retain ordinary joining.
No syntax or public builtin was added.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Fresh serial processes
per host; diagnostics/profiling disabled. Program time includes parsing and
execution, excluding interpreter import. RSS is the process high-water mark.
The old G(23) baselines have one sample per host/mode; new G(23) values and
new-source/old-runtime controls have three, with medians reported. Full G(53)
has one sample per reported mode. The historical 32-minute full baseline from
#447 was not rerun, so small-input speedups are not extrapolated to G(53).

| Host / G(23) mode | Old s | New median s | Old RSS MiB | New median RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| mac / compiled | 14.618 | 2.816 | 760.5 | 539.2 |
| mac / reference | 6.623 | 3.883 | 624.8 | 599.0 |
| intel / compiled | 35.212 | 10.283 | 609.5 | 525.1 |
| intel / reference | 20.573 | 14.173 | 539.2 | 552.6 |

| Host / full G(53) mode | Seconds | Peak RSS MiB |
| --- | ---: | ---: |
| mac / compiled | 85.953 | 1269.5 |
| mac / reference | 215.078 | 1508.3 |
| mac / exact | 101.514 | 1292.0 |
| intel / compiled | 308.559 | 1083.2 |

New-source/old-runtime compiled G(23) control medians:
- mac: 2.864 s / 538.3 MiB.
- intel: 11.288 s / 523.9 MiB.

One-minute host load before/after recorded samples:
- mac: 1.24–4.46. This does not prove an idle host.
- intel: 0.95–2.44. This does not prove an idle host.

The source rewrite supplies most of the program's speedup. Its new-source/
old-runtime G(23) controls are close to the final runtime on both hosts.
Memory has architecture/mode tradeoffs: Intel reference G(23) peak RSS rises
in these samples despite improving runtime; it also varies across fresh runs.

Three alternating pairs of a million seeded-index operations isolate the
compiler transaction change:

| Host / workload | Old ms | New ms | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac append | 153.270 | 78.658 | 296.5 | 190.2 |
| Intel append | 352.383 | 184.002 | 294.3 | 176.1 |
| Mac overwrite | 20.570 | 22.586 | 140.7 | 140.9 |
| Intel overwrite | 44.475 | 49.795 | 131.6 | 131.7 |
| Mac read | 22.000 | 21.498 | 141.0 | 140.8 |
| Intel read | 54.847 | 52.120 | 131.4 | 128.6 |

This is a large append gain, with an isolated overwrite cost of roughly
10–12% (2–5 ms per million stores). It is not a universal speedup. These kernel
timings exclude index setup; RSS still includes the process and setup.

The faster exploratory imperative variant reached about 25 seconds on Mac
with about 1.7 GiB peak RSS. The selected array/library version uses bounded
geometry and smaller cycle state, trading some speed for clarity and memory.
The full default remains in the explicit manual benchmark lane: combined
compiled/reference corpus runs are expensive, particularly on Intel. The
small fixture stays in ordinary corpus execution. The exclusion reason has
been refreshed rather than silently dropping validation.

## Checks and reproduction

Passed: TypeScript build; 96 focused checks in six files on each host; filtered
fixture differential checks on both hosts; one Mac fixture inferred-type and
one name-fact check; five exclusion-policy checks. Full default results are
checked by the standalone driver. Full exhaustive audits/full npm test were
not run.

```sh
node benchmarks/euler566.mjs compiled
node benchmarks/euler566.mjs reference
node benchmarks/euler566.mjs exact
node benchmarks/euler566.mjs compiled 23
RANK566_TRIPLE=13,14,53 node benchmarks/euler566.mjs compiled
node benchmarks/euler566-index.mjs 1000000 append
node benchmarks/euler566-index.mjs 1000000 overwrite
node benchmarks/euler566-index.mjs 1000000 read
```

`RANK566_RUNTIME` selects a built interpreter; `RANK566_EXPECTED` checks the
answer. Raw samples, sample counts and host load accompany the results.
