# Dense sum-of-squares blocks (#348)

Measured on 2026-10-20 with Node v24.15.0 on an Apple M5. Baseline:
`46ee54c6`; timing candidate: the #348 worktree based on that commit, before integration
with the newer main branch. The Euler 311
algorithm and block size are unchanged.

Each block has 4,000,000 cells. Each sample runs in a fresh process, with an empty
execution before timing to initialize the parser. Accumulation includes array
allocation, loop compilation, numeric preparation and publication. Scan includes
its compilation and storage access. Three timing samples are separate from a
fourth diagnostic run. No test suite ran alongside these block measurements.

| Block | Baseline accumulation | Candidate accumulation | Baseline scan | Candidate scan | Baseline total | Candidate total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1..4,000,000 | 660 ms | 387 ms | 9162 ms | 174 ms | 9876 ms | 559 ms |
| 1,248,000,001..1,252,000,000 | 1009 ms | 409 ms | 9278 ms | 172 ms | 10336 ms | 593 ms |
| 2,496,000,001..2,500,000,000 | 639 ms | 303 ms | 5099 ms | 147 ms | 5738 ms | 451 ms |

These are medians per column, so phase medians need not sum to the total median.
The three blocks are 12.7–17.7 times faster overall. Each result is checked against
an independent native count: `1260903`, `4096664`, and `4503125`, respectively.
Diagnostics show two Number loops, no overflow and no typed unpacking for each
candidate block. The baseline compiles the inner `X` loop independently; it does
not interpret every increment.

Median process peak RSS was 218–221 MiB for the baseline and 249–250 MiB for the
candidate. This includes bootstrap and the independent reference calculation.
The write phase uses a temporary 32,000,000-byte Float64 buffer and a
4,000,000-byte changed-cell mask. The scan reads the packed integer buffer in
place, avoiding a second 32,000,000-byte numeric copy. Write staging increases temporary memory.

The final unchanged `B(10^10)` calculation returned **2466018557** in
**170.802 s** in one fresh-process verification run, without concurrent test
suites. It does not meet a 30-second full-program target; issue #348 describes a
30-second observation window, not that deadline. The full baseline was not timed.

Reproduce after building both checkouts:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/dense-sum-squares.mjs --baseline=/path/to/built/baseline --trials=3
node benchmarks/dense-sum-squares.mjs --full
```

Raw block samples, including diagnostics and peak RSS, are in
[the baseline file](baselines/2026-10-20-dense-sum-squares.jsonl).

Correctness coverage includes published checkpoints `49` and `38239`, independent
small-block counts, real powers and their errors, COW, bounds failures, partial
state, cancellation, unsafe Number replay and Int64 promotion. Retained
selections keep the publishing backend, because detaching them can poll
cancellation. Inspection and custom host polling retain their existing backend.
The existing Euler 150 benchmark also returns `-271248680` in 1.805 s in a
separate single timing sample, below its existing 5-second check.

Validation:

- `npx tsc -b tsconfig.build.json` passes.
- The ordinary interpreter suites pass: 238 files, 4730 tests. This run excludes
  `compiler-rejection.test.ts` and the separate `types`, `differential` and
  `nurikabe` audits. The audits were not run for this change.
- The excluded compiler-rejection suite has one existing failure: it expects one
  `tensor:unsupported-op:to` diagnostic and receives two. The same failure was
  reproduced on the unchanged baseline.
- The language suites passed 1186 tests with one 5-second timeout in
  `recursive-contract.test.ts` (`gridpath`). Its isolated rerun passed in 593 ms.
  The original full language run therefore was not clean.
- Semantic-boundary and application-form checks pass.

Integration onto `main` at `8731fffa` preserves its extracted indexed-write
module and index-read runtime helper. TypeScript build, semantic-boundary and
application-form checks pass. All 240 ordinary interpreter suites pass (4756
tests), including `compiler-rejection.test.ts`, whose existing fix is now in
main. The separate `types`, `differential` and `nurikabe` audits remain excluded.
A 4,000,000-cell block was rechecked after integration: `1260903`, two Number
loops, no overflow, and no typed unpacking. The full-program timing above was
recorded before this integration.
