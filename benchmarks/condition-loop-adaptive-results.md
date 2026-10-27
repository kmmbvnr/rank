# Adaptive condition-loop copy admission: experiment

Status: **historical periodic-probe experiment**. The subsequently implemented
policy is documented in [the work-feedback report](condition-loop-feedback-results.md).
Baseline: `5377955572a90910a635a84dc93f071def68b5e5`, Apple M5,
Node v24.15.0. All demo sources, inputs and golden assertions are unchanged.

## Question and variants

Can long condition loops use private Number buffers without paying for a full
array copy at every short invocation?

- Before: the existing 64-cell total destination limit.
- Fixed: raise that limit to 262144 cells; no feedback.
- Adaptive: retain the old path for up to 64 cells. Larger stores, up to a hard
  cap of 262144 destination cells, get a numeric probe. A separately generated
  probe runner counts loop checkpoints, including nested loops and final
  condition checks. If its count reaches the destination-cell count, admit the
  next invocation. Otherwise skip 32 subsequent entries, then at most 64 entries
  between probes. Failed preparation and overflow also consume a probe.

This is a heuristic comparison of cell copying and loop work, not a calibrated
cost model. Ordinary small-array/range runners have no work counter. Existing
safe arithmetic, private publication, CoW, polling and exact replay remain.
The prototype does **not** continue from the overflow point or reuse speculative
state after overflow. It still replays from the original inputs.

## Controlled results

Three serial fresh processes per case/version, alternating forward/reverse job
order. No builds, tests, profilers or other benchmark workers ran concurrently.
All three runtimes were built/copied into sibling temporary directories with the
same dependency resolution setup. Timing includes parsing and complete execution,
excludes interpreter construction and final validation. All golden assertions
passed in every completed worker; no deadlines were reached.

Median milliseconds; the last column compares adaptive with before:

| Case | Before | Fixed larger limit | Adaptive | Change |
| --- | ---: | ---: | ---: | ---: |
| 185 | 2478.65 | 558.91 | 577.26 | -76.7% |
| 185-test | 2533.18 | 609.95 | 620.77 | -75.5% |
| 170 | 548.16 | 554.20 | 548.42 | +0.0% |
| 179 | 577.99 | 566.34 | 567.81 | -1.8% |
| 23 | 375.68 | 385.07 | 385.83 | +2.7% |
| 125 | 195.51 | 200.00 | 196.30 | +0.4% |
| 166 | 1023.30 | 1012.98 | 1015.72 | -0.7% |
| 177 | 1367.49 | 1372.45 | 1386.10 | +1.4% |
| 60 | 2586.46 | 2600.69 | 2635.16 | +1.9% |
| 88 | 802.17 | 803.55 | 868.33 | +8.2% |
| 186 | 258.84 | 257.32 | 254.45 | -1.7% |
| short | 131.80 | 553.17 | 138.10 | +4.8% |
| long | 127.87 | 103.39 | 103.70 | -18.9% |
| phase | 791.68 | 145.51 | 667.27 | -15.7% |
| slice | 133.75 | 132.25 | 134.37 | +0.5% |

Cases 185, 170, 179, 23, 125, 166, 177, 60, 88 and 186 are the unchanged full
Euler demos. `185-test` is the actual full test fixture. Other cases:

- `short`: 5000 invocations, one update per invocation, a 72000-cell destination.
- `long`: three invocations, 72000 updates each, the same destination size.
- `phase`: 100 one-update invocations followed by 80 invocations of 72000 updates.
- `slice`: the existing stack/slice regression pattern at 72000 inputs, with
  a retained prefix snapshot at input 36000. A separate JS stack supplies its
  expected final depth. The other synthetic answers use direct arithmetic oracles.

Primary raw data: [timings](baselines/2026-10-27-condition-loop-adaptive.json).
Peak RSS is recorded before final validation; it is not retained heap size.

## Where admission actually changed

Separate diagnostics, excluded from the timings above:

| Case | Numeric entries before | Numeric entries adaptive | Probes | Probes reaching work threshold |
| --- | ---: | ---: | ---: | ---: |
| Euler 185 | 0 | 1 | 1 | 1 |
| Euler 170 | 10566 | 10566 | 0 | 0 |
| Euler 166 | 0 | 0 | 0 | 0 |
| Euler 179 | 0 | 0 | 0 | 0 |
| Euler 186 | 2 | 2 | 0 | 0 |
| short | 0 | 78 | 78 | 0 |
| long | 0 | 3 | 3 | 3 |
| phase | 0 | 20 | 20 | 17 |
| slice | 0 | 0 | 0 | 0 |

`short` skips 4922 copies out of 5000. It still pays for 78 probes and admission
checks. It avoids the fixed-limit variant's roughly fourfold slowdown, but is
not free compared with the original ban.

In `phase`, the probe schedule checks entries 0, 33, 98 and 163. Work increases
at entry 100, so the first 63 long calls still use the exact backend. Only the
last 17 long calls get the numeric backend. Bounding the cooldown helps but does
not solve phase-change latency. An initial prototype with exponential backoff
up to 4096 missed the entire long phase in this workload.

The slice case stays on one exact compiled outer region: it neither probes nor
copies per inner condition-loop entry. It is a control, not another adaptive win.

[Raw diagnostics](baselines/2026-10-27-condition-loop-adaptive-diagnostics.json)
were collected separately, with the adaptive runtime in its original workspace
location. Their elapsed times are not used for performance conclusions.

## Controls and limitations of timing attribution

An initial run compared temporary baseline/fixed runtimes with a workspace
adaptive runtime. Euler 166 appeared 6.9% slower, and five focused paired samples
still showed 1011.92 -> 1084.05 ms. No numeric loop or probe executed in this demo.
Moving the byte-identical adaptive runtime into a sibling temporary directory
changed the focused result to 1004.93 -> 1009.85 ms (+0.5%, overlapping ranges).
The normalized full run above gives -0.7%. This does not establish the cause of
the initial gap; it prevents attributing it to admission itself.

Euler 88 has an 8.2% slower median in the normalized full run. Five additional
paired samples gave 790.79 -> 792.55 ms (+0.2%, overlapping ranges), with one
1046.8 ms baseline outlier. Both measurements are retained. This is not proof
of a stable 8.2% regression, nor a guarantee that all controls are unaffected.
Small differences elsewhere are also not universal speedup claims.

Euler 185's normalized median peak RSS is 296.39 -> 243.75 MiB. This is a
whole-process peak measurement, not proof of lower retained algorithm storage.

[Raw control records](baselines/2026-10-27-condition-loop-adaptive-controls.json)
include both the initial placement comparison and the focused follow-ups.

## Verification and disposition

The patched prototype passed the TypeScript project build, interpreter test
typecheck, semantic-boundary checks (65 owners), application-form checks,
and **8909 ordinary interpreter tests in 394 files**. The ordinary selection
excludes exhaustive types, differential and Nurikabe corpora. Seven new tests
compare complete variables and errors with both reference execution and the
exact compiled backend: repeated probes, long calls, phase changes, large-store
cap, empty loops, CoW aliases, overflow replay and partial errors.

The default runtime and existing tests were restored afterwards. Every common
built runtime JS file was checked against the baseline byte-for-byte. The
candidate is preserved as [an applicable patch](experiments/condition-loop-adaptive.patch),
including its tests; the [benchmark](condition-loop-adaptive.mjs) is standalone.

Do not enable this prototype by default yet. Euler 185 strongly benefits, while
short calls retain measurable overhead and phase changes are recognized late.
A next experiment should learn work from the exact fallback itself, so a short
phase does not require periodic full-store copying and a long phase can be
recognized after its first exact invocation. Continuing at overflow would be a
separate compiler change, requiring precise deoptimization boundaries.

## Reproduction

Build the baseline and save its `packages/interpreter/out` directory. Apply
`benchmarks/experiments/condition-loop-adaptive.patch`, rebuild, and save the
adaptive `out`; reverse the patch and rebuild to restore the baseline. For the
fixed variant, copy baseline `out` and replace the single `> 64)` destination
budget test in `number-loop-runtime.js` with `> 262144)`.

Place all three runtime copies in sibling directories with access to the same
`node_modules`. Do not compare a workspace runtime with a temporary copy without
also checking the placement effect. Then run:

```sh
node benchmarks/condition-loop-adaptive.mjs \
  --before=/path/to/before/index.js \
  --fixed=/path/to/fixed/index.js \
  --adaptive=/path/to/adaptive/index.js
```

Use `--samples=1 --diagnostics=true` for separate counters, or
`--versions=before,adaptive --cases=185,short,phase` for a focused comparison.
The benchmark requires explicit runtime paths so it cannot accidentally compare
three copies of the current default under different labels.
