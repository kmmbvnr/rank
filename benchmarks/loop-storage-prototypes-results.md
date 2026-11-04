# Remaining loop-storage approaches: research prototypes

Historical report, preserved for #513. For current-baseline measurements and
selection decisions, see [the follow-up](speculative-storage-results.md).
The original installers below require the historical built-runtime layout; they
are not expected to patch the current interpreter.

Baseline: **1d4edd41**, the already accelerated current interpreter, not the old
64-cell-only backend. The motivating demo is **Euler 185, Number Mind**. Its
algorithm and input are unchanged. Euler 170, 186 and 166 are controls. Synthetic
cases isolate cold/sparse stores and overflow timing; they are not Euler rewrites.

**Disposition: retain the current default.** These prototypes expose useful
specialized tradeoffs, not a replacement that improves 185 across both hosts.
Only isolated copies of built runtime JS were modified. The production TypeScript
and interpreter behavior remain unchanged. No commit, push or issue update was made.

## Implemented prototypes and limits

| Variant | Implementation | Main boundary |
| --- | --- | --- |
| current | Shipped whole-buffer numeric attempt plus exact-work feedback and mixed-integer fallback | Existing default |
| pages | 512-cell software pages, copied at the first store; private per-page dirty bits; unchanged overflow rollback | Indexed integer/real/boolean cells; named vector iteration retains exact fallback |
| tierup | Exact prefix, then numeric execution within the same invocation | Pure conditional root loops; at least 512 loop checkpoints and a completed root iteration |
| checkpoint | Publish successful numeric chunks, continue via existing mixed or exact backend on overflow | Chunks of 8192 completed root iterations |
| combined | Exact prefix plus numeric chunks | Combines the two preceding policies |
| promote | Recompute an overflowing scalar operation using its original operands as BigInts and continue the same generated loop | Basic scalar integer arithmetic only |

The page size is a software granule: 512 Float64 cells (4 KiB) plus dirty bits,
not the OS virtual-memory page size. Private page reads use a Map and accessor
methods; dirty cells publish via scalar writers. Integer32 sources are borrowed
without unboxing. All existing entry/ownership/private-polling guards remain.
Unchanged readonly sources still use the ordinary conversion/cache path. A CoW
copy required by a user-visible retained alias is not eliminated by paging.

The three transfer variants are limited to conditional roots without callbacks,
return/yield, break/continue, vector traversal, local arrays or predeclared wide
scalars. Ordinary range/vector/other unsupported regions retain baseline execution.
Above 262144 total destination cells they retain the current admission policy.
`tierup`/`combined` use an exact prefix only for stores larger than 64 cells;
scalar/small-store loops start numerically. Transfer happens before the next root
body, after its pure condition has succeeded; the condition may be evaluated
again by the receiving backend. Observable host polling/execution callbacks
retain the ordinary path. Last-result carry, including zero-iteration resumes,
is preserved. Transient Rank results are cleared in finally, not cached.

`checkpoint` deliberately forces numeric entry for eligible loops to isolate
checkpoint execution. Its short-call penalty includes bypassing the shipped
admission policy, not just the chunk check itself. `combined` avoids that cold
copy with an exact prefix. A production integration could retain the shipped
feedback gate; that combination was not benchmarked here.

On numeric overflow, a chunk's private work is discarded and existing mixed or
exact execution resumes from the last published root boundary. At most one chunk
of *outer iterations* is replayed; work inside one large nested iteration is not
bounded by that count. This is not arbitrary expression-level deoptimization.

`promote` demonstrates operation-site continuation without a program-counter
transfer: helpers implement +, -, *, floor division and mod on canonical
Number-or-BigInt registers, recomputing with original exact operands when needed.
Safe BigInt results narrow back to Number to preserve generated comparisons.
It is limited to pure scalar condition loops without nested for loops, arrays,
native calls/builtins, control transfers or integer powers. Existing input guards
remain: a wide value present on entry uses the current fallback. Within the
supported region, no numeric attempt is rolled back. General array promotion
and arbitrary nested-frame deoptimization are **not** implemented by this proof.
The research selector is not a production capability audit: only the enumerated
basic-arithmetic source family is validated. Other scalar operations require
explicit rejection or audited widening before any integration into the compiler.

## Correctness and execution evidence

Both Apple M5/macOS arm64 and Intel i7-10750H/Debian x86_64 used Node **24.15.0**.
All modified runtime module hashes match across hosts. Server work remains under
`/tmp/rank-storage-prototypes-20261027`; its existing isolated Node installation
was reused. No system Node/service installation was changed.

Each host passes **56 scenarios across six variants: 336 observations per host**.
Normal cases compare full formatted variables, result and error with compilation
disabled on current. Special checks cover the execution callback and custom host
polling against the existing contract/current execution. Cases include transfer
boundaries, aliases and multiple destinations, exact/real result carry, partial
stores on bounds/division errors, wide stored cells, intermediate/late overflow,
negative wide floor/mod arithmetic, real/boolean arrays, vector/control fallbacks
and cancellation. These are targeted research checks, **not** a run of the full
ordinary interpreter suite against every experimental backend.

Separate diagnostics for the 20-million-iteration late-overflow case show:

| Variant | Numeric attempts | Mixed entries | Whole-attempt overflows | Additional evidence |
| --- | ---: | ---: | ---: | --- |
| current | 2 | 1 | 1 | Whole numeric attempt replayed by mixed backend |
| checkpoint | 2443 | 1 | 1 | 2442 successful numeric chunks; mixed suffix only |
| promote | 1 | 0 | 0 | One scalar promotion; no Rank-kernel restart |

Checkpoint retains the first **19996672** completed iterations and replays the
last **3328**. Promotion retains more work, but its per-operation type handling
can still cost more than the specialized chunked kernels.

[Verification records](baselines/2026-10-27-loop-storage-verification.json) ·
[Diagnostic records](baselines/2026-10-27-loop-storage-diagnostics.json) ·
[Hashes and timeout control](baselines/2026-10-27-loop-storage-controls.json)

## Primary comparison

Three serial fresh workers per case/variant/host, alternating job order;
225 workers per host. Parsing and full execution are timed; interpreter
construction and final golden validation are excluded. This agent did not launch
same-host builds, tests, profilers or other benchmarks concurrently. System-wide
background activity was not monitored. Times below
are median **milliseconds**. Completed workers all passed their golden checks.
Peak RSS is retained in the raw records; it is not retained-heap memory.

### Mac

| Case | current | pages | tierup | checkpoint | combined |
| --- | ---: | ---: | ---: | ---: | ---: |
| 185 | 692.77 | 1672.91 | 732.10 | 869.66 | 840.60 |
| 170 | 687.22 | 770.11 | 718.53 | 731.94 | 680.77 |
| 186 | 292.71 | 1315.40 | 295.71 | 312.80 | 317.95 |
| 166 | 1324.55 | 1320.62 | 1317.98 | 1280.23 | 1301.93 |
| short | 161.51 | 170.96 | 162.06 | 711.85 | 158.26 |
| long | 129.16 | 136.47 | 128.45 | 130.55 | 130.71 |
| phase | 181.05 | 308.30 | 139.79 | 210.66 | 210.26 |
| sparse-local | 123.88 | 108.90 | 121.84 | 129.42 | 126.24 |
| sparse-scatter | timeout* | 132.95 | 132.33 | 131.65 | 131.01 |
| sparse-many | 123.36 | 124.83 | 125.43 | 120.40 | 125.42 |
| dense | 106.95 | 136.36 | 115.44 | 107.25 | 116.78 |
| cold | 151.72 | 137.81 | 140.25 | 148.40 | 143.48 |
| register | 98.14 | 98.91 | 96.54 | 100.98 | 119.45 |
| early | 101.81 | 100.37 | 102.56 | 103.74 | 103.28 |
| late | 112.37 | 107.94 | 111.37 | 104.07 | 103.14 |

### Intel

| Case | current | pages | tierup | checkpoint | combined |
| --- | ---: | ---: | ---: | ---: | ---: |
| 185 | 1397.88 | 2807.58 | 1367.70 | 1548.94 | 1489.26 |
| 170 | 1461.94 | 1614.18 | 1458.76 | 1450.42 | 1469.63 |
| 186 | 651.84 | 2233.46 | 638.55 | 643.66 | 634.57 |
| 166 | 2666.55 | 2729.01 | 2659.84 | 2649.69 | 2683.71 |
| short | 384.87 | 406.24 | 373.21 | 1180.99 | 362.58 |
| long | 259.11 | 277.55 | 262.05 | 266.90 | 268.10 |
| phase | 367.11 | 707.96 | 352.92 | 482.32 | 494.76 |
| sparse-local | 318.76 | 295.62 | 311.84 | 320.32 | 314.56 |
| sparse-scatter | 323.92 | 322.24 | 330.73 | 334.67 | 325.50 |
| sparse-many | 314.80 | 323.61 | 318.83 | 326.63 | 319.37 |
| dense | 259.70 | 332.68 | 288.92 | 264.71 | 281.85 |
| cold | 383.54 | 367.90 | 361.66 | 385.24 | 368.42 |
| register | 244.83 | 244.54 | 248.61 | 244.63 | 248.51 |
| early | 255.70 | 253.41 | 255.94 | 264.61 | 262.46 |
| late | 265.76 | 276.40 | 284.79 | 251.80 | 257.03 |

*One Mac current/sparse-scatter worker reached the 120-second wall timeout; its
other two samples were normal. Five separate current-only retries all completed
in **124.23–127.05 ms** (median 125.63), and all Intel samples completed. The
outlier remains in the raw record. Its cause was not reproduced or identified;
it is not treated as evidence of an algorithmic hang or a paging speedup.

`short/long/phase` use the same 72000-cell workloads as the earlier feedback
study. `sparse-local/scatter` use 32 invocations of 4096 updates in a 1048576-cell
array, addressing either 64 adjacent cells or 256 distant cells. `sparse-many`
uses 2000 single-update calls. `dense` makes 32 full passes over 65536 cells.
`cold` has 80 distinct one-update loops over one 65536-cell store. Baseline already
avoids private cloning above its cap: the sparse page gain enables numeric
execution where current retains exact execution; it does not remove a full copy
that current was actually making in that case.

[Primary Mac records](baselines/2026-10-27-loop-storage-primary-mac.json) ·
[Primary Intel records](baselines/2026-10-27-loop-storage-primary-intel.json)

## Scalar promotion and overflow extension

The separate extension uses the same serial three-sample protocol, 96 workers
per host. `register/early/late` have 2 million iterations; `late-long` has
20 million. Early/late cross the safe Number boundary near the beginning/end.
`late-square` squares five times near the end, producing a roughly 200-digit
integer. Its arithmetic is unrolled to fit the scalar promotion capability.
The primary Mac run has higher absolute demo times than this later extension;
compare matched variants within each run, not cross-run absolute figures.

### Mac

| Case | current | promote | checkpoint | combined |
| --- | ---: | ---: | ---: | ---: |
| 185 | 572.41 | 571.04 | 670.35 | 628.72 |
| 170 | 534.13 | 534.82 | 533.49 | 537.92 |
| 186 | 259.64 | 254.88 | 255.98 | 257.38 |
| register | 95.31 | 101.03 | 98.43 | 100.35 |
| early | 99.23 | 123.30 | 101.09 | 103.12 |
| late | 109.87 | 100.06 | 103.06 | 103.52 |
| late-long | 238.15 | 195.45 | 152.62 | 156.48 |
| late-square | 109.25 | 102.85 | 103.52 | 100.89 |

### Intel

| Case | current | promote | checkpoint | combined |
| --- | ---: | ---: | ---: | ---: |
| 185 | 1352.81 | 1360.14 | 1542.17 | 1466.99 |
| 170 | 1445.56 | 1431.27 | 1452.90 | 1439.35 |
| 186 | 641.58 | 616.98 | 636.33 | 623.39 |
| register | 239.55 | 251.34 | 244.47 | 244.59 |
| early | 253.21 | 325.06 | 262.03 | 260.47 |
| late | 264.21 | 261.45 | 250.54 | 248.34 |
| late-long | 524.41 | 473.48 | 338.07 | 354.33 |
| late-square | 281.51 | 260.12 | 250.10 | 251.02 |

[Extension Mac records](baselines/2026-10-27-loop-storage-extra-mac.json) ·
[Extension Intel records](baselines/2026-10-27-loop-storage-extra-intel.json)

## Findings

- **Euler 185:** the existing backend remains preferable. The page prototype is
  about 2.4x slower on Mac and 2.0x on Intel. Repeated Map/accessor lookups and
  scalar publication add costs while its private store is already small; those
  components were not separately profiled. Transfer/checkpoint variants add
  overhead without overflow benefit here. Scalar promotion preserves baseline
  behavior because this array-based demo is outside its supported region.
- **Sparse stores:** software pages improve local sparse medians about 12%/7%.
  They lose on dense 186 by about 4.5x/3.4x, and on the dense synthetic workload.
  An unconditional page backend is not justified; an observed-sparsity selection
  policy and denser-page fast paths would be separate experiments.
- **Mid-call tier-up:** cold-loop medians improve roughly 8%/6%; most full demos
  are close to current or slower. This offers modest cold-entry benefits while
  requiring continuation/result bookkeeping and strict eligibility guards.
- **Checkpoint reuse:** 20M late-overflow medians improve about **1.56x/1.55x**.
  Full-buffer publication/preparation at every chunk costs time in normal array
  loops, including 185. This supports investigating selective checkpointing,
  not enabling unconditional chunking.
- **Operation-site scalar promotion:** the same late-long case improves about
  18%/10%, but early-overflow medians worsen about **24%/28%**, and all-safe
  scalar arithmetic has a smaller penalty. Avoiding replay alone is insufficient:
  specialized mixed kernels can be cheaper than universal arithmetic helpers.

The useful next candidates are selective paging for genuinely sparse large
stores and selective checkpointing for repeatedly late-overflowing hot loops.
Neither selection policy was implemented here. The committed work-feedback
policy remains the default; no single prototype is a general improvement for
185 or the control demos. A full typed-IR deoptimization implementation could
avoid some helper costs, but its speed is not established by these experiments.

## Reproduction

Build the interpreter first. The installer asserts known emitter anchors and
modifies only copies of `packages/interpreter/out`; it is intentionally a research
tool, not a production compiler extension. Keep runtime/dependency layouts equal.

```sh
node benchmarks/loop-storage-experiment.mjs --prepare=true --out=/tmp/rank-storage
node benchmarks/loop-storage-experiment.mjs --out=/tmp/rank-storage \
  --versions=current,pages,tierup,checkpoint,combined,promote --verify=true
node benchmarks/loop-storage-experiment.mjs --out=/tmp/rank-storage
node benchmarks/loop-storage-experiment.mjs --out=/tmp/rank-storage \
  --versions=current,promote,checkpoint,combined \
  --cases=185,170,186,register,early,late,late-long,late-square
```

Use `--samples=1 --diagnostics=true` for counters, separately from timing.
`--chunk=8192` is the prepared default; rebuilding copies with another chunk size
requires rerunning verification. The earlier 1024-iteration exploratory samples
are not used in the tables above. `--deadline` controls the parent wall deadline;
original runs used 120000 ms and the isolated sparse retry used 20000 ms.
