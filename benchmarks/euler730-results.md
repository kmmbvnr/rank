# Euler 730: complete stored concat streams and compare packed masks

Issue [#539](https://github.com/kmmbvnr/rank/issues/539) asks for a several-fold
speedup of `demos/euler/730_shiftedtriples.ra`, preserving its answer and
profiling the dominant array operation. The Rank source, tree traversal and
all default arguments are unchanged. The answer is `1315965924`, counting
`2631931476` ordered tree nodes before the diagonal/symmetry correction.

## Runtime changes

A concat containing a mask-selection sequence previously went through
`concatItems`, `stackItems`, homogeneous-cell validation and integer packing.
Every stored integer was boxed, yielded and then packed again. Even an Int32
input could emerge in an Int64 buffer, making subsequent arithmetic more
expensive.

Finite concat plans now register a native completion. At materialization, it
flattens native concat plans and admits stored numeric vectors and native
mask selections. It prepares every input before validating or copying cells,
then gathers directly into fresh typed storage. Contiguous segments use block
copies. Int32 inputs remain Int32; boxed small integers are range-checked before
packing. Wider exact integers use Int64, and arbitrary precision retains the
ordinary iterator path. No new result cache or language syntax is introduced.

Admission preserves native view strides and selected positions, including flat
matrix masks. Replaced iterators, unknown generators, host readers, missing
cells, incompatible domains, invalid storage bounds and observable polling
retain ordinary completion. Uniform binding checks run only for nonempty
segments. Results own their cells; retained inputs and earlier results keep
their snapshot behavior.

A second bottleneck occurred while constructing roots: `Up1 not equal true`
and the two similar expressions expanded packed masks into scalar Boolean
comparisons. Equality and inequality of owned Boolean bitmaps, with another
same-shape bitmap or a Boolean scalar, now operate on words. Result padding is
trimmed. Opaque/replaced readers, broadcasting and mixed domains keep the
ordinary comparison path.

The whole tree loop still declines compilation at its count clause. Existing
tensor kernels consume the compact arrays produced by native completion;
this change does not add a compiler specialized for this Euler program.

## Measurements

Node v24.15.0, fresh processes, compilation enabled. Baseline: `da961000`.
Final runtime: `10cc3d1f`. Mac is arm64; the Intel machine is an i7-10750H
running Linux x86_64. Each baseline/final comparison below uses identical
Shifts, Perimeter and Budget. Timing samples have no profiler or diagnostics.

| Machine / input | Baseline | Final | Speedup | Peak RSS baseline → final |
| --- | ---: | ---: | ---: | ---: |
| Mac, 30 / 3000000 / 400000, median of 3 | 17.944 s | 1.896 s | 9.46x | 822.8 → 730.6 MiB |
| Intel, 100 / 10000000 / 4000000, one pair | 427.355 s | 46.840 s | 9.12x | 3061.5 → 1992.8 MiB |

Mac baseline samples were 18.325, 16.049 and 17.944 seconds; final samples
were 1.896, 1.849 and 2.247 seconds. The Intel medium input retained answer
`131597552`. Its root phase fell from 58.958 to 14.070 seconds and its walk
from 368.396 to 32.768 seconds.

Full default results are recorded separately below. The current baseline was
not rerun at the full perimeter of 100000000. The issue's historical 73-minute
result is not a paired measurement against this baseline commit.

| Full default, 100 / 100000000 / 4000000 | Time | Peak RSS | Answer |
| --- | ---: | ---: | --- |
| Mac | 235.462 s | 8037.3 MiB | 1315965924 |
| Intel | 366.574 s | 4171.0 MiB | 1315965924 |

Both visits counted exactly 2631931476 ordered nodes. Mac phases were 9.122 s
for roots and 226.337 s for the walk; Intel phases were 14.471 s and 352.102 s.
The full Mac run still needs about 7.85 GiB at its peak; the change does not
make the default problem a low-memory workload.

RSS is a process high-water mark and varies with garbage collection. Reduced
RSS on the paired inputs does not establish a fixed memory bound for larger
inputs.

## Profiles and memory investigation

Separate CPU profiles use the Mac small input. Before: 9838 self-time samples,
including 723 in `concatItems`, 709 in `stackItems`, 541 in `ownedArray` and
1532 in GC. The final profile removes the concat/stack iterator path; native
`copyScalarConcat` has 55 samples and GC has 87. Profiled durations were
13.373 and 1.794 seconds; use the unprofiled table for timing comparisons.
Raw profile summaries and diagnostic counters are in
[`results/euler730`](results/euler730).

Root-only trace probes found 16.716 seconds between the first root-mask
assignment and the sums stage. Packed comparison removed that scalar mask
work. The exploratory root-only probes changed from 21.883 s / 1493 MiB to
5.960 s / 999 MiB. These include trace print calls and precede the final timing
samples.

An exploratory Budget reduction from 4000000 to 400000 produced no useful
improvement in the intermediate versions: 295.065 s / 7483 MiB versus 323.298 s /
8121 MiB. The first exploratory run overlapped focused checks, and these are
not final-runtime timing comparisons. The admission guards also changed, so
these samples do not isolate the effect of Budget. Both returned the full
answer. Budget remains unchanged. The pending pool is not capped by the per-batch
Budget; a traced medium run reached 8521803 pending entries even with Budget
400000. The retained global root tensors also occupy about 879 MiB of buffers.

## Verification

- 357 focused tests across 15 files passed; the final shape-admission guard
  was additionally checked by the 30 packed-comparison tests.
- Independent small-input oracle enumerates leg pairs and possible hypotenuses,
  without Berggren maps or a root bound. Both compilation modes agree for
  shifts 0–10, and pool budgets 1, 7, 64 and 4096 retain the same counts.
- Native completion tests cover packing boundaries, exact Int64 endpoints,
  integers beyond 2^53, arbitrary precision, reversed views, matrix masks,
  missing values, non-finite reals, signed zero, COW snapshots, iterator
  replacement/getters, binding errors, opaque polling, cancellation and retry.
- TypeScript build and semantic-boundary checks passed. No exhaustive audits
  or full `npm test` were run. Default Euler 730 remains a manual benchmark.

Build and reproduce from the repository root:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler730.mjs
node benchmarks/euler730.mjs 30 3000000 400000
RANK_ROOT=/path/to/built/base node benchmarks/euler730.mjs 100 10000000 4000000
DIAGNOSTICS=1 PROFILE=/tmp/euler730.cpuprofile node benchmarks/euler730.mjs 30 3000000 400000
ROOTS_ONLY=1 TRACE_ROOTS=1 node benchmarks/euler730.mjs
TRACE_WALK=1 node benchmarks/euler730.mjs 100 10000000 400000
```
