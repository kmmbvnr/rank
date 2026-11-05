# Euler 719: compiled frontiers with bounded working memory

Issue [#535](https://github.com/kmmbvnr/rank/issues/535) concerns
`demos/euler/719_numbersplitting.ra` at `Limit = 10 ** 12`. The measured baseline
returns `128088830547982`; the issue requests a several-fold speedup with the
same answer and a profile of the dominant array operation. The
[statement example](https://projecteuler.net/problem=719) is `T(10 ** 4) = 41333`.

## Profile and runtime changes

Before the change, the search loop had no compiled loop. A CPU profile at
`10 ** 10` put `mapStoredInt32Binary` and `expandOperand` at the top of named
self-time samples, followed by integer comparisons and broadcast addressing.
The full Mac baseline spent 54.61 of 55.11 seconds in the search, after table
preparation. The profile summary is retained with the raw results.

The first implementation step keeps the existing global-frontier program:

- Lower fixed-rank numeric/Boolean array reshapes inside Number loops, with
  guarded dimensions, exact cell counts, independent snapshots, and replay for
  unsupported dimensions or values. Inferred/unpacked dimensions retain their
  ordinary backend.
- Compile array `and`/`or` stages and full-shape multidimensional mask selection.
  Masks must have exactly the source shape. Partial-rank/axis selections keep
  their existing evaluator. Fresh filtered sources stay pinned while the mask
  prepares allocating gathers.
- Store private Boolean vector cells in byte buffers and publish packed Boolean
  arrays. Numeric buffers cannot reuse byte capacity or evict it when growing;
  byte stages likewise retain their own reusable capacity.

The original global frontier then ran in about 12.40 seconds on the Mac and
30.15 seconds on Intel, with the correct answer. These intermediate runs are
exploratory, not the final timing series. Numeric precision and replay guards
were preserved.

The first Boolean implementation used four-byte cells: it ran in 12.54 seconds
but increased Mac peak RSS from 5020 to 6931 MiB. Using byte cells reduced the intermediate measured Mac peak to 4744 MiB. A subsequent Euler 715 control exposed buffer churn when alternating
mask and numeric stages evicted one another's dead capacities. The final pool
keeps replacement candidates separated by storage kind. A regression test
requires allocation counts to remain bounded as the number of alternating
stages grows.

## Bounded frontiers

The second step processes independent roots in groups of 4096. `rank 1` applies
the same search helper to each group, then the program sums the partial answers.
The final incomplete group is padded with zero roots; their squares contribute
zero, and they cannot create a nonzero S-number. The mod-9 root filter, digit
suffix tables, pruning conditions, cut enumeration, and at-least-two-parts rule
are unchanged. There is one explicit wave loop in the helper.

This deliberately trades some of the unbatched JIT's speed for a much smaller
working set. Exploratory Mac runs with groups of 2048, 4096, 8192 and 16384 took
about 20.02, 19.95, 18.81 and 17.62 seconds, with peak RSS 427, 562, 743 and
1070 MiB. Groups of 4096 give a useful balance. The default keeps the size as an
implementation constant rather than adding a new user-facing option.

A best-fit/shrinking pool experiment did not demonstrate a useful memory gain
on the full workload and was dropped. Additional mask-expression fusion also
showed no clear improvement and was omitted. No generated-function cache was
added: a batched CPU profile still attributed nearly all samples to generated
numeric loops, rather than compilation.

## Reproduction and results

Build a checkout with its `@arrrank/*` package links pointing to its own packages:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler719.mjs 1000000000000
```

`RANK_ROOT` selects a built runtime, and `RANK_SOURCE` selects a source variant.
`DIAGNOSTICS=1`, `PROFILE=path`, and `SAVE_CODE=path` enable investigation modes.
Timing samples use fresh processes with these modes disabled. The harness
asserts the full answer and records peak process RSS and completed-stage times.

Baseline: commit `4ae58918`, original demo, one sample per host. Final: three
fresh processes per host, Node v24.15.0, Mac arm64 and Intel x64 (`jack.lan`).
The final branch also integrates `200fcffb` from `main`; the final timing
series was repeated after that integration. No other test or benchmark ran concurrently on the measured host during the
final timing series. The baseline has one sample, so these measurements do not
estimate its variance. Raw data are in `benchmarks/results/euler719/`; the
`jit-*` and `rejected-pool-*` files describe intermediate variants.

| Host | Baseline, s | Final median, s | Final range, s | Speedup | Baseline RSS, MiB | Final median RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mac arm64 | 55.11 | 17.42 | 17.20–17.46 | 3.16x | 5020 | 583 |
| Intel x64 | 115.23 | 41.88 | 41.48–43.16 | 2.75x | 4542 | 360 |

All six final runs returned `128088830547982`.

Euler 715 at `Limit = 10 ** 10` is a collateral control. Each host used three
paired fresh-process baseline/candidate runs. Times and peak RSS below are
medians; all paired answers matched (`800568803`). The final comparison uses
immutable baseline snapshots, not a working checkout that could change.

| Euler 715 control | Before, s | After, s | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| mac | 2.697 | 2.726 | 310 | 309 |
| intel | 6.513 | 6.663 | 307 | 290 |

## Verification

Focused tests cover reshapes and snapshots, dynamic/invalid dimensions, integer
precision, real signed zero, Boolean publication, complete matrix masks, shape
mismatches, allocating mask operands, buffer ownership, and budget/error replay.
An independent decimal-cut oracle checks small inputs in both compiled and
interpreted modes, including zero candidates, leading-zero chunks, perfect
squares, batch boundaries and padding. The published `41333` example is retained.

After integrating `200fcffb`, the TypeScript build and 815 focused checks in
27 files passed, including the new integer-array helper and Euler 415 tests.
Both selected full-input tests passed: Euler 715 in 56.34 seconds and Euler 719
in 17.65 seconds with diagnostics enabled. Euler 715 requires three Number
passes; Euler 719 requires all 55 batch searches in Number. Both require zero
overflow replays. These diagnostic test times are separate from the timing
series above.

The full repository suite and exhaustive type/corpus/differential audits were
not run locally. Full-scale tests were selected by name; no other full-scale
demos or audits were started.
