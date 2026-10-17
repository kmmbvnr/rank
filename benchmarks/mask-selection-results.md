# Array mask selections (#287)

Measured on 2026-10-17 with Node v24.15.0 on Apple M5. Baseline runtime:
`2623e11c`; after: the working-tree selection snapshot and position-list change.

Run after building the interpreter:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/mask-selection.mjs --euler
```

Euler 60 runs in three fresh processes per version without a profiler. Its
timing includes parsing and execution, suppresses printed output, and checks
`Answer = 26033` every time. Baseline samples: 33.876, 33.446, 34.327 seconds.
After samples: 26.685, 27.216, 27.204 seconds. Median: **33.876 → 27.204 seconds**,
1.25× as fast, or about 20% less elapsed time. Interpreter and demo test suites
ran separately from these measurements. An earlier run overlapped tests and
was discarded.

The microbenchmarks use an already-built source and boolean mask, both with
100,000 cells. Sparse keeps 100 cells; dense keeps all 100,000. Each case has
its own fresh process with two warmups and seven measured rounds. Construction
includes mask validation and, after the change, position collection. Predicate
evaluation and creation of the input arrays are outside the microbenchmark.
Every length and traversal result is checked.

| Case / operation | Before median, ms | After median, ms |
| --- | ---: | ---: |
| Sparse: construct selection | 7.093 | 6.619 |
| Sparse: 100 length reads | 983.346 | 0.033 |
| Sparse: 10 full traversals and sums | 84.512 | 0.065 |
| Dense: construct selection | 6.368 | 7.004 |
| Dense: 100 length reads | 1273.671 | 0.012 |
| Dense: 10 full traversals and sums | 113.224 | 45.573 |

The structural guarantee matters more than ratios for sub-millisecond length
reads: an array-mask selection now stores an exact count and does not demand
any selected source cells for `len`. Traversal visits only kept positions.
Construction remains O(mask cells) and stores O(kept cells) numeric positions;
the dense case pays extra construction work and position storage. This is not
a claim of lower peak heap usage, which was not measured. Selected source
values remain lazy and are not copied into the position list.

Applying an array mask fixes its selection. Position lists detach the mask;
plans that continue reading a mask or source array retain it through the
existing copy-on-write ownership path. Index writes to lazy arrays remain
invalid, and whole-mask `and=` / `or=` / `xor=` still bind a new value.

This change does not make arbitrary sequence filters exact-sized, and `drop`
still iterates past its offset. Euler 60's nested sequence filters retain those
costs; this measurement covers the array-mask layer only.

Validation: TypeScript build and test type-check passed, along with 3,629
interpreter tests (191 files, two workers) and semantic-boundary/application-form
checks. A selected demo differential run compared 28 files with no differences
between compiled and reference execution. The initial type audit exposed
baseline analyzer errors, reproduced with the old selection implementation.
A companion CI repair fixes type-only assumptions about mapped operations,
mask selections and scalar vector contractions. All 1,105 language tests and
the regression type audits for Euler 61, 80, 84, 86 and 91 pass. The CLI
`explain` corpus check also passes after restoring missing sequence imports
in two demo test modules. No demo outputs or audit assertions were changed.
