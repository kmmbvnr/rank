# Euler 212: sweep work and compiler admission

Research based on `cc671083`, macOS arm64 / Node v24.15.0. The demo now
uses both measured sweep improvements. Inputs, fixture assertions and execution
exclusions remain unchanged; the obsolete fixture timing comment is updated.

Before the algorithm change, the 50,000-cuboid main returns `328968937309`: three serial
fresh-process samples are 6.363, 6.609 and 6.415 s (median 6.415 s).
All five regions use Number loops, without overflow or compilation rejection.
A separate CPU profile assigns 79.0% of sampled time to generated bodies and
15.5% to interruption checkpoints; GC is 0.3%. The remaining cost is primarily
compiled sweep work, rather than missing compiler coverage. The full default
reference workload has not been rerun; its budget exclusion remains.

The algorithm rebuilds the active Y/Z union for every integer X slab.
Each slab scans all 10,400 Y strips and processes open/close events through
a Z segment tree. Both endpoint-to-root walks update shared ancestors twice.

## Research controls

Three fresh serial processes per control; diagnostics enabled. These are
research source transformations, measured before adoption in the demo.

| Control | Median, s | Compiler temporary cap |
| --- | ---: | ---: |
| Original | 6.415 | 256 |
| Pair the two ancestor walks, update common ancestors once | 5.501 | 256 |
| Scan only the active Y bounding interval | 5.871 | 512 |
| Both transformations | 4.852 | 512 |

All twelve completed full inputs return the same golden answer. The final
1024-cap implementation also passes the combined full input in 4.865 s
(single validation, not a new median). Original fixture assertions pass
compiled. Twelve independent inclusion-exclusion checks pass at N=0,1,3,8 for the
original compiled control and the combined control in both engines; source and
results are retained in the raw data.

An earlier bounded-Y prototype exceeded 60 s with cap 256 and was killed.
It had silently selected the exact backend: Number lowering exhausted the
shared generated-name counter near 258. A secondary inference error incorrectly
pointed at `Area`. Explicit Y-bound scalar assignments avoid an earlier separate
unsupported-input inference path, and are part of the measured control.

## Why a cap remains

The old `serial > 256` appeared in `ed6d3501` alongside the first whole-integer
loop compiler and its 32-statement restriction. That implementation incremented
serial for arithmetic results. Today's Number backend also allocates IDs for
index checks and address temporaries, so 256 no longer represents the same
source complexity. No benchmark justification for the exact original value was
found in the introducing change.

The compiler now uses a named 1024-ID ceiling and explicitly records
`number-loop:temporary-budget:*` (or `loop:temporary-budget:*`). This remains a
code-generation heuristic. Integer precision, copy-cost admission, the separate
128-statement restriction and per-expression inference budget are unchanged.

Synthetic controls assign the same cell repeatedly, using 2 or 16 array reads
per assignment. Each configuration has three fresh-process samples. Setup
initializes Count=0, then the first timed execution prepares a zero-iteration
loop. Count is set to 100 for a second timed execution. That second call
recompiles the source (`warmCompiles=1` when admitted), so **run time includes
parsing, lowering, function construction, JIT and execution**. These are not
steady-state throughput measurements. All results have arithmetic assertions.

| Assignments / reads | Cap | Cold median, ms | Run median, ms |
| --- | --- | ---: | ---: |
| 40 / 2 | 256 | 26.9 | 14.7 |
| 40 / 2 | 512 | 28.2 | 15.5 |
| 40 / 2 | 1024 | 27.4 | 15.3 |
| 40 / 2 | none | 27.6 | 15.1 |
| 100 / 2 | 256 | 39.0 | 66.2 |
| 100 / 2 | 512 | 42.2 | 69.0 |
| 100 / 2 | 1024 | 46.0 | 31.5 |
| 100 / 2 | none | 47.5 | 32.7 |
| 100 / 16 | 256 | 150.6 | 272.5 |
| 100 / 16 | 512 | 182.5 | 299.9 |
| 100 / 16 | 1024 | 241.1 | 354.1 |
| 100 / 16 | none | 610.9 | 568.3 |

256/512/none alternate order; 1024 was measured in a subsequent cohort.
The 1024 cap admits the medium region's exact backend, while Number still
declines that case. With no cap, both backends are prepared; its combined
compiler callback payload is 156,587 characters for the medium case and
558,655 for the large case. These sizes include both functions, not a single
JS function or retained memory. The large case declines with all finite caps.

1024 is a conservative compromise, **not an established optimum**. It unblocks
Euler 212 and useful medium regions, while preventing the largest expansion.
Its larger speculative preparation costs are real: the large rejected case is
slower than at 256. A future admission policy could budget generated-code size
or use expected reuse, but neither is implemented here. Removing the cap based
only on the source-statement restriction is not supported by these measurements.

## Verification and reproduction

TypeScript build and 593 tests in six relevant interpreter suites pass.
New tests exercise a newly admitted 64-assignment array region, normal results,
copy-on-write aliases, overflow replay and bounds-error publication. A
100-assignment / 16-read region checks explicit budget diagnostics and fallback
agreement. The final broad run passes all 9,110 ordinary interpreter tests in 401 files
with two workers (163.23 s). Exhaustive type/differential demo audits and the
Nurikabe suite were excluded; the complete demo corpus was not run.

After building, from the repository root:

```sh
node benchmarks/euler212-combined-volume.mjs
node benchmarks/euler212-combined-volume.mjs --baseline
node benchmarks/euler212-combined-volume.mjs --fixture
node benchmarks/experiments/euler212-compiler-budget.mjs 256 100 2
node benchmarks/experiments/euler212-compiler-budget.mjs 1024 100 2
node benchmarks/experiments/euler212-compiler-budget.mjs none 100 16
```

The budget probe copies built interpreter output into a temporary directory,
changes only the ceiling, loads the copy and removes it afterwards. A fourth
positional argument can select another built `index.js`; the Euler harness uses
`--runtime=...`. The Euler harness can load the original source captured in the raw data with
`--baseline`, including module loads from the fixture.
Raw data: `baselines/2026-10-27-euler212-investigation.json`.

## Adopted sweep changes: final verification

The Y sweep includes its last closing event, so each X slab leaves the cover
counts and lengths empty for the next slab. Both endpoints start at the same
segment-tree depth; their parent walks advance together and shared nodes are
recomputed once, after the lower children. Ordinary bindings and eager array
allocation remain unchanged.

Fresh-process before/after pairs use the same final 1024-cap runtime, alternate
order and include parsing, compilation and execution. Diagnostics are enabled.

| Main at N=50000 | Median, s | Range, s | Median process peak RSS, MiB |
| --- | ---: | ---: | ---: |
| Original | 6.285 | 6.284–6.450 | 221.8 |
| Updated | 4.834 | 4.824–4.912 | 225.4 |

The median speedup is 1.30x (23.1% less time). Memory savings are not established;
RSS is a whole-process GC-dependent high-water mark. All six runs return
328968937309 with five Number entries and no overflows. This comparison isolates
the algorithm changes, not the generated-name ceiling.

The unchanged fixture assertions pass on the updated demo: one compiled check
is 0.521 s and one reference check is 39.973 s. These are validation timings,
not repeated comparative medians. The full default reference run remains
outside this verification and its existing exclusion is retained.

Final shipping checks also pass 15 independent inclusion-exclusion comparisons
at N=0,1,3,8,12: original compiled, updated compiled and updated reference.
