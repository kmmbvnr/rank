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
