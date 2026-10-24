# Integer sort pipeline memory (#444)

Measured on Apple M5, macOS arm64, Node v24.15.0. Baseline: `d21790fa`.
Raw samples are in `baselines/2026-10-24-sort-memory/`.

Each sample uses a fresh process. Times include parsing and execution, but
exclude input setup and result validation. Peak RSS covers the entire process,
including setup and validation. The conversion case builds its boolean mask
before timing; its RSS therefore includes that preparation. These are process
peaks, not measurements of bytes allocated by each operation.

| Case | Baseline time | Changed time | Baseline peak RSS | Changed peak RSS |
|---|---:|---:|---:|---:|
| Contiguous slice, 50,005,000 int64 inputs | 850–854 ms | 561–568 ms | 1464–1468 MiB | 705 MiB |
| Boolean to integer, 10,000,000 cells | 621–652 ms | 8.0–8.4 ms | 766–770 MiB | 352–357 MiB |
| Self-rebinding sort, 50,005,000 int64 cells | 1078 ms | 861–862 ms | 891–896 MiB | 510–515 MiB |
| Euler 557, default N=10000 | 48.36 s | 31.76–32.62 s | 5795 MiB | 2169–2180 MiB |

The full-program baseline has one sample; the final version has two. Overall
speedup is about 1.5x in these runs, with about 62% lower peak RSS. The final
peak is at most 2.29 GB in decimal units, below the issue's 3 GB limit. Every
full run checked the answer `2699929328`.

## Changes measured separately

1. Materialized affine index vectors use the linear selector path. Saving a
   contiguous numeric slice shares the typed buffer; a later write detaches it.
   Temporary slices inside expressions keep their existing read plan, avoiding
   repeated source copies in update loops. Slice validation: 121 tests passed.
2. Integer conversion writes compact cells directly. Boolean bitmaps expand
   directly into Int32 cells without boxed booleans or integers. Conversion
   validation: 85 tests passed. Other stored scalar conversions preserve shape,
   exact wide integers, and conversion errors.
3. A top-level `A = A sort` can reuse a uniquely held Int32 or Int64 buffer,
   including explicit ascending/descending directions. Aliases, retained
   readers, borrowed parameters, changed native implementations and execution
   with interruption retain the ordinary path. Sort validation: 91 tests passed
   before adding further fallback and borrowed-parameter coverage.
4. General mechanisms alone left Euler 557 at 3986 MiB peak RSS. Its adjacent-key
   search now compares overlapping windows of at most 1,000,001 keys and retains
   only matching endpoints. Deduplicating those positions preserves groups that
   span windows. Ten tests compare the retained keys and totals with independent
   fraction grouping, including the existing N=20/54/55 answers and execution
   with compilation disabled.

The intermediate full-program samples are diagnostic comparisons, not a promise
of monotonic timing improvement: slices plus conversion took 39.68 s / 4400 MiB;
adding sort reuse took 41.78 s / 3986 MiB. The windowed program meets the memory
limit after those interpreter changes.

An additional default run after rebasing onto `0f12d13b` took 32.59 s, peaked
at 2170 MiB, and returned the same answer. Its raw sample is
`integrated-euler.jsonl`.

## Verification and reproduction

- `npm run build` passed, including web/mobile builds and Capacitor sync.
- After rebasing onto `0f12d13b` (#445), 334 targeted interpreter tests passed
  in 14 files, including multidimensional numeric loop coverage.
- Both demo-exclusion registry tests passed; semantic boundaries checked 65 owners.
- The full test suite and whole-corpus audits were not run.

```sh
npm run build
node benchmarks/sort-memory.mjs --case=euler --samples=2
node benchmarks/sort-memory.mjs --case=sort --samples=2
node benchmarks/sort-memory.mjs --case=slice --samples=2
node benchmarks/sort-memory.mjs --case=conversion --size=10000000 --samples=2
```

To compare with an already built checkout, pass `--checkout=/path/to/checkout`.
The Euler case always uses the program's default input. Microbenchmarks accept
`--size`; every sample checks the resulting order, slice values, conversion
values, or full-program answer outside the timed section. Sort input uses a
fixed pseudorandom seed. Correctness tests also cover keys beyond the safe
Number and int64 ranges.
