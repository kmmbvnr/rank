# Nightly regressions, 11 November 2026

The public report compares `afc824b0` (9 November, 22:00 UTC) with
`e8247119` (10 November, 22:00 UTC). The latest run completed 1,427 workloads:
1,417 passed, nine libraries had no workload, and one dataset was missing.
There were no errors or timeouts. Across 1,401 unchanged successful workloads,
the geometric mean of time ratios is 0.9948. Individual regressions remain.

Repairs were developed against `1c22f6d8`, the starting checkout, and then
checked in frozen snapshots with `e397b730`, the concurrent array-selection
change. That change is preserved.
Demo sources and inputs are unchanged. The paired harness checks their hashes
and complete answers. Each measurement uses a fresh Node 24.15.0 process,
a 4 GiB heap, and timing after CLI imports. Local samples use Apple M5;
Intel samples use CPU 2 of `jack`, an i7-10750H. Each harness runs sequentially.

## Changes

The scalar Number guard now shares a small function instead of capturing a
function's compiler context. The overflow path still emits the same diagnostic
and replays exactly. Generated positional observation wrappers avoid rest-array
allocation on ordinary scalar calls while retaining tracing enabled after
preparation. These changes repair Euler 507 and reduce overhead in Euler 314
and 791.

Recursive exact callers now back off after unsafe Number arguments, as they
already did after numeric overflow. The speculative path is separate from the
exact call body. Tiny captured lookup helpers stay in the exact caller's ABI;
Number callers retain their numeric entry. Euler 505 and 452 exercise these
boundaries. Tests check recovery when inputs become small again and preserve
numeric calls from numeric callers.

Noncontiguous boolean axis reductions now prepare a shared tensor graph.
Euler 98 previously prepared about 37,000 separate folds after boolean equality
became fusible. The shared graph preserves per-cell short circuiting, deferred
errors, native identity guards and opaque-reader fallback. Contiguous boolean
ranges retain their existing path.

Binding completion now copies only the initialized prefix when a wide integer
requires ordinary storage. It previously widened and unpacked the full reserved
buffer, including unwritten cells. Once ordinary storage is selected, the reader
writes directly into it. Packed numeric collection does not poll a getter after
every cell. Euler 792 exercises the wide-integer transition; tests check early
and late transitions, read counts, missing cells and reader cleanup.

## Repeated repair measurements

These are medians of three alternating full-input pairs, comparing unmodified
`1c22f6d8` with the repair. Times are seconds. The final collector refinement was
checked in a separate integration series.

| Euler | Intel before | Intel repaired | Mac before | Mac repaired |
| --- | ---: | ---: | ---: | ---: |
| 98 | 5.035 | 1.529 | 1.208 | 0.380 |
| 150, control | 1.372 | 1.386 | 1.353 | 1.342 |
| 314 | 3.674 | 3.208 | 1.165 | 0.991 |
| 452 | 2.415 | 2.037 | 0.698 | 0.607 |
| 507 | 40.992 | 15.148 | 16.622 | 5.721 |

Euler 98's median Intel peak RSS changes from 485.5 to 202.2 MiB. Timing and
memory are separate outcomes; these repairs do not establish a general memory
reduction across all programs.

## Heavy workloads and remaining uncertainty

Single full-input pairs against `1c22f6d8` give these times:

| Euler | Intel before | Intel repaired | Mac before | Mac repaired |
| --- | ---: | ---: | ---: | ---: |
| 505 | 261.473 | 205.481 | 90.093 | 62.659 |
| 791 | 58.803 | 51.158 | 21.666 | 17.960 |
| 792 | 54.590 | 47.035 | 15.789 | 14.271 |

The Intel heavy series overlapped another task's benchmarks on the same host.
It supports a directional improvement, not a precise recovery claim.
A separate three-pair Intel check of Euler 505, with explicit input
`100000000000` instead of the default `1000000000000`, still takes a median
13.867 s versus 12.201 s at `afc824b0`: **13.7% remains unresolved**. The source
and result are identical. These repairs do not close every historical timing gap.

Single-pair historical checks did not reproduce Euler 150, 289 and 705's
reported slowdown on Intel. Euler 461 changed by about 7%, rather than the
reported 20%. Mac screening of 272, 733, 735, 739, 740 and 745 against `afc824b0`
was within 2% or faster after repair. These are screening results, not proof
that smaller regressions are absent on every architecture.

NYC Taxi's reported peak-RSS increase did not reproduce. For the historical
`afc824b0` / `e8247119` pair, Intel peak RSS was 3023 / 2191 MiB and retained
heap after collection was 118 / 79 MiB; Mac peak RSS was 3024 / 2426 MiB.
Taxi output hashes match within each architecture. The Intel pair took
233.6 / 269.6 s; this single timing pair remains inconclusive. For the final
collector repair, the Mac control pair took 55.20 / 55.72 s and peaked at
2332 / 2342 MiB. No taxi-specific source change was made.

Raw samples, historical report metadata, source hashes and measurement caveats
are saved in [the baseline archive](baselines/2026-11-11-nightly-regressions.json).

## Final integration check

A full-input pair in frozen `e397b730` snapshots, without and with the final
repairs, gives the following Mac results. This checks that concurrent array
selection changes and the final collector refinement retain the improvements.

| Euler | Before, s | Repaired, s |
| --- | ---: | ---: |
| 98 | 1.320 | 0.431 |
| 314 | 1.557 | 1.332 |
| 452 | 0.857 | 0.640 |
| 507 | 17.384 | 5.755 |
| 791 | 20.567 | 18.448 |
| 792 | 16.076 | 13.986 |

Euler 792's peak RSS in this pair falls from 1157 to 861 MiB.

The final isolated Intel collector check against `1c22f6d8` also preserves
the improvements (one full-input pair):

| Euler | Before, s | Repaired, s |
| --- | ---: | ---: |
| 098 | 5.994 | 1.840 |
| 791 | 60.172 | 53.254 |
| 792 | 54.221 | 42.719 |

## Verification

The final integrated Mac check passes 406 tests in 16 files, including compiled
selections. The earlier focused check passed 363 tests in 15 files. Four added assertions fail
on the original checkout: two shared boolean-column preparations, recursive
argument backoff, and avoiding a numeric round trip in an exact captured lookup.
The final collector refinement passes its 70 tests in four files. TypeScript,
semantic boundaries (13 tests and 65 owners), application forms and whitespace
checks pass. The full repository suite and exhaustive audits were not run.

The public report remains historical until another nightly run measures the
changes. No public report was replaced and no GitHub action was taken.

Repeat selected comparisons with:

```sh
CASES=098,314,452,507 ROUNDS=3 node benchmarks/experiments/nightly-2026-11-11.mjs BEFORE AFTER
```

The taxi harness takes a checkout, the existing train/test dataset directory,
and a separate output CSV path. `GC=1` with `--expose-gc` records the heap after
four event-loop turns and collections, outside the timed program. It never
replaces a published submission.

## Delivery on current main

The repairs were reapplied to `eac1a0fd` in an isolated worktree before
delivery. TypeScript compilation, 315 focused interpreter tests in 11 files,
semantic boundaries and application-form checks pass.

A fresh full-input Mac integration pair preserves the correct answers:
Euler 98 takes 1.200 / 0.378 seconds, Euler 507 takes 16.660 / 5.749 seconds,
and Euler 792 takes 15.220 / 14.351 seconds, before / after respectively.
Euler 792 peaks at 1222 / 836 MiB. This single pair is an integration check,
not a new repeated performance estimate; brief repository checks overlapped
the end of the series. The earlier alternating Mac and Intel pairs remain
the performance evidence. Raw integration samples are in
[the delivery archive](baselines/2026-11-11-nightly-main-integration.json).
