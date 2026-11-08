# Nightly regressions, 8 November 2026

The public report compares the runs started at 2026-11-06 22:00 UTC
(`7963a7e5`) and 2026-11-07 22:00 UTC (`2cdb203c`). These are the
7 and 8 November runs in Asia/Almaty. Runtime investigation and fixes start
from `d29bf10e`, which also includes changes newer than the report.

There were 1,265 matching successful workloads with both times at least
100 ms. Of those, 345 were over 10% slower, 45 over 20%, and eight over
30%. The median ratio was 1.022. The dashboard colors single increases
above 10% red; these are observations, not statistically established
regressions. No previously successful workload newly failed. All 56 errors
were pgexercises database-open failures already present in the older run.

## Runtime causes

Euler 580 exposed repeated unsuccessful Number-loop admission. The newer
compiler could prepare an inner loop, but its destination snapshots were
too large for the work it proved. All 30,725 attempts declined. Cost proof
preparation repeatedly ran general expression analysis for scalar bounds,
a materialized index array and a Boolean-to-integer conversion. A separate
Mac diagnostic run attributed 3,818 ms to these attempts; instrumentation
counted 135,600 analyses each of the index-array expression and conversion.

Prepare literal/name/unary scalar readers, Boolean conversion and range
cardinality once. Materialized arrays cannot supply scalar integer facts.
Prepare range/prime readers outside the vector-entry callback. Cache the
ordinary range-shape analysis by its guarded scalar inputs, including stride;
changed inputs recompute it. Array mutation, builtin identity, budget,
overflow and copy-admission guards remain in force. A later diagnostic run
spent 298 ms in the same 30,725 attempts; diagnostic timings are separate
from the primary samples and were taken under varying Mac host activity.

A second problem was dispatch order: the native integer-sum interpreter
ran before an already supported compiled tensor reduction. In Euler 580 it
replaced 25 compiled numeric reductions with 50 million interpreted cells.
Prefer the compiled arithmetic fold when available and compilation is enabled.
Reference execution and unsupported trees, including floor division, retain
the native interpreter. The diagnostic run again records 25 numeric tensors.
An experimental single-operation native-sum shortcut only repaired a small
part of the slowdown and is not included.

The Rank demo sources and algorithms are unchanged. Reverting computed-array
buffer narrowing and removing compact GCD dispatch did not repair the Mac
controls; neither experiment is included.

## Repeated triage on Intel

Three fresh processes per version, alternating order, CPU 2, Node 24.15.0.
Compare the previous nightly revision with the investigation base. Every
complete answer matched the archived output.

| Euler | Previous median ms | Base median ms | Change |
| --- | ---: | ---: | ---: |
| 150 | 1,530 | 1,526 | -0.3% |
| 201 | 843 | 1,106 | +31.3% |
| 026 | 444 | 451 | +1.5% |
| 547 | 6,017 | 5,135 | -14.7% |
| 543 | 4,445 | 4,342 | -2.3% |
| 238 | 13,280 | 13,223 | -0.4% |
| 580 | 29,614 | 41,773 | +41.1% |
| 680 | 75,999 | 75,391 | -0.8% |

A separate full Euler 715 pair was 153,326 versus 153,799 ms on Intel, with
answer 883188017. Its nightly +24.7% did not reproduce. Euler 201 varied
substantially across later fresh processes, including about 0.8 and 1.1 s
on unchanged builds. The final controls below retain all samples; no
workload-specific optimization or timing cutoff hides that variation.

## Nightly infrastructure

The installed shell wrapper was older than the repository version and lacked
the pgexercises dataset setup. The wrapper now replaces itself atomically
after pulling main, for use on the next invocation. Updating an older
installation still requires a one-time wrapper installation.

A missing SQLite file in an existing directory previously produced an
unqualified SQLITE_CANTOPEN error. The CLI now preserves ENOENT with the
path; existing invalid databases still report their SQLite error. The
runner's existing missing-dataset classification then produces `no-data`.
After importing the official club dump, all 62 runnable pgexercises cases
passed locally; nine libraries have no standalone workload. Historical
reports are not rewritten.

New worker results and metrics include CPU time over the measured interval
and peak process RSS, including imports. Demo details display these values.
Old records remain valid without the optional fields. These measurements
help diagnose waiting and allocation changes; they do not remove frequency,
cache, memory-bandwidth or unrelated-host-work effects.

## Reproduction and validation

Build independent checkouts, then run the alternating harness:

```sh
CASES=580,201,150 ROUNDS=3 node \
  benchmarks/experiments/nightly-2026-11-08.mjs BEFORE AFTER
```

The harness verifies identical source hashes and full answers, excludes CLI
imports from elapsed/CPU time, and records process peak RSS. Intel uses CPU 2;
Mac has no fixed affinity. Each sample is a fresh process with a 4 GiB JS heap.
No samples are discarded. CPU/GC scheduling and other activity are not
controlled. This was a focused investigation, not a rerun of the entire
nightly corpus. Full suites and exhaustive audits were not run.

Raw triage, controls, diagnostics and final samples are in
`baselines/2026-11-08-nightly-regressions.json`.

## Final paired measurements

Medians of three fresh processes per version, before integration with newer
main commits. All full answers match. RSS is process peak, including imports.

| Host / Euler | Base ms | Fixed ms | Base RSS MiB | Fixed RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / 150 | 1,513.58 | 559.06 | 239.25 | 239.34 |
| Mac / 201 | 437.80 | 448.72 | 323.28 | 325.73 |
| Mac / 580 | 12,707.60 | 9,420.91 | 545.52 | 546.34 |
| Intel / 150 | 1,528.35 | 1,526.31 | 226.69 | 226.60 |
| Intel / 201 | 896.72 | 976.28 | 304.24 | 304.38 |
| Intel / 580 | 41,683.56 | 31,084.41 | 542.33 | 497.52 |

The Mac 150 improvement did not transfer to Intel. Euler 201 remains noisy;
its final medians do not reproduce the initial nightly increase. Treat the
580 result as the demonstrated runtime repair. The source algorithm was not
changed.

After integrating main at `488f9aa2`, the focused interpreter checks passed
185 tests on both Mac and Intel. The Intel nightly/SQLite checks passed all
12 tests. TypeScript build, semantic boundaries and application forms checks
passed. A full Euler 580 check on the integrated revision returned the exact
answer on both hosts: 9.36 s on Mac and 30.44 s on Intel. These single checks
confirm integration; the table above remains the paired performance evidence.
