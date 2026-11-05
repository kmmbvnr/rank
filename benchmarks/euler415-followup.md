# Euler 415: compact array helpers in Number loops

Baseline: `2ff9e3c6`, Node v24.15.0, 2026-11-05. This completes the
[investigation](euler415-investigation.md); its expanded formulas remain
experimental controls. The delivered demo keeps ordinary named helpers.

## Changes

The compiler now accepts a conservative class of pure, straight-line integer
array helpers inside a private Number loop transaction. Pointwise intermediate
arrays are virtual; each call returns one fresh private numeric array. This
joins `triangle` and `squares` to their caller without duplicating their Rank
formulas. It also handles declared calls with multiple left parameters.

Admission requires rank-one integer arrays, integer scalar arguments, supported
arithmetic, no captures, deferred bindings, effects or unused computations.
Bindings and the ordinary call method are checked again at execution. Host
array metadata and observable polling keep the ordinary path. Overflow, unsafe
integer division and incompatible shapes replay the existing exact transaction;
the ordinary helper retains call-site errors and demand semantics. Compilation
switches remain effective. This does not add general multidimensional or real
array helper compilation.

The demo retains the weighted-totient recurrence. It scopes prefix construction
in one helper, stores modular prefix scans, copies only the needed prefix
slices, uses native `powmod`, and computes neighboring quotient boundaries
directly instead of concatenating an array. The prefix limit decreases from
10 million to 5 million. Prime powers are a small Cartesian array followed by
one sieve loop, rather than nested loops. Array formulas remain array formulas.

## Full default measurements

`N=100000000000`, expected answer **55859742**. Each observation is a fresh
process. Parsing is included; module imports are excluded. Phase logging is
disabled. RSS is the process high-water mark, not retained memory.

| Host | Original, one run | Delivered, three runs | Original peak | Delivered peaks |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 48.736 s | 22.086 / 23.765 / 21.467 s | 1928.2 MiB | 960.6 / 964.6 / 916.9 MiB |
| Intel Linux | 122.240 s | 47.411 / 49.130 / 49.345 s | 1848.7 MiB | 875.8 / 900.3 / 886.0 MiB |

Delivered medians are **22.086 s** and **49.130 s**: approximately **2.2x**
and **2.5x** faster than the single before observations, with roughly half
the peak memory. These are not alternating before/after medians; host load
was not controlled. Earlier independent original probes were 46.388 s on Mac
and 142.276 s on Intel, so use the raw observations rather than treating the
ratio as a precise guarantee.

Every full answer agrees. The delivered quotient-cache loop enters Number
mode once without overflow; the original enters Number mode zero times.

An isolation control runs the delivered source with the old compiler, at the
same 5-million prefix limit. It takes **85.811 s / 1560.6 MiB** on Mac and
**242.302 s / 1387.3 MiB** on Intel, with zero Number loops. Against the
new-compiler medians on that source, the compiler improvement is approximately
3.9x and 4.9x. These extra single probes were not load-controlled either.
Reducing the table alone increases recursion work; the compiler change is
necessary for this memory/speed tradeoff.

A bounded reference check (`N=10^7`, `L=10^5`, Mac) agrees at **49785750**:
original 0.701 s / 311.8 MiB, delivered 0.671 s / 268.1 MiB, one probe each.
This is not a full-reference benchmark. The full main remains excluded from
exhaustive execution audits; the small fixture remains included.

The prior hand-fused JS control is still faster (3.158 s Mac / 9.411 s Intel
with 10-million tables), but uses a direct scalar traversal and compact typed
tables. General Rank execution still has materialized call results, other
array intermediates and sieve/prefix traffic. No parity with JS is claimed.
Fusing returned pointwise formulas into consumers is a possible follow-up,
not implemented here.

## Verification

- 29 compiler regression cases cover broadcasting, empty and mismatched
  shapes, signed division/remainder, modular multiplication, unused and deferred
  bindings, rebinding, fresh results, aliases, mutations, overflow/replay,
  function switches, host call replacement and metadata, budgets and polling.
- Eight production-demo tests compare both numeric backends and the
  interpreter to independent geometric line enumeration at N=1..6 and
  published checkpoints N=111 and N=100000 with short recursive tables.
- Initial targeted tests pass. After rebasing onto `4ae58918`, 522 tests
  across 16 files pass, including the parallel Euler 715 compiler changes.
  A full integrated Mac sanity run also agrees (21.015 s / 1048.7 MiB); it
  overlapped targeted tests and is excluded from performance medians. The
  scoped Euler 415 differential fixture passes. No full suite/audit was run.
- The standalone verifier passes 80 checks on both Mac and Intel: original,
  combined, scoped and delivered × reference/compiled × N=1..8, 111, 100000.
- Build/typecheck, semantic-boundary and application-form checks pass.

Raw observations, diagnostics and verification summaries:
[`baselines/2026-11-05-euler415-delivery.json`](baselines/2026-11-05-euler415-delivery.json).

## Reproduction

Build this checkout with `node node_modules/typescript/bin/tsc -b tsconfig.build.json`.
For the baseline, build revision `2ff9e3c6` in a separate worktree; preserve its
`packages/interpreter/out` and dependencies before rebuilding the delivery.
Then run:

```sh
RANK415_BASELINE=/path/to/baseline/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler415-delivery.mjs
node benchmarks/experiments/euler415-verify.mjs
node benchmarks/experiments/euler415-helper-probe.mjs
```

The delivery runner performs one original and three delivered full runs,
checking their answers. To isolate the compiler from the rewritten demo:

```sh
RANK415_RUNTIME=/path/to/baseline/packages/interpreter/out/index.js \
  node benchmarks/experiments/euler415-run.mjs compiled \
  100000000000 5000000 demos/euler/415_titanicsets.ra
```
