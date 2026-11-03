# Euler 369: Badugi investigation

Euler 369 follows Euler 365 in issue #447. The delivered demo discovers only
reachable states, precomputes transitions, and uses library `lowerindex` over
sorted state codes instead of allocating a dense state-ID map. No compiler
implementation, execution exclusion or timeout changed.

## Finding

The main avoidable cost is the dense DP state space. A state is a 16-bit
set of achievable suit subsets, not an arbitrary set: closing the initial
state `1` under all 16 rank masks yields only **68 states**, including one
accepting state. This is discovered at runtime, not a hardcoded list.

At the defaults (13 ranks, hands of at most 13 cards), each original DP layer
has 14 * 65536 = **917504 cells**, against 14 * 68 = **952 cells** when compacted.
The loops inspect 11927552 versus 12376 state/size pairs across 13 layers;
only nonzero pairs fan out into the 16 choices of cards at the next rank.

The compact prototypes precompute both the 1088 state transitions and the
16 card counts, then apply the same counting recurrence. `hands` and `badugi`
retain their answers, but the internal `table` now returns counts by hand
size rather than the expanded state table.

- `experiments/euler369-original.ra`: unchanged source snapshot.
- `experiments/euler369-compact.ra`: discover states using a BFS and dense ID map.
- `experiments/euler369-array.ra`: discover them using array-valued `extend`,
  concatenation and `unique sort` until closure. Slightly simpler construction.

The full answer remains **862400558448** in both engines for all three versions.

## Initial prototype measurements

Mac arm64, Node v24.15.0, built interpreter. Medians of three fresh processes,
serial and interleaved; parsing and compilation included. The worktree contains
unrelated changes, so these are same-runtime algorithm comparisons, not clean
revision benchmarks. Other user work may affect timings. No Intel measurement.

| Variant | Compiled | Peak RSS | Reference | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Original | 351.0 ms | 327.8 MiB | 6422.0 ms | 453.2 MiB |
| Compact BFS | 157.5 ms | 183.9 MiB | 290.9 ms | 195.1 MiB |
| Array closure | 172.4 ms | 185.7 MiB | 284.7 ms | 196.0 MiB |

This is about 2.0–2.2x compiled and 22x reference. Peak process RSS falls as
well as the logical DP storage. The issue's old 60.9 / 1.8 second observation
is historical and concurrent; it is not the current baseline.

An independent hand-written JS compact-state implementation produces the
same full answer in about 0.9 ms (single observation; no Rank parsing,
compilation, contracts or publication). It is an algorithm control, not an
end-to-end compiler speed target.

## Compiler and interpreter findings

The original already executes its hot DP sweeps in checked Number mode:
14 compiled loops, 14 Number loops, no overflow and no mixed-integer loop.
Compaction is therefore useful even when the arithmetic kernel is compiled.

The outer rank loop is rejected with `loop:mutable-array-alias:ForStatement`:
`Cur = Next` transfers a freshly allocated array that is subsequently reused
as input. Inner sweeps still compile. The corresponding checks in
`src/jit/integer-loop.ts` conservatively propagate writability through aliases
and reject mutable aliases; Number mode also guards rebound input aliases.

A general opportunity is lifetime/ownership tracking for local arrays and
loop-carried snapshots. It could join all rounds into one region, avoid
repeated publication and conversion, and support similar double-buffered DPs.
Removing the alias guards alone would break ordinary `=` snapshot semantics
and overflow replay. This experiment does not implement or benchmark that fix.

Diagnostics for BFS: 17 Number loops, no overflow; published cells drop from
12845056 to 145488, read-buffer cells from 4587520 to 4776. These counters
measure cells across operations, not simultaneously retained memory.

A reference CPU profile of the original is spread over expression evaluation,
block execution, binding assignments, loop iteration and scalar selection.
The algorithm removes millions of these operations. Remaining reference cost
is roughly 0.29 s, so a broad interpreter redesign is not needed for this demo.

## Correctness checks

The independent oracle uses actual 16-card hands from a four-rank deck:
mark every four-card choice with distinct suits and ranks, then propagate
success to all supersets. All **65536 hands** are classified without using
the Rank state encoding or `extend` recurrence. Counts for each hand size
0 through 16 are compared with every prototype in both engines.

The existing 13-rank values for four and five cards (17160 and 514800) also
match: 19 assertions per variant/engine, **114 comparisons** altogether.
The repeated full runs assert the common default answer. This is targeted
experimental verification, not a full test suite or full differential audit.

## Reproduce

From the repository root, after building the interpreter:

```sh
node benchmarks/euler369-investigation.mjs compiled 13 original
node benchmarks/euler369-investigation.mjs reference 13 array
DIAG=1 node benchmarks/euler369-investigation.mjs compiled 13 compact
PROFILE=/tmp/badugi.cpuprofile node benchmarks/euler369-investigation.mjs reference 13 original
node benchmarks/experiments/euler369-check.mjs
node benchmarks/experiments/euler369-native.mjs
```

Raw samples, diagnostics, oracle counts and profile summary are retained in
`baselines/2026-11-03-euler369-investigation.json`.

The array-closure version was selected for delivery, retaining the full golden
and independent small-deck checks. Treat general
loop-carried array ownership as a separate compiler change with alias and
overflow regressions, rather than silently weakening its existing guards.

## Delivered variant

The final array-closure version uses `Codes lowerindex To` for transition IDs,
removing the additional 65536-cell lookup array. Fresh-process medians of three
serial, interleaved runs on the same Mac and built runtime:

| Version | Compiled | Peak RSS | Reference | Peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Original | 352.5 ms | 328.6 MiB | 6361.9 ms | 453.9 MiB |
| Delivered | 170.3 ms | 186.2 MiB | 283.1 ms | 195.5 MiB |

The default answer is asserted on every measurement. This is about **2.07x**
compiled and **22.47x** reference, with lower peak RSS in both engines.

Validation: TypeScript project build passed. `euler369.test.ts` checks the
independent 65536-hand oracle at every hand size in both engines. Scoped
`differential.test.ts` passed for the main program and fixture (four embedded
blocks), including the full answer and empty/short-deck edge cases. Four
selected Vitest cases passed; no full audit or full workspace suite was run.

Reproduce the delivered variant:

```sh
node benchmarks/euler369-investigation.mjs compiled 13 production
node benchmarks/euler369-investigation.mjs reference 13 production
```

The general loop-carried array ownership opportunity remains open and is not
claimed as fixed by this algorithmic improvement.
