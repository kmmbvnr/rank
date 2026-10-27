# Euler 213: reusable axis folds and array shifts

Investigated at `8da7232e` on macOS arm64 / Node v24.15.0. The main cause was
repeated preparation of tiny native tensor reductions. The probability
recurrence already used quarter symmetry and did not require replacement.

## Compiler change

`sum`, `mean`, `min`, `max` and `count` axis reductions now prepare one checked
native source graph per demand. A runtime frame index routes each output group
through the same generated kernel. Reduced axes retain natural source order,
including noncontiguous and reordered axis lists. There is no cell-size threshold
and no intermediate reduction array on the admitted path.

Every invocation retains source revision/reader/shape/native guards and
cancellation polling. Contract refinement permits at most one guarded graph
refresh. Opaque or unsupported inputs retain ordinary traversal. Boolean
short-circuit paths, arbitrary-precision accumulation, ordinary `=` completion
and deferred-demand semantics are preserved. Per-frame guard checking and kernel
invocation remain; this does not compile the complete probability loop as one
function.

## Program change

Board degrees and their reciprocals use ordinary bindings, so filling weights
cannot repeatedly demand the same four-neighbour counts. Four zero-padded shifts
replace the gather/index-table/sum pipeline. The Up/Down/Left/Right addition order
and probability recurrence are retained; the program remains array-oriented with
one loop over time. The large Src index table is removed.

Even boards retain quarter symmetry. Odd boards now propagate every starting
flea, including central rows/columns, and do not multiply reflected quarters.
This uses roughly four times as many starting-flea states as quarter symmetry
at a similar board size; no optimized odd-board symmetry is claimed. A lone flea
stays on its single cell. The old program gave 6 at N=3, Rings=1; the correct
answer is 2.725309. Existing fixture assertions remain and new cases cover
N=3, N=5 and N=1. Defaults remain N=30, Rings=50, answer **330.721154**.

## Controlled measurements

Each median uses three fresh serial processes, diagnostics enabled, alternating
before/after order. Times include parsing, preparation and execution. Runtime
before is the preserved pre-change build; both runtime versions receive the same
captured original source or the same final program as indicated.

| Workload | Before runtime, s | After runtime, s | Effect |
| --- | ---: | ---: | --- |
| Original program, N=14, 50 rings | 10.508 | 1.217 | **8.63x** compiler improvement |
| Final program, full N=30, 50 rings | 1.709 | 1.669 | 2.3% lower median; small effect |

Final full-program reference median: **4.981 s**. Final compiled full-program
median: **1.669 s**. Full original reference was **13.793 s**, one earlier serial
observation, not a comparative median. Full original compiled before was
**226.520 s**, one preliminary run that overlapped several short diagnostics;
full original compiled after was **22.086 s**, one serial observation. These
single full-source observations do not establish a precise full-input speedup.

The original full source now records **53 tensor preparations**, versus
**10,327,502** in the preliminary before run. At controlled N=14 the count is
489806 → 53. This counter means graph preparation, not unique generated JS
functions or V8 machine-code compilations; the old executable-code cache already
reused generated functions.

Peak RSS is a whole-process high-water measurement, including preparation and
GC, not retained application storage. Controlled original N=14 medians were
461.2 → 202.8 MiB. For the same final full program, before/after runtime medians
were 331.4 → 250.4 MiB; final reference median was 413.3 MiB. These measurements
do not separately quantify allocation volume.

### Other workloads

Same serial three-sample procedure; medians in milliseconds. Synthetic cases
check an independent closed-form total. Narrow uses 20000 rows by 4 values;
wide uses 32 by 4096; strided reduces axis 0 of a 4 by 20000 array.

| Workload | Before | After |
| --- | ---: | ---: |
| Narrow sums | 356.849 | 123.223 |
| Wide sums | 107.700 | 104.357 |
| Strided sums | 356.839 | 122.243 |
| Euler 054 main | 316.287 | 314.947 |
| Euler 054 fixture | 412.260 | 414.672 |
| Euler 200 main | 414.114 | 416.792 |
| Euler 200 fixture | 448.910 | 450.485 |

The narrow/strided gains are about **2.9x**. The wide case and other demos are
close to unchanged; their small differences are not evidence of a general
speedup or regression. Euler 054 and 200 retain all golden/fixture assertions.

## Verification

- TypeScript build, test typecheck, semantic boundaries (65 owners), 11 semantic
  source/catalogue tests and application-form checks pass.
- **9136 ordinary interpreter tests in 402 files pass** (163.08 s, two workers).
  The exhaustive type/differential corpus and Nurikabe were excluded.
- Four separately selected type/differential audits pass for both Euler 213
  files, including full main execution in both engines. The execution exclusion
  was removed only in the disposable validation checkout for these audits.
- The independent oracle propagates every starting flea without symmetry or
  shifts. **80 checks pass**: N=1 through 7, rings=0,1,2,5 in both engines, plus
  the captured original on the even boards. A flea with no neighbour stays put.
- Original fixture assertions and new odd/single-square assertions pass in both
  engines; full golden output remains 330.721154.
- 26 new runtime tests cover bounded preparation, narrow/wide and arbitrary
  axes, exact integers, real rounding order, empty cells/frames, deferred errors,
  repeated demand, native replacement, opaque read order, observer invalidation
  and cancellation without publication of partial assignments.

No Intel measurements were made. Shipping exclusions and timeout configuration
are unchanged; execution-lane reclassification remains separate work.

## Earlier experiments

The CPU profile identified graph binding/emission/domain preparation and GC as
leading costs. A temporary `reducedSize > 4` gate demonstrated the problem but
was **not adopted**. Adding `copy` to the gathered array avoided repeated
preparation at the cost of materialization; its preliminary overlapping full run
used 1875 MiB peak RSS and took 26.778 s, so it was not adopted either. Earlier
prototype measurements remain in the raw data with their original qualifications.

## Reproduction

After building, run from the repository root:

```sh
node benchmarks/euler213-flea-circus.mjs
node benchmarks/euler213-flea-circus.mjs --reference
node benchmarks/euler213-flea-circus.mjs --fixture
node benchmarks/euler213-flea-circus.mjs --variant=original --N=14
node benchmarks/experiments/native-axis-fold.mjs --case=narrow
node benchmarks/experiments/native-axis-fold.mjs --case=wide
node benchmarks/experiments/native-axis-fold.mjs --case=strided
python3 benchmarks/experiments/euler213-oracle.py
```

The JS harnesses accept `--runtime=/absolute/path/to/out/index.js`; the Python
oracle accepts that runtime path as its optional first argument. The Euler
harness defaults to shipping source; `original`, `gcopy`, `shift`, `cached` and
`shiftcached` select captured pre-change source and diagnostic transformations.
Use an external deadline for the full original compiled program, which takes
minutes on the old runtime.

[Raw measurements, original sources, oracle checks and experimental patch](baselines/2026-10-27-euler213-investigation.json).
