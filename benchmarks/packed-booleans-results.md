# Packed boolean arrays (#394)

Measured on Apple M5, Node v24.15.0. Baseline: `7734516b`, built in an isolated
checkout. Candidate: the packed-boolean implementation on that base. Raw reports
include the interpreter source hash, three fresh-process samples, import time,
fixture construction, parsing, execution, validation, process time and peak RSS.
Reports are in [2026-10-23-packed-booleans/](baselines/2026-10-23-packed-booleans/).
Final comparisons alternate candidate/baseline order to limit drift. Import
time varied between paired groups (roughly 240–390 ms); speedup ratios below
use the corresponding paired runs. All numbers are medians unless stated otherwise.

## Storage and general kernels

| Case | Baseline | Packed |
| --- | ---: | ---: |
| Retained payload, 1,000,000 flags | about 8,000,000 heap bytes | 125,000 buffer bytes |
| Additional storage metadata | included in heap delta | about 3,900 heap bytes |
| Direct allocation | 1.91 ms | 0.35 ms |
| COW copy | 121.83 ms | 0.14 ms |
| COW retained storage | about 8,030,000 heap bytes | 125,000 buffer bytes + about 6,700 heap bytes |
| `(A and B) count`, 1,000,000 true cells | 87.25 ms | 7.21 ms |

The storage measurements use forced GC and retain both arrays through validation;
they measure retained deltas, not allocation peaks. Payload savings are about
64x on this VM. Whole-process RSS includes the parser, runtime and JIT, so it is
not a measure of bitmap payload. Public JS `.items` exposure still unpacks into
tracked ordinary cells. Normal addressed boolean writes, native word operations,
explicit copies, COW, and contiguous row reads do not require that exposure.

The first storage-only diagnostic reduced memory and COW cost but left the
shift-or workload near 4.4 seconds. The speed benefit required word kernels and
preserving their plans through deferred binding checks. Scalar tensor compilation
delegates eligible boolean graphs to those kernels. Other compiled boolean copies
allocate bit output directly.

## Money Sums (CSES 1745)

The dense fixture has 100 coins `1 + (i * 7919 mod 1000)`, total 49150, and
49068 positive sums. An independent backwards `Uint8Array` DP checks every output
position. The separate maximum fixture has 100 coins of value 1000 and reaches
sum 100000; it has 100 positive sums. Formatting/stdin are outside execution time.

| Program | Execution | Whole process | Peak RSS |
| --- | ---: | ---: | ---: |
| Same boolean shift-or source, baseline | 6957.67 ms | 7757.95 ms | 390.5 MiB |
| Same boolean shift-or source, packed | 68.22 ms | 861.49 ms | 166.2 MiB |
| Packed shift-or, paired against BigInt | 42.50 ms | 587.74 ms | 162.7 MiB |
| Existing BigInt shift-or | 10.77 ms | 552.77 ms | 170.0 MiB |
| Previous scalar-loop demo | 55.53 ms | 556.05 ms | 163.7 MiB |
| Updated shift-or demo | 40.53 ms | 554.58 ms | 172.1 MiB |
| Updated demo, maximum sum 100000 | 47.92 ms | 756.52 ms | 160.8 MiB |

The same boolean program is about 102x faster; changing the already compiled
scalar-loop demo gives about 1.37x. These are different comparisons. BigInt still
wins the DP core here: its measured result is the integer mask, while the boolean
program includes true-index enumeration. BigInt index extraction is performed by
the host during validation (18.21 ms), outside its execution timing. This is not
evidence that packed arrays beat BigInt for every bitset algorithm.

For the packed shift-or run paired against ordinary arrays, import takes
390 ms and parsing 278 ms. The complete process is 861 ms: startup
and parsing dominate the 68 ms computation. The separate BigInt comparison uses
its adjacent packed run; do not compare absolute startup times across groups.

## Corner Subgrid Count (CSES 2137)

The full fixture is 3000 by 3000. Cell `(i,j)` is black when `j mod 3 != i mod 3`.
The algorithm examines all row pairs; it does not exploit repeated patterns.
An independent column-class combinatorial oracle gives **4494001500000**.
Small random grids also have cell-by-cell differential tests in both compilation
modes, including widths 31, 32, 33 and 65. The packed matrix payload is 1,125,000
bytes. Fixture generation is measured separately from execution.

| Case | Execution | Whole process | Peak RSS |
| --- | ---: | ---: | ---: |
| Same batched program, size 100, ordinary arrays | 556.44 ms | 1131.05 ms | 269.8 MiB |
| Same batched program, size 100, packed | 79.24 ms | 644.22 ms | 174.7 MiB |
| Pair-at-a-time program, size 300, packed | 2488.68 ms | 3226.05 ms | 609.0 MiB |
| Batched program, size 300, packed | 268.13 ms | 995.09 ms | 192.8 MiB |
| Batched program, size 3000, packed | 14952.83 ms | 15779.54 ms | 436.5 MiB |
| BigInt row intersections, size 3000 | 14566.01 ms | 15718.26 ms | 172.7 MiB |

The general packed mechanisms give about 7.02x on the unchanged batched size-100
program. Separately, replacing the per-pair Rank loop with row broadcasting and
`count axis 1` gives about 9.28x at size 300. Full packed and BigInt times are close
within run variation; these measurements do not show a packed speed win over
BigInt. Packed uses substantially higher process RSS. All three full runs of
both variants return the oracle answer. Packed peak RSS across the three runs
is at most 442.4 MiB. Import, parsing and fixture construction take about
364 ms, 284 ms and 111 ms respectively for packed; BigInt fixture construction
is 558 ms.

The full ordinary-array program was stopped by a 10-second benchmark timeout;
it has no validated result or peak-RSS measurement. An earlier full per-pair
diagnostic was manually stopped without a result while investigating missing
packed plans. Neither is a passed check or a basis for a full-scale speedup ratio.

**The 1-second CSES time limit is not met.** These are complete computations at
the official maximum dimensions, not judge submissions. The backend is useful
for packed addressed flags and shape-aware word operations; it does not establish
that every dense graph/bitset program meets judge limits. The 50000-node DAG
reachability workload remains unverified.

## Reproduction and checks

Build each checkout before measuring. Examples:

```sh
npm run build
node benchmarks/packed-booleans.mjs --case=memory --size=1000000
node benchmarks/packed-booleans.mjs --case=intersection --size=1000000
node benchmarks/packed-booleans.mjs --case=money
node benchmarks/packed-booleans.mjs --case=money --variant=bigint
node benchmarks/packed-booleans.mjs --case=money --variant=demo --fixture=maximum
node benchmarks/packed-booleans.mjs --case=corner --size=300 --variant=pair
node benchmarks/packed-booleans.mjs --case=corner --size=3000 --timeout=60000
node benchmarks/packed-booleans.mjs --case=corner --size=3000 --variant=bigint --timeout=60000
```

Use `--baseline=/path/to/built/baseline` to alternate two checkouts in one run.
`--baseline-variant=bigint` or `pair` compares algorithms in the same checkout.
Use `--checkout=/path/to/built/baseline` to measure just that revision. The default is three fresh processes. `--worker=true` is internal.
Full performance runs are opt-in; CI correctness uses small fixtures.

The final focused Vitest run passes **519 tests in 24 files**, including 51
packed-storage, kernel and random-grid checks. `npm run build` passes for all
workspaces, and the semantic-boundary source check passes. Validation covers storage payload, COW/aliasing, packed scalar access, conversion
on incompatible writes, deferred contracts, live host readers, cancellation,
inspection fallback, logical operations, tails, shifts, matrix rows, row
broadcasting, axis validation and random-grid oracles. The two demo test files
have seven passing checks, and both stdin examples give their official output.
The existing `array-storage.test.ts` test “keeps the same array shared when another
parameter also binds it” fails independently on baseline and candidate; it was
not changed or counted as passed. No full `npm test` or corpus-wide run was used.
