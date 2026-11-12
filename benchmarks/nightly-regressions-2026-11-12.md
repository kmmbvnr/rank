# November 12 nightly regression investigation

The completed public run started on November 11 at 22:01 UTC, at `dd8fcaf5`.
Its predecessor was `e8247119`. Both measured 1427 workloads on the same Intel
host and Node 24.15.0. Comparisons below require matching workload hashes.

## Reproduced failures and repairs

- Titanic was the only new non-success status. Ranked `real` conversion saw
  missing CSV cells before `default` filled them. A scalar ranked helper now
  fills and converts each cell together. This also handles integer columns
  whose median is real without first forming a mixed integer/real array.
- Euler 578 crossed the new 128-frame numeric self-recursion budget and
  repeatedly fell back to boxed execution. Direct numeric self calls use
  smaller frames than boxed calls. They retain a bounded 512-frame budget;
  the boxed bridge remains at 128. Logical depth limits, polling and exact
  replay remain in place.
- Euler 298 and 240 entered a broad boxed ownership loop after a Number
  overflow. Its per-cell general stores hid faster nested exact loops. A
  nested ownership candidate now retains the Number attempt but delegates
  fallback to independently compiled inner loops.

## Method

`experiments/nightly-2026-11-12.mjs` runs alternating fresh processes, verifies
source hashes and complete answers, and excludes CLI imports from elapsed
execution time. It records CPU time and peak RSS separately. Timed processes
use a 4 GiB JS heap. Profiles and diagnostic runs are separate from timings.

The main before/after comparison uses full inputs, three pairs on each host,
and frozen `dd8fcaf5` runtime snapshots. A separate historical comparison uses
`e8247119` to investigate smaller timing and memory changes.

Two additional historical regressions were reproduced:

- Euler 409's newly compiled array helper completed `A * B mod M` with a
  generated BigInt cell loop. Completion now uses the existing exact modular
  Int32 kernel when named completed inputs satisfy its guards. Deferred,
  opaque, shared, differently shaped and unsupported-modulus inputs retain
  the original generated consumer and error order.
- Euler 489's larger CLI peak RSS is reproducible on Mac. Reusing generated
  task locals looked promising in an interpreter-only probe but did not
  improve paired CLI measurements; that change was rejected. Investigation
  must retain the actual CLI setup and heap limit.

Euler 606 and 655 did not reproduce a slowdown in two alternating Mac pairs
against the actual previous nightly revision: medians were 34.743 / 34.268 s
and 5.552 / 5.518 s, respectively. This is not an Intel-specific explanation
or proof that every small nightly fluctuation is noise.


## Repeated results

Medians of three alternating process pairs. Times are seconds; all default
inputs and complete golden answers are checked.

| Workload | Mac before / after | Intel before / after |
| --- | ---: | ---: |
| Euler 240 | 0.283 / 0.143 | 0.820 / 0.354 |
| Euler 298 | 2.651 / 0.769 | 8.029 / 1.984 |
| Euler 578 | 30.160 / 7.706 | 94.133 / 22.209 |
| Euler 409 | 2.253 / 0.359 | 6.113 / 1.003 |

Euler 578 median peak RSS falls from 668 to 347 MiB on Mac and 584 to 322 MiB
on Intel. Euler 409 falls from 790 to 510 MiB on Mac and 804 to 474 MiB on Intel.
The 409 series also included the rejected task-local prototype; final integrated
runs verify the retained repairs with that prototype removed.

### Euler 489 memory qualification

A historical CLI comparison initially showed 569 / 996 MiB median peak RSS.
Interpreter-only probes and changed module-loading order did not reproduce
that difference reliably. Two historical CLI pairs with post-run GC recorded
950 / 979 MiB peak RSS, but only 65.4 / 61.8 MiB heap remaining after four GC
turns. With `--max-semi-space-size=16`, two pairs recorded 387 / 390 MiB peak
RSS and 44.3 / 44.7 MiB heap after GC. This does not establish a retained-memory
regression. The GC controls are diagnostic only; production settings are unchanged.
A smaller execution-time difference remains: 7.001 / 7.346 s with default
nursery sizing and 6.682 / 6.958 s with the fixed nursery. No speculative
compiler rollback is included for this approximately 4–5% difference.

Raw samples, including rejected experiments, are retained in
[the benchmark archive](baselines/2026-11-12-nightly-regressions.json).


## Final verification

The retained repairs pass 317 tests in 13 focused interpreter files, including
full Euler 578, 100,000-call recursion, error recovery, ownership aliases,
overflow replay, observable polling, suspension and arithmetic completion.
The TypeScript build, semantic boundaries (65 owners), application-form checks
and whitespace checks pass. Full npm test and exhaustive audits were not run.
Titanic produces 418 distinct passenger predictions, all binary.

A final one-pair integration check after removing the rejected task-local
prototype preserves all four full-input answers. Intel times before / after
are 0.776 / 0.354 s (240), 7.872 / 1.884 s (298), 6.112 / 1.102 s (409), and
96.062 / 21.091 s (578). Raw Mac integration samples are also archived.
These are integration checks, not replacements for the repeated estimates.

The public report is a historical run; it has not been overwritten with these
selective measurements. No issue or PR was created or updated.


Delivery rebases cleanly onto `4294b031`, the concurrent range-type CI fix.
The TypeScript build, application-form checks and all 317 focused tests pass
again on that base. A fresh Intel full Euler 578 run also checks the exact
answer after updating the language analysis module; its sample is archived.
