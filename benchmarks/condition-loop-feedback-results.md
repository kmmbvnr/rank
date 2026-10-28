# Exact-loop work feedback: Mac and Intel experiment

Status: **implemented as the default guarded Number-loop admission policy**.
Baseline: `5377955572a90910a635a84dc93f071def68b5e5`.
This follows the [periodic-probe experiment](condition-loop-adaptive-results.md).
No demo source, algorithm, input, golden assertion or repository test deadline changed.

## Policy

The first bounded numeric probe remains, preserving the one-shot Euler 185 win.
Destinations up to 64 cells retain the ordinary fast path; probes are limited to
262144 destination cells in total. Numeric probes count loop checkpoints. A
successful invocation whose checkpoint count reaches the destination-cell count
admits the next numeric invocation. A short or failed probe declines further
copies until exact execution supplies evidence of sufficient work.

The exact backend lazily compiles a counted runner for these declined regions.
It writes through its existing exact stores and records work only on normal
completion. Reaching the same threshold permits the next numeric invocation;
short calls remain exact without periodic probe copies. The shared per-region
feedback contains only a cell count and admission flag, never Rank values or
cached results. Small-store and proven full-pass runners have no work counter.
Existing ownership, safe arithmetic, cancellation, private publication and exact
replay guards remain. This does not resume from the point of overflow: numeric
overflow still discards private work and replays with BigInt.

Checkpoint counts include nested iterations and final condition checks. They
are a heuristic for amortization, not a calibrated CPU cost model. Promotion
happens between invocations; one long exact call is needed to discover a new
long phase after a short phase.

Euler 253 extended this policy to leaf range iterators: short ranges must not copy
an entire large destination on every call. A range whose guarded scalar bounds
prove a complete pass keeps Number execution, including above the probe cap.
Early exits and unknown bounds use the same measured-work feedback as short
vectors. Nested range regions retain their previous admission pending a work
estimate that accounts for their inner loops. See [the comparison](euler253-investigation.md).

## Controlled timings

- Mac: Apple M5, macOS arm64, Node **24.15.0**.
- Intel: `root@jack.lan`, Core i7-10750H, Debian x86_64, Node **24.15.0**.
  The system Node 20.19.2 is below the repository's >=22.12.0 requirement. An
  official Linux Node archive was checksum-verified and unpacked under
  `/tmp/rank-feedback-20261027`; the system Node and services were unchanged.
- Each host ran 135 serial fresh workers: 15 cases, three versions, three samples.
  Forward/reverse ordering alternates. No same-host tests, builds, profilers or
  other benchmark workers ran concurrently with the primary timings.
- Versions were placed in sibling temporary directories with equivalent package
  metadata/dependency access. All four changed runtime JS module hashes match
  between hosts for all versions; Intel also built baseline/feedback from source.
- Time includes parsing and full execution, excludes interpreter construction and
  final validation. Every worker's golden checks passed; no worker timed out.

Median milliseconds. `probe` is the previous periodic-copy policy; `feedback` is
this experiment. The ten numbered cases are unchanged full Euler demos;
`185-test` is the actual full fixture. The four synthetic/regression cases are
defined in the [first report](condition-loop-adaptive-results.md).

| Case | Mac before | Mac probe | Mac feedback | Intel before | Intel probe | Intel feedback |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 185 | 2513.57 | 577.37 | 590.93 | 5886.03 | 1419.56 | 1413.82 |
| 185-test | 2529.57 | 618.90 | 615.34 | 5983.71 | 1481.18 | 1496.67 |
| 170 | 560.97 | 553.00 | 552.75 | 1466.39 | 1468.87 | 1472.71 |
| 179 | 556.68 | 672.20 | 568.76 | 1587.13 | 1550.26 | 1597.03 |
| 23 | 388.99 | 382.76 | 391.03 | 840.93 | 843.00 | 854.29 |
| 125 | 193.19 | 196.12 | 194.63 | 533.92 | 520.00 | 554.76 |
| 166 | 1034.36 | 1054.18 | 1103.57 | 2692.66 | 2770.70 | 2676.85 |
| 177 | 1392.95 | 1399.56 | 1388.28 | 3530.52 | 3503.90 | 3602.25 |
| 60 | 2656.77 | 2669.97 | 2673.69 | 8178.61 | 8153.93 | 8337.18 |
| 88 | 978.34 | 978.70 | 986.87 | 2511.11 | 2451.73 | 2503.61 |
| 186 | 257.14 | 257.31 | 258.04 | 645.62 | 673.64 | 633.59 |
| short | 131.12 | 141.91 | 129.63 | 390.18 | 399.75 | 379.90 |
| long | 128.08 | 103.45 | 103.87 | 338.46 | 261.06 | 259.61 |
| phase | 802.58 | 667.37 | 145.38 | 2216.60 | 1839.64 | 366.55 |
| slice | 135.01 | 134.16 | 134.34 | 340.83 | 348.82 | 334.81 |

Euler 185 improves **4.25x on Mac and 4.16x on Intel** relative to the original
64-cell limit. The phase-change workload improves **5.52x and 6.05x** respectively.
Short-call medians are -1.1% on Mac and -2.6% on Intel, with overlapping ranges;
these samples do not establish a short-call speedup. The earlier measurable
periodic-copy penalty is absent from these samples.

Euler 185 median peak RSS: **291.38 -> 242.30 MiB** on Mac,
**266.36 -> 225.53 MiB** on Intel. These are whole-process peaks, not retained
array sizes; the algorithm and its table sizes are unchanged.

[Raw Mac timings](baselines/2026-10-27-condition-loop-feedback-mac.json) ·
[Raw Intel timings](baselines/2026-10-27-condition-loop-feedback-intel.json)

## Work and copying

Separate diagnostics agree on both hosts:

| Case | Prior-policy numeric copies | Feedback numeric copies | Exact sampled calls | Exact promotions |
| --- | ---: | ---: | ---: | ---: |
| 185 | 1 | 1 | 0 | 0 |
| 170 | 0 probes; 10566 ordinary numeric entries | same | 0 | 0 |
| short: 5000 one-update calls | 78 | **1** | 4999 | 0 |
| long: three full passes | 3 | 3 | 0 | 0 |
| phase: 100 short, then 80 long | 20 | 80 | 100 | 1 |

For the phase change, feedback uses one short numeric probe, 99 short exact
calls, one long exact call, then 79 long numeric calls. The prior policy spent
63 long calls on the exact backend before its next periodic probe.

[Raw diagnostic counters](baselines/2026-10-27-condition-loop-feedback-diagnostics.json)
are excluded from the timing table.

## Controls and remaining concerns

This is not a universal no-regression claim. Mac Euler 166 is **6.7% slower** in
the full run; five additional paired samples give **1022.45 -> 1085.26 ms (+6.1%)**,
with overlapping ranges and a bimodal feedback distribution. That demo does not
execute a numeric loop/probe in the diagnostic control. That earlier gap was not causally isolated; the additional module-by-module
control below retains both slow and fast observations.
Intel Euler 166 is -0.6% in its full run. Other control medians vary, including
Intel Euler 125 at +3.9%; all raw samples are retained.

The initial probe still copies a large store even if its first call is short.
Many distinct cold regions, or repeated numeric overflow after a long exact
call, can still waste work. The cell cap is deliberately retained. These remain limits of the delivered heuristic.

### Module-by-module Euler 166 follow-up

Three additional serial fresh processes per variant, alternating order; diagnostics
were disabled. Each isolated variant replaces exactly one baseline module with its
feedback counterpart. All answers remained 7130034.

| Runtime variant | Median ms | Samples ms |
| --- | ---: | --- |
| Baseline | 1098.32 | 1100.3, 1022.8, 1098.3 |
| Full feedback | 1084.21 | 1084.2, 1022.1, 1090.4 |
| Diagnostics module only | 1028.31 | 1028.3, 1102.6, 1021.8 |
| Exact runtime module only | 1026.83 | 1009.5, 1090.7, 1026.8 |
| Number runtime module only | 1084.81 | 1084.8, 1020.6, 1108.8 |
| Loop planner module only | 1025.61 | 1021.3, 1031.5, 1025.6 |

Both baseline and feedback enter the roughly 1.02 s and 1.09 s ranges. No single
module uniquely explains the earlier +6% median; in this run full feedback is
1.3% faster than baseline. This does not invalidate the earlier measurements or
establish zero regression. An allocation/JIT effect is a possible explanation,
not a demonstrated cause. Separate GC traces had 38 events / three major GCs in
both versions, so the investigation did not identify an extra full collection.

[Raw ablation samples and exact module hashes](baselines/2026-10-27-euler166-feedback-ablation.json)
are retained alongside the prior paired/full runs. This follow-up is a bounded
investigation, not an exhaustive survey of V8 behavior.

## Verification

- Both hosts: project build, interpreter test typecheck, semantic boundaries
  (65 owners) and application-form checks pass. Native CLI install hooks were
  not needed for the tested arithmetic/diagnostic paths.
- Mac: **8911 ordinary tests in 394 files pass**, 98.68 seconds. **173 focused
  tests pass**, including nine feedback cases. They compare complete variables
  and formatted errors with reference execution and exact compiled execution:
  short/long/repeated phase changes, aliases, overflow replay, errors during exact
  sampling, empty loops and the large-store cap.
- Intel initial broad run: **8907/8909 pass**, 254.18 seconds. One CLI diagnostic
  failed because only interpreter/language had been built; the CLI/common
  workspaces were then installed/built. Euler 044 exceeded its explicit 15-second
  test deadline under the four-worker suite.
- After that setup correction and adding the two final feedback tests, Intel's
  focused selection passes **222/223**, including all feedback and diagnostic
  cases; only the same Euler 044 deadline fails (15.54 s). No deadline was changed.
- Isolated original Vitest test, one worker: **baseline passes in 13.887 s**;
  **feedback passes in 14.614 s**, both with the original 15-second deadline.
  These are single checks, not a comparative benchmark. The broad Intel run is
  not reported as clean.
- Separate fresh-process Euler 044 reference/compiled checks validate all original
  result assertions and the 4401 compiled calls: baseline **6.588 / 0.486 s**,
  feedback **6.398 / 0.494 s**. These single measurements also do not establish
  a speedup; they verify the full computation outside Vitest.
- The ordinary selection excludes exhaustive types, differential and Nurikabe
  audits. They were not run on either host. The full Euler demos were checked
  directly by the benchmark on both hosts despite existing corpus exclusions.

[Control records, hashes and verification excerpts](baselines/2026-10-27-condition-loop-feedback-controls.json)
retain failures as well as successful follow-ups. The full logs and isolated
builds are under `/private/tmp/rank-feedback` on Mac and
`/tmp/rank-feedback-20261027` on Intel.

## Reproduction and disposition

The implementation now lives in the interpreter. The historical
[feedback patch](experiments/condition-loop-feedback.patch) reproduces it from
the baseline; do not apply it to current main or on top of the earlier probe
patch. Both archived variants include their own focused tests. Build each version into a sibling directory with the
same dependency access and package type metadata, then run:

```sh
node benchmarks/condition-loop-adaptive.mjs \
  --versions=before,probe,feedback \
  --before=/path/to/before/index.js \
  --probe=/path/to/probe/index.js \
  --feedback=/path/to/feedback/index.js
```

Use `--samples=1 --diagnostics=true --cases=185,170,short,long,phase` for separate
counters. The earlier experiment restored the baseline afterwards; the delivery
now enables the feedback implementation. Its four executable runtime module
hashes match the version measured on Mac and Intel. Demo sources, inputs,
assertions and configured test deadlines remain unchanged.

Other implementation directions have not been prototyped or benchmarked here:
page-granular speculative stores, exact continuation at the overflow point, and
mid-loop tier-up from exact execution without an initial numeric probe. The
four compared policies are not an exhaustive search of those designs.
