# Euler 414: eliminate ownership-only traversal frames

This is a compiler-only follow-up to [the Euler 414 delivery](euler414-followup.md).
The Rank program, arithmetic checks, Number admission policy, copy-on-write
rules and reference interpreter are unchanged.

## Cause and change

Preparing a destination array for ownership previously triggered outlining
of its loop even when the body contained only arithmetic and stores. The
emitted persistent traversal function received the caller's complete frame.
For Euler 414's path backfill that meant 93 fields, with register packing and
unpacking on both sides of the call, despite a two-statement Rank loop body.

A sampled Node CPU profile attributed approximately 48% of CPU time to those
frame transfer lines (8.137 of 16.932 sampled seconds). This is a line-sampling
estimate from one Mac run, not a universal exact fraction. The initial
experiment edited generated JS; the delivered change is in normal lowering.

Ownership preparation no longer independently triggers outlining. Arithmetic
loops stay in the caller with their normal setup and scoped result handling.
Loops that compose calls still use the existing persistent traversal policy.
All ownership guards, bounds checks, overflow replay, cancellation and partial
state publication remain. No new size threshold or Euler-specific rule was
introduced. We did not remove persistent traversal support globally or change
its frame layout.

## Full Euler 414 measurements

Baseline: `c0c9a634`, with an archived interpreter build made before editing
`integer-loop-statements.ts`. Both variants run the same delivered Rank source.
Node v24.15.0, parsing included, imports excluded, diagnostics enabled.

Three alternating fresh-process pairs per host are reported. The first local
pair overlapped a targeted test process at startup, so it is retained as an
excluded observation; one additional pair replaced it. The targeted test
selected no matching case, but its runner startup still contaminated timing.
The other pairs ran serially per host. Other machine activity was uncontrolled.

| Host | Before median | After median | Before median peak RSS | After median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 16.530 s | 6.664 s | 303.5 MiB | 266.2 MiB |
| Intel x86_64 | 48.042 s | 19.025 s | 272.7 MiB | 270.8 MiB |

The full run is about 2.5x faster on both processors. Peak RSS decreased by
about 12% on Mac and was essentially stable on Intel. Memory observations
remain process peaks influenced by allocation and GC, not live table sizes.

Every full run returned **552506775824935461**. The full reference workload
was not rerun and remains outside corpus audits, with its existing bounded
fixture retained. No exclusions, assertions or timeout settings were changed.

## Other demo controls

Three fresh-process pairs per selected workload on both architectures:

- Euler 023: default input.
- Euler 283: `--top=100`.
- Euler 324: `--exp=1000000000000`.
- Euler 337: `--limit=1000000`.

| Workload | Mac before/after | Intel before/after |
| --- | ---: | ---: |
| 023 | 120.3 / 120.6 ms | 321.7 / 297.7 ms |
| 283-small | 250.9 / 252.0 ms | 664.3 / 576.6 ms |
| 324-small | 142.4 / 142.1 ms | 359.3 / 347.9 ms |
| 337-million | 247.6 / 244.6 ms | 539.0 / 532.9 ms |

All answers match their baseline. These bounded controls are primarily checks
for regressions; small timings include parsing and do not establish speedups.
The full inputs of Euler 324 and 337 are also covered by targeted tests below.

## Verification

- 745 unique focused tests across 25 files passed on Mac. This includes the
  nine new ownership-only loop tests, existing numeric-call paths, arithmetic
  overflow, exact fallback, COW aliases, partial errors, loop results, empty
  and reverse ranges, demand guards and observable interrupt callbacks.
- New generated-code assertions ensure ownership-only arithmetic is inline
  and native-call loops retain persistent traversals. These checks fail the
  old policy while preserving ordinary values and errors in both engines.
- Full Euler 324's 10,000-digit exponent and full Euler 337 default assertions
  passed, along with their independent bounded oracles.
- 49 focused tests passed on Intel, including all new ownership-loop cases.
- TypeScript build and interpreter test typecheck passed. Semantic boundaries
  (65 owners), application-form checks and whitespace checks passed.
- No full package suite or exhaustive corpus audit was started.

Raw observations, excluded timing pair, profile summary and control timings
are in `baselines/2026-11-05-euler414-loop-frames.json`.

## Reproduce

Build both runtime snapshots, then run:

```
node node_modules/typescript/bin/tsc -b tsconfig.build.json
RANK414_FRAME_BASELINE=/path/to/baseline/out/index.js \
  node benchmarks/experiments/euler414-frames.mjs
RANK414_FRAME_BASELINE=/path/to/baseline/out/index.js \
  node benchmarks/experiments/ownership-loop-demos.mjs
```

The runners default to three pairs and fail on mismatching answers.
`RANK414_FRAME_PAIRS` changes the main benchmark's pair count.
No exported code, experiment-time Function rewriting or profiler is needed to
run the delivered optimization.
