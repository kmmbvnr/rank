# Nightly regression investigation, 9 November 2026

The public report compares `2cdb203c` (7 November 22:00 UTC) with
`563c31e3` (8 November 22:00 UTC). Investigation starts from current main
`2177dc71` in an isolated worktree.

Eight unchanged successful Euler workloads increased by more than 20% and
500 ms: 417, 418, 419, 420, 455, 750, 777 and 785. These are candidates,
not established compiler regressions. No previously successful workload
newly failed. Euler 566 timed out in both reports; unavailable datasets and
libraries without companion tests are separate workload statuses.

The archived candidate measurements and environment are retained in
`baselines/2026-11-09-nightly-regressions.json`. Repeat the paired checks:

```sh
ROUNDS=3 node benchmarks/experiments/nightly-2026-11-09.mjs BEFORE AFTER
```

The harness alternates version order, uses fresh processes, verifies identical
source hashes and complete archived answers, and records elapsed time, CPU
time and peak RSS. Intel runs pin CPU 2. Timing excludes CLI imports, matching
the nightly runner. The initial comparison uses the exact two nightly
revisions; current main must be checked before selecting a repair.

Step 1 validation: harness syntax check, whitespace check and TypeScript
build after Langium generation pass. Paired measurement and compiler
investigation are ongoing. No performance fix is claimed at this stage.

## Step 2: preserve native recipes returned by compiled functions

Three paired Intel runs confirm regressions in Euler 750 (18.59 to 24.43 s),
777 (2.23 to 3.18 s), and 785. The other five candidates do not reproduce
material slowdowns. Full archived answers match in every completed sample.

Euler 777's compiled helpers returned opaque derived-array readers. Their
callers lost native tensor recipes, adding 4,863,408 interpreted cell reads.
For pure arithmetic return plans, the exact function compiler now constructs
the existing native array operations, keeping their fusion and packed storage.
Other plans retain the existing emitter. Demand, scalar-error and shape-error
locations, captured bindings and copy-on-write remain covered by tests.
No demo source or algorithm changes.

Three alternating fresh-process pairs for Euler 777:

| Host | Before median ms | Fixed median ms |
| --- | ---: | ---: |
| Mac | 987.50 | 536.62 |
| Intel | 3263.89 | 1905.98 |

Mac compares current main `2177dc71`; Intel compares the reported nightly
`563c31e3` against current main plus this fix. Raw samples identify both bases.
All runs return `2.533018434e23`. The fixed diagnostic run has no interpreted
computed cells. Measurements run separately from tests and profiling.

Step 2 validation: the new recipe regression fails on unchanged current main
(1,000 interpreted cells) and passes with the fix (zero). Mac focused checks
pass across function plans, numeric plans, real arrays and scalar kernels;
Intel passes all 112 tests in the six-file function-plan check, including
four returned-array error/alias/empty-result checks. TypeScript build and
semantic boundaries pass. Exhaustive audits and the full suite were not run.
