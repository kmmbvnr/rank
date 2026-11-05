# Euler 413 delivery

Implemented on ea6d2eca. The original source is archived under experiments;
the historical f59b6b10 research is in euler413-investigation.md.

## Changes

For lengths coprime to 10, the suffix-remainder permutation is evaluated with
two precomputed ternary lookup tables. At N=19 their sizes are 19683 and
59049. No N-by-state-count unpack/merge matrix is needed for these lengths.
Non-coprime lengths retain capped row merging. The table constructor uses
array arithmetic and matmul, with one array argument and no added loops.
All production Rank lines fit 40 columns.

Separately, tensor kernels now fuse a numeric index-vector gather from a
computed one-dimensional producer. Both exact and checked Number kernels
propagate the selected index into the producer, after checking the selector.
They do not create a full producer buffer. Empty domains, selected and
unselected arithmetic errors, invalid indices, repeated/reordered indices,
wide integers, real cells, aliases, cancellation and budgets are covered.
Nested boolean-filter producers retain the reference path: their compacted
length is not the bound input-domain size. That check visits shared DAG
nodes once. Existing deferred/scalar-timing checks remain intact.

A pre-existing tensor-bounds test failed identically on clean ea6d2eca:
whole-loop compilation bypasses the tensor path whose counters it asserts.
The test now disables whole-loop compilation to exercise the intended tensor
bounds cache; its value and mutation/rescan assertions are unchanged.

## Final measurements

Three alternating fresh-process pairs per architecture, original source on
the parent runtime versus delivered source on the patched runtime. Parsing
included, module imports excluded. The host load is not controlled; use
these comparisons rather than treating absolute timings as hardware limits.
Peak RSS is a process maximum, not retained heap. All full answers match
3079418648040719. A later guard-only DAG traversal change does not alter the
generated kernels; final gather measurements and guard tests include it.

| Host | Original compiled | Delivered compiled | Original RSS | Delivered RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac / Node v24.15.0 | 9.492 s | 6.248 s | 1617.5 MiB | 1261.8 MiB |
| Intel / Node v24.15.0 | 23.719 s | 15.107 s | 1145.3 MiB | 816.8 MiB |

Single delivered reference runs: Mac 7.800 s / 1182.7 MiB;
Intel 18.288 s / 729.5 MiB. The later final Mac spot check is in raw results.
Most default-input improvement comes from the state representation change;
the entire DP is still not one compiled loop. The generic gather addition
is useful independently and does not justify claiming a fully fused DP.

Computed-gather control: `(A * 3 + 1) Ix copy`, A has one million cells,
Ix selects every fourth cell. Setup excluded, compilation/parse included;
three alternating fresh processes per version, final compiler implementation.

| Host | Before | After | Before RSS | After RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac | 27.005 ms | 8.918 ms | 186.2 MiB | 144.3 MiB |
| Intel | 84.350 ms | 24.054 ms | 172.4 MiB | 130.0 MiB |

The compiler executes one tensor kernel instead of individual source-cell
callbacks in this control. This is separate from the full Euler timings.

## Verification

- Mac: 384 cases across 20 selected tensor/selection files, plus six Euler
  413 cases; 390 unique focused cases. Final gather/DAG guard tests rerun:
  71 passed. Build and test typecheck pass.
- Intel: Euler 413, tensor-bounds and gather tests passed (90 cases before
  the final added nested-filter case); final gather/DAG tests pass all 71.
  These cover 105 unique cases across four files.
- Euler tests compare direct decimal-substring enumeration for Digits=0..5,
  statement totals at 7/11, and the full 19-digit answer in both engines.
- Additional original/prototype/delivered cross-mode comparisons: 72 pass
  for Digits=0..11, including an independent direct-substring oracle to 5.
- Full main and existing fixture pass each scoped differential, inferred-type
  and name-facts audit (two selected cases in each). Removed the historical
  413 execution exclusion. No timeout increases or new exclusions.
- Semantic-boundary and application-form checks pass. No full suite or
  exhaustive corpus audit was started.

Raw results: baselines/2026-11-05-euler413-delivery.json. Reproduce:
`node benchmarks/euler413-investigation.mjs compiled 19 delivered` (or
reference); use original for the archived source. RANK413_RUNTIME selects a
built parent runtime. The generic control is experiments/euler413-gather.mjs.
