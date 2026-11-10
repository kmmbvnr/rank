# Nightly regressions, 10 November 2026

The public report compares `563c31e3` (8 November, 22:00 UTC) with
`afc824b0` (9 November, 22:00 UTC). Both runs contain 1,427 workloads.
The latest has 1,416 successes, nine libraries without workloads, one missing
dataset and the existing Euler 566 timeout. No workload changed status.
Across 1,393 unchanged successful workloads, the geometric mean of time
ratios is 0.985. Individual regressions remain despite that overall decrease.

Timing candidates exceed both 10% and 500 ms. Twelve Euler workloads meet
that threshold; Kaggle Dogs vs Cats is checked separately with the same
image dataset and isolated output files. Memory candidates exceed both
15% and 50 MiB peak RSS. Changed workload hashes are excluded.

Repairs apply to current main `def74ea3`. Demo algorithms and inputs are
unchanged. Measurements use Node 24.15.0, fresh processes, a 4 GiB JS heap,
and timing after CLI imports. Intel samples run sequentially on CPU 2 of
`jack`, an i7-10750H. Mac samples run on arm64. The paired harness checks
source hashes and complete archived answers; CPU time and peak RSS accompany
every sample. The raw archive identifies each comparison's revisions.

## Repeated tensor shapes

Euler 670 regressed in three alternating Intel pairs from 2,654.9 to
3,447.5 ms. Its fixed-shape broadcast kernels lost constant strides when
numeric tensor code began sharing geometry across shapes. Runtime division
and remainder replaced operations that V8 could simplify using constants.

A tensor runner now specializes its geometry after eight numeric entries
with that shape. Changing shapes keep the shared runner. The specialized
runner retains only code and geometry, with the existing bounded code cache;
it retains no input buffers. Exact replay, destination alias guards and
shared-buffer restrictions remain in place.

Three repair pairs on Intel give 3,548.7 to 2,876.5 ms. The changing-shape
Euler 750 control remains 18,876.5 to 18,830.4 ms. On Mac the corresponding
medians are 991.4 to 843.2 ms for Euler 670 and 4,246.8 to 4,327.5 ms for
Euler 750. These are separate paired series, not pooled with the earlier
nightly-revision comparison. The warmup policy retains some startup cost.

The new regression checks constant-stride specialization after repeated
shapes and exact wide-integer replay after warmup. The existing changing-shape
check still shares one numeric runner across 43 shapes. The buffer-retention
test now warms the specialized broadcast path before checking collection.
The new specialization assertion fails on the unmodified nightly revision.

## Stores in fused vector bindings

Euler 729 reproduced a 12.2% increase on Intel: 52,528.6 to 58,953.3 ms.
Current main with the tensor repair still takes 59,417.2 ms in a separate
check. On Mac, disabling pointwise binding fusion changes 20,653.6 to
17,208.4 ms, localizing the regression to that emitter.

Fused bindings used the integer storage-promotion method for every output
cell. They now follow ordinary vector stores: real, boolean and proven Int32
outputs write directly; other integer outputs retain promotion. The tests
compare all observable variables and errors with both exact and interpreted
execution, check generated direct stores, and cover promotion beyond Int32.
The direct-store assertion fails on the unchanged compiler.

## Other candidates and limits

Single Intel triage pairs for Euler 507, 522, 524, 542, 614, 615, 623, 625
and 626 range from -4.3% to +2.6%. Euler 543's three paired medians change
from 4,336.1 to 4,254.1 ms. Their reported time increases do not reproduce.
Single pairs are screening evidence, not a tight bound on small changes.

Euler 606's nightly RSS increase from 760 to 1,365 MiB does not reproduce:
the Intel pair uses 740 and 770 MiB; the Mac pair uses 1,905 and 1,925 MiB.
Intel pairs for Euler 678 and 708 also use less RSS in the new version;
Euler 742 uses 268.7 and 269.6 MiB. Euler 699 initially repeats a larger
Intel peak (520 to 745 MiB). Two later alternating diagnostic pairs give
old/new RSS of 635.5/530.5 and 528.6/520.8 MiB. After four event-loop turns
and forced collections, old/new heaps are 52.7/47.9 and 47.9/48.4 MiB.
The apparent persistent increase does not survive repetition. Mac Euler
699 also has essentially equal collected heaps. These diagnostic runs
retain V8 space and code metrics in the archive.

RSS varies with platform and collection timing. No general memory-saving
claim follows from the two execution-time repairs.

The final combined Intel check passes 253 tests in 15 files. One full-input
integration pair gives Euler 729 60,031.8 to 53,611.2 ms, Euler 670
3,602.1 to 2,850.9 ms, Euler 750 19,142.2 to 19,134.1 ms, and Euler 552
10,515.2 to 10,530.4 ms. Complete answers match. This single final pair is
separate from the repeated tensor samples above.

Dogs vs Cats changes from 87,877.6 to 85,963.9 ms. Parent-process CPU time
is 18,692.3 and 18,772.6 ms; elapsed time also includes image loading and
external image processing. Output CSVs match byte for byte, with SHA-256
`145141b73231374022dcd641188aed5bfbac0fe08edb721d131a8ad91461a259`.
Use `experiments/nightly-2026-11-10-kaggle.mjs ROOT DATA OUTPUT` to repeat
against the same image dataset without replacing a published submission.

The final Mac store-repair series has three alternating full-input pairs:
Euler 729 changes from 20,836.1 to 18,247.1 ms; Euler 552 remains 3,524.9 to
3,519.1 ms. Both complete answers match throughout.

Two additional Mac diagnostic pairs for Euler 200, 248 and 742 enable
`--expose-gc` and measure the heap after the timed program. Collected heaps
are respectively about 38.6/38.7, 42.7/42.9 and 34.1/34.2 MiB for old/new.
Peak RSS overlaps between versions in these repeats. These observations do
not show increased retained heaps in those three workloads; they do not
prove a universal absence of memory regressions. Diagnostic samples remain
separate from performance samples and can be repeated with `GC=1`.

The Mac focused check passes 295 tests in 16 files, including Euler 552's
full answer in Number, exact and interpreted modes. TypeScript build,
semantic boundaries (13 tests, 65 owners), application-form checks and
benchmark harness syntax checks pass. The full repository suite and
exhaustive audits were not run. The public report remains historical until
a later nightly measures the repaired code.
The 148 verification samples, plus discarded experiments, are in
`baselines/2026-11-10-nightly-regressions.json`. The temporary Intel checkout
`/srv/rank-regression-1110` was removed after archiving and checking the data.
Repeat selected paired checks with:

```sh
CASES=670,729,750 ROUNDS=3 node benchmarks/experiments/nightly-2026-11-10.mjs BEFORE AFTER
```
