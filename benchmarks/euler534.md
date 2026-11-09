# Euler 534: sparse queen transitions and compiled array stages

The full result at N=14 remains **11726115562784664**, beyond the safe
Number integer range. The [statement](https://projecteuler.net/problem=534)
gives totals 276 and 3347 for N=4 and N=5. The maximum-reach component is the
classical N-queens count: 365596 at N=14.

## Algorithm

For reach D, only the last D columns affect the next queen. Retain their
base-N history, counts, and vertical/diagonal attack masks. First-row mirror
symmetry gives weight two except for the central column on odd boards.
Reach zero contributes N^N without enumerating placements.

The original implementation built a states-by-N matrix of possible columns
on every row and sorted every child history, including rows before history
expiration can cause duplicates. It also generated and merged a final frontier
only to sum its weights.

The replacement precomputes set columns, popcounts and column-list offsets for
all 2^N free masks. This is a transition lookup, not a table of answers.
Prefix scans expand only positive move counts into source/column pairs.
Histories are unique until the first queen expires, so early rows skip merging.
The final row sums weight times legal-move count directly. When merging is
needed, compute attack masks only for the representative predecessor of each
history, rather than computing them for every child and gathering them twice.
Histories drop the oldest digit before multiplication, avoiding a needless
extra base-N digit in intermediate arithmetic.

One explicit loop covers all reach/row pairs. Empty frontiers remain empty;
small impossible boards no longer attempt to select a first element from an
empty sorted history. The existing array operations, scans and accumulated
scatter perform expansion and grouped weight addition.

## General compiler changes

Private Number regions now lower homogeneous scalar array constructors, such
as `array 0`, `array 1 2`, and `array true false`. Each scalar item completes
in source order before constructing fresh storage. Signs, scalar errors,
integer widening, aliases and earlier iteration results retain ordinary
semantics. Mixed, nested and unsupported constructors retain existing paths.

Rank-one numeric/Boolean `argsort` can also remain in a private region. It
reuses the existing stable numeric radix/order implementation and wraps its
index buffer without copying the key vector or publishing a Rank array.
Real NaNs and unsupported input representations retain ordinary ordering;
large integers never truncate through Number. Runtime entry rechecks the
builtin and storage guards. Both new stages decline under demand budgets or
cooperative interruption so ordinary traversal charges and cancellation
boundaries remain in force, including after warming.

## Verification

An independent board enumerator checks every reach separately at N=1..7
without masks, packed histories, symmetry or state merging. Number, exact
compiled and reference execution all match it. All modes also match the larger
N=10 total. A full-size assertion checks the exact total and classical
14-queens endpoint. Focused compiler tests cover stable ties, negative and wide
keys, signed zeros, NaNs/infinities, empty arrays, aliases, partial errors,
replaced builtins and warmed execution under budgets/polling.

Timing records and the original program are retained with the benchmark
runner. Historical issue timings (about nine minutes and 4.3 GB) are not the
current baseline. Intel had an unrelated regression corpus actively using one
core during this work; no quiet-host Intel speed claim is made.

## Measurements

Fresh processes on arm64 Node 24.15.0; source parsing is included. Three
compiled pairs alternate old/new order. The base runtime is frozen at
2177dc71; the original source is retained in `fixtures/euler534-original.ra`.
The final local-name cleanup changes no operations and has a separate set of
fresh-process records. Raw data: `baselines/2026-11-09-euler534.json`.

The fixed-source paired series has compiled medians **68.433 -> 17.358 s**
(3.94x). Median per-process peak RSS is **2842.7 -> 1931.8 MiB** (32% less).
Baseline peaks range from 2675.7 to 3066.8 MiB, so a single 3-GB reading is
not presented as a stable baseline. Full reference single samples improve
**65.757 -> 16.423 s**, **3041.9 -> 1775.5 MiB**. At N=12, reference runs
improve 2.169 -> 0.679 s, 436.9 -> 303.0 MiB.

The compiler-only control does not establish a wall-time win: the new source on the old runtime
runs in **17.975 s / 1696.2 MiB**, versus the new-runtime paired median
17.358 s / 1931.8 MiB. Thus most wall-time improvement is algorithmic. The
new general compiler paths reduce CPU time in that sample (25.9 -> about
21.3 CPU seconds), but increase peak memory by about 14% relative to the same
new source on the old runtime. The combined change still uses substantially
less memory than the original program. Reference is slightly faster and
smaller than compiled for this particular large vector workload; closing that
remaining gap requires further work on private-region vector lifetimes and
publication, not another scalar-loop rewrite of this demo.

The full default remains outside repeated corpus audits because of its large
frontiers. A dedicated compiled full-size golden assertion is now included;
small imported fixtures continue to exercise both engines. This changes the
exclusion explanation, not the audit scheduling or timeouts.

Validation: the combined 746-case run across 16 files passed, including numeric
ordering, vector operations, scalar kernels, array operations, and the full
Euler assertion. Intel correctness checks under `nice 19` passed 28 compiler
cases and 24 small/larger Euler cases; the full golden case was deliberately
not run there during the unrelated CPU workload. No full suite or exhaustive
corpus audit was run.

After the local-name cleanup, three delivery compiled samples were
18.722, 17.847 and 17.426 s (median 17.847 s), with median peak RSS
1942.4 MiB. A final reference sample was 14.817 s / 1696.4 MiB, and the
same final source on the old compiler was 17.372 s / 1694.2 MiB. These
controls reinforce that this Euler workload does not get a reliable wall-time
win from whole-region Number compilation. Full diagnostics confirm one
Number region and one mixed-integer region; the wide total stays exact.

The general compiler paths do help a separate small-array workload, retained
as `fixtures/euler534-order-stages.ra`: 50000 iterations build four keys,
argsort them and consume the first index. Three alternating pairs improve
median **0.588 -> 0.221 s** (2.67x) and median peak **459.2 -> 247.5 MiB**.
An independent scalar calculation gives its result 64285; the regression uses
a full 21-iteration residue period with result 27. This is a constructor/order
microbenchmark, not the Euler solution's speedup.

The final new-feature file passes 30 tests after adding nonfinite private-key
replay and a combined constructor/order/consumer case. The filtered
differential comparison passes the imported fixture with both test blocks.

Reproduce after building the interpreter:

```sh
node benchmarks/euler534.mjs compiled 14
node benchmarks/euler534.mjs reference 14
node benchmarks/euler534.mjs compiled 50000 benchmarks/fixtures/euler534-order-stages.ra
```

`RANK534_RUNTIME` selects a separately built frozen interpreter index. Optional
`RANK534_DIAGNOSTICS=1` records admission/counter details; these diagnostic
samples are kept separate from timing medians.
