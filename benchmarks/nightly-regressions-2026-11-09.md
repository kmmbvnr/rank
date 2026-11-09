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

## Step 3: exact scalar outputs after private vector stages

Euler 785 entered the Number region and overflowed its final scalar total
only after substantial vector work. It then repeated the region in the mixed
integer tier. Prefer exact scalar output registers for regions with private
vector stages when a scalar expression consumes their completed results.
Vector cells and vector reductions retain their existing numeric/exact tiers;
observable demand budgets retain their prior admission order. The full run
now enters one mixed region with no overflow replay, instead of two regions.

Three alternating Mac pairs: median 13,639.17 ms before, 10,071.66 ms after.
The preliminary Intel variant used exact outputs for all vector regions:
its three pairs are retained separately, not pooled with the final version.
The final policy avoids speculative mixed entry for empty vector reductions;
the existing empty-vector and overflow-replay tests remain unchanged.

The new scalar-output regression fails on unchanged main with one overflow
and passes with zero overflows and one mixed-region execution. All 198 tests
in vector exact reduction, vector stages, vector results, loop aliases and
axis sum pass on Mac. TypeScript build and semantic boundaries pass.
The full Euler 785 answer remains `29526986315080920`.

The final Intel pair is 31,073.48 ms before and 23,317.74 ms fixed. All 198
focused tests also pass on Intel. This restores performance close to the
older nightly's 22.28 s paired median; it does not claim a speedup over that
older version. Mac samples varied across rounds, and no samples were removed.

## Step 4: reuse numeric tensor code across changing shapes

The multidimensional gather path added in `5c2fd54d` compiled a new numeric
runner for each broadcast shape in Euler 750. Broadcast dimensions and source
bounds now bind separately from executable code. A bounded cache shares the
numeric runner across shapes; exact fallback remains shape-specific. The
cached closure retains only geometry numbers, never input storage.

Three alternating Mac pairs: Euler 750 median 5,764.44 to 3,937.13 ms;
Euler 420 control 679.84 to 679.71 ms. Complete answers match. Intel verification
is pending completion of the independent secondary regression measurements.

The new test checks runner identity across 43 changing shapes, every gathered
cell against a separate formula, cache bounds, and exact replay of wide cells
following warmup. It fails on unchanged main and passes with the fix. All 96
focused gather/copy/cache tests pass; build and semantic boundaries pass.
The broader checks also pass compiled integer collections. Four tensor-test
counter assertions fail identically on unchanged main: two in tensor-kernel
and two in tensor-broadcast-fusion. Their computation/error comparisons pass;
these pre-existing instrumentation expectations are not counted as new passes.

## Secondary candidates and step 5: numeric terms in exact modular sums

The investigation also covers unchanged successful workloads with 10–20%
nightly increases exceeding one second: 302, 362, 446, 447, 596 and 655.
Three alternating Intel pairs reproduced only Euler 596: 43,177.93 to
49,050.15 ms. Median changes for the other five were between -1.4% and +3.2%.
The paired harness now includes all fourteen investigated workloads.

A mixed integer loop in Euler 596 lowered the entire modular product/sum
through BigInt operations, losing the ordinary numeric compiler's fused
modular multiplication. Exact vector folds now reuse that numeric expression
compiler when their scalar inputs already occupy Number registers. Their
subtotals remain checked and flush to an exact BigInt total; failed cells
replay exactly. Wide scalar captures retain guarded narrowing and exact
fallback. This is shared expression lowering, with no Euler-specific rule.

The fixed full diagnostic run records 99,999,999 numeric fold cells and zero
BigInt cell fallbacks. Three alternating Mac pairs give medians 22,642.08 ms
before and 20,544.63 ms after, with answer `734582049` throughout. Intel
verification is running separately from tests. No algorithm or demo changes.

The focused check passes all 215 tests, including signed/large/zero moduli,
wide products, an independent BigInt oracle, and warmed budget/cancellation
checks. The new modular-fold test fails on unchanged main and passes with
303 numeric cells and zero exact cell fallbacks. Build and semantic boundaries
pass. Full suites and exhaustive audits remain unrun.
