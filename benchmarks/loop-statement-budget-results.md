# Loop statement budget (#419)

Apple M5, Node v24.15.0, baseline `f0bae25a`. Each timed sample runs in a
fresh process after a 1,000-iteration warmup. Timings include parsing; diagnostics
run separately. The body has repeated assignments to one variable and a final
accumulation, with 2,000,000 iterations. Every run checks the result against the
integer sum formula. Values below are medians of three samples, in milliseconds.

| Body statements | Baseline | Candidate | Speedup |
|---:|---:|---:|---:|
| 32 | 81.71 | 48.27 | See control below |
| 33 | 8926.66 | 48.66 | 183x |
| 40 | 9729.37 | 53.94 | 180x |
| 100 | 33920.98 | 109.25 | 310x |

The candidate records one compiled Number loop for every size. Baseline records
one at 32 statements, and `loop:statement-budget:ForStatement` above 32.
Candidate time per statement at 33, 40 and 100 is within 2x of its 32-statement
case. The 100-statement preparation takes 13.15–13.85 ms excluding parsing;
this includes validation, compilation and one iteration, so it is an upper bound
on compilation time rather than a compiler-only measurement.

For 32 statements, a separate alternating-order control gives baseline
55.53–73.90 ms and candidate 49.10–72.16 ms (medians 68.88 and 56.52 ms).
The generated source is byte-for-byte identical between baseline and candidate
for this case. These timings show no observed regression; they do not establish
a speed improvement for bodies that already compiled.

The second change adds the opt-in CLI flag `rank --diagnostics program.ra`.
An alternating-order CLI control with the same 100-statement workload checks
identical stdout and `compiledLoops: 1`. Whole-process times, including Node
startup, are 608–773 ms normally and 611–1016 ms with diagnostics (three samples
each). No speed improvement is claimed for this reporting feature.

Validation: `npm run build`; 430 tests in `integer-loop.test.ts` and
`number-loop.test.ts`; four CLI tests in `diagnostics.test.mjs`. New tests cover
distinct variables, 33/40/100/128 statements, flat and nested budget overflow,
partial writes and error locations, argument forwarding, stdout/stderr separation
and diagnostics after runtime errors. No full test suite or corpus audit was run.

Reproduce after building the candidate and a separate baseline checkout:

```sh
node benchmarks/loop-statement-budget.mjs --baseline=/path/to/baseline/packages/interpreter/out/index.js
```

Raw samples: [main comparison](baselines/2026-10-23-loop-statement-budget.jsonl)
and [32-statement and CLI controls](baselines/2026-10-23-loop-statement-budget-checks.jsonl).
