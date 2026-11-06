# Euler 747: fuse lazy root, mask and extrema stages

Issue: https://github.com/kmmbvnr/rank/issues/548

Limit=100000000, Prime=1000000007 and the answer `681813395` are unchanged.
The closed cubic, per-pair correction and row bounds are unchanged. The source
still has one loop and evaluates the same 214862802 pairs in 5000 rows. The
issue's "1e8 pairs" is approximate; 1e8 is the input Limit.

## Full-input measurements

Baseline: main `1d1be650`, with source frozen in `fixtures/euler747-original.ra`.
Node v24.15.0, Apple M5 arm64 macOS and Intel i7-10750H x64 Linux, normal CPU
affinity. One baseline and three serial final fresh-process runs per host.
Other load and frequency were not controlled; baseline variance was not
measured. End-to-end timings include parsing and execution. CPU time is
recorded separately in the raw JSON.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 15.27 | 6.84 / 6.87 / 6.75 | 2.23x | 3527.77 | 1392.63 |
| Intel | 39.86 | 17.76 / 17.80 / 18.18 | 2.24x | 1853.23 | 676.35 |

Every full run returned the same answer. Median peak RSS fell by 60.5% and
63.5%, respectively. RSS is the process high-water mark, not live array memory
or allocation volume. Mac final peaks varied from 921.06 to 1442.83 MiB;
Intel peaks varied from 633.82 to 899.09 MiB. Every final peak was below the
host's baseline. These samples do not establish stable distributions.

Raw primary files and medians are in `results/euler747/`. Exploratory samples
are retained separately in `exploration.jsonl` with their original filenames.
They are not pooled into the final series.

## Why compiler changes and source declarations are both needed

The original CPU profile at Limit=4000000 sampled stored unary maps, arithmetic
maps, comparisons, array assembly and GC. The original row keeps many eager
intermediate arrays; its first row alone has 25000000 entries. Its whole-loop
compiler attempt stops at the unary array isqrt operation.

The final implementation fixes the deferred tensor path:

- `isqrt` carries an internal native intrinsic recipe. Checked Number tensors
  call the existing safe-integer root helper; unsupported/unsafe inputs retain
  exact fallback. The scalar body and its native identity remain the proof.
- Core `integer` registers its existing pure scalar conversion and batch body.
  A boolean recipe may feed that conversion. The ordinary implementation,
  including SQLite conversion, remains intact. Unsupported source domains keep
  their existing demand, conversion and errors.
- Deferred `min`/`max` construction now uses their native numeric domains.
  Previously it consulted the symbolic arithmetic-operator table, where these
  native extrema have no signatures, so a nested clamp broke the graph.
- Rank-one checked Number reductions propagate bounded integer intervals from
  native, revision-checked array ranges and scalar constants. Interval arithmetic
  uses BigInt during preparation. An arithmetic guard disappears only when the
  full interval fits +/- (2^53-1). Unknown or unsafe intervals retain guards.
  Unsafe intervals are forgotten rather than grown through repeated squaring.
  The sum accumulator remains checked, and failures replay the exact consumer.

Input checks, native binding guards, source revisions, opaque readers,
inspection, observable polling, cancellation and demand-budget paths remain.
Real/large integer conversions and roots outside the safe domain retain exact
behavior. This adds no syntax or problem-specific operation.

The Rank edit then marks the existing intermediate stages with apostrophes.
They now form one graph consumed by `Piece sum`, rather than separate complete
arrays. Each row has one explicit input array, preserving the same progression;
there are no explicit chunks or root packets. Formulae and scalar BigInt cubic
arithmetic are unchanged. The full golden test records 5000 Number tensors
and zero intermediate computed cells.

This is not an upgrade-only speedup for the old eager program. With the new
runtime and the unchanged original source, single runs measured 15.30 seconds
on Mac and 37.89 on Intel, versus 15.27 and 39.86 at baseline. The source's
lazy declarations are required to expose fusion. No algorithm shortcut or
reduced domain contributes to the final comparison.

## Diagnostic and control measurements

Self-sample summaries are in `profile-summary.json`; full CPU profiles are not
committed. Diagnostic timings include instrumentation and are separate from
primary runs.

`experiments/euler747-tensor.mjs` compares the identical deferred program on
baseline and final runtimes over 65536 native range entries. Setup and parser
initialization precede timing; an independent integer sum checks the result
after timing. Each entry below is the median of three paired fresh-process runs.

| Program | Mac baseline / final ms | Intel baseline / final ms |
| --- | ---: | ---: |
| Root, boolean casts, clamp and sum | 72.80 / 16.24 | 191.05 / 39.49 |
| Existing linear arithmetic/sum control | 7.64 / 7.48 | 18.85 / 18.14 |

The newly admitted pipeline is 4.48x and 4.84x faster in this isolated control;
the existing arithmetic path stays effectively unchanged. These ratios are
not substituted for the smaller full-program speedup.

Exploratory alternatives were rejected: whole-loop unary admission first used
per-cell native calls (29.48 seconds on Mac); inline unary calls still retained
large vectors (12.82 seconds). The rejected patch is retained in
`experiments/euler747-unary-loop-rejected.patch`. A scalar-ranked helper was
slower at reduced input. Early incomplete lazy graphs fell back to ordinary
reads; one full experiment was terminated after its reduced run was already
slower. A complete fused graph before interval proofs measured 7.63 seconds;
the first bounded trial measured 6.76 seconds. All these exploratory samples
remain separate from the final series.

The final default graph and generated arithmetic kernel are unchanged by the
subsequent preparation-only cap on unsafe interval growth; that cap is covered
by a deep-DAG preparation regression test.

## Verification and reproduction

TypeScript build passed. On both Mac and Intel, 228 focused tests and the full
Euler 747 golden test passed. After integrating main ca1e18af (scalar-function
bounded division), the build, 252 focused tests and the full golden passed
again on Mac; that golden took 9.28 seconds. Intel's golden took 26.94 seconds
and predates the preparation-only cap; its final 228-test run includes the cap.
The integration does not change the measured default tensor path. Full suites
and exhaustive audits were not run.

Small-case correctness uses an independent enumeration of x, y and z, comparing
squared BigInts rather than computing roots, floors or ceilings. Both compilation
modes and two moduli are checked. The existing Limit=1000 example remains
172166601. Runtime tests cover nested casts/extrema, exact roots near Number
boundaries, wide/negative/empty values, shape changes, invalid text, snapshots,
range invalidation, shadowed builtins, opaque demand, budgets and deep unsafe
proof graphs. Existing conversion and SQLite suites also pass.

From the repository root after building:

```sh
EXPECTED=681813395 node benchmarks/euler747.mjs
RANK_SOURCE=benchmarks/fixtures/euler747-original.ra \
  EXPECTED=681813395 node benchmarks/euler747.mjs
DIAGNOSTICS=1 PROFILE=/tmp/euler747.cpuprofile \
  node benchmarks/euler747.mjs 4000000
RANK_ROOT=/path/to/baseline \
  node benchmarks/experiments/euler747-tensor.mjs roots
```

Focused tests, from `packages/interpreter`:

```sh
node scripts/test.mjs test/tensor-isqrt-conversion.test.ts \
  test/euler747.test.ts test/deferred-tensor-native.test.ts \
  test/deferred-real-tensor.test.ts test/plan-tensor-extrema.test.ts \
  test/integer-square-root.test.ts test/tensor-copy-storage.test.ts \
  test/conversions.test.ts test/numeric-conversion-evidence.test.ts \
  test/sqlite-plan.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t 747
```

A native range leaf could avoid the remaining explicit row input allocation.
That is a possible future compiler extension, not part of these measurements.
