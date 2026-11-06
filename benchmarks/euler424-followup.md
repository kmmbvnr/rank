# Euler 424: digit-set support and safe wide Number bit masks

2026-11-06. All 200 puzzles produce **1059760019628**. The delivered source
uses feasible digit-set completions to prune partial letter assignments and
blank-cell trials, and ordinary Number compilation now supports safe wide
`band`, `bor` and `bxor` operations.

## Algorithm and representation

The original search checks a run only once both clue letters are known. For
each candidate it then walks possible digit combinations and repeatedly scans
fixed cell letters. Blank-cell trials only reject duplicate digits, sums already
too large and a wrong completed sum. Those checks leave many impossible partial
rows alive.

A 5120-cell table now records the feasible sums for each row length and required
subset of digits 1–9. Each cell is a sum bitset, with its highest possible bit
at 45. Partial clue masks also constrain the tens/units that are already known;
repeated clue letters allow only 11, 22, 33 and 44. Required fixed letters must
be nonzero and distinct. Blank-cell trials use the same support table to test
whether a full distinct-digit row can still reach its target.

A read-only packed context contains the support/clue/power tables and twelve
integer cells per run. Passing this as an ordinary array keeps the helper at
three parameters and lets its numeric kernel borrow integer readers. The
context is assembled with array operations. Known cells and blank cells are
also collected through array selection, replacing repeated singleton concat.
Unused counters and the old combination-offset tables are removed.

## General compiler capability

JavaScript bitwise operators alone truncate to signed Int32. The loop compiler
previously replayed wider inputs exactly, and the scalar Number kernel did not
support these logical bitwise calls. Both now share a code emitter:

- Int32 operands retain a direct bitwise branch.
- Wider safe integers are split into signed high and unsigned low 32-bit halves.
- Inputs and the recombined result remain checked safe integers. An unsafe
  result replays exactly, including private array rollback and alias behavior.
- Existing native identity/module guards, demand checks and cancellation remain
  at their normal boundaries. Shift and bit-test domains are unchanged.

This applies to integer programs generally, not to a recognized Kakuro source.
A warmed 10-million-iteration Int32 `band` control showed no material regression:
Mac medians 33.227 → 33.228 ms; Intel 79.487 → 77.590 ms. These are small controls,
not evidence for every possible bitwise workload.

## Measurements

Node 24.15.0 on Mac arm64 and Intel x86_64. Three alternating fresh-process
samples per variant, diagnostics enabled. Both builds use the same language
operation registry. Machines were under uncontrolled load; RSS means process
peak, not retained heap. The aligned primary comparison is based on 8a21aac3.
Its exact measured source is retained as `experiments/euler424-paired.ra`.

| Primary paired variant | Mac median | Mac median peak RSS | Intel median | Intel median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Original source/compiler | 38.970 s | 770 MiB | 101.299 s | 768 MiB |
| New search with old compiler | 5.918 s | 735 MiB | 17.749 s | 705 MiB |
| New search and bitwise compiler | 3.770 s | 571 MiB | 12.604 s | 538 MiB |

The algorithm and array changes provide most of the improvement; compiler
support gives an additional gain and avoids wide-bit overflow/replay. The
final source also removes dead counters and packs run metadata with array
operations. Final separate three-sample medians after integration with current
main are **3.713 s / 531 MiB on Mac** and **10.223 s / 528 MiB on Intel**. Those
are a separate batch and should not be substituted into the paired comparison
as a controlled measurement of these small cleanup changes.

Full reference execution was verified too. Two separate Mac observations of
the optimized search were 33.754 and 57.448 s under different load. There is
no freshly measured original full reference baseline, so no full reference
speedup is claimed. The small fixture stays in corpus audits; the default keeps
its manual reference lane and has a dedicated compiled golden test.

## Verification

- Independent native parsing and a different cell-completion search validate
  every one of the 200 returned letter maps against row sums and distinctness.
  All 200 maps match the original implementation individually, not just in sum.
- Zero, one, two and three-puzzle batches pass Number, exact compiled and
  interpreter execution. The full default passes with zero Number overflow
  and no numeric helper fallback.
- 438 focused Mac tests passed after integration with current main, including
  the bitwise edge cases, scalar kernels, integer loops, array operations and
  selector-work proof tests. 375 focused cases passed on Intel, including the
  full default. Source/test TypeScript builds pass. Final source validation is
  retained alongside those runs: 17 final cases on Mac and five final Euler
  cases on Intel, including the full golden on both hosts.
- BigInt provides an independent oracle across signed 32/45/52/53-bit boundaries;
  tests cover 100-bit input fallback, an unsafe result with mutation/alias replay,
  live builtin replacement and demand budgets after warm execution.

Exhaustive audits and the full workspace suite were not run.

## Reproduction

Build this checkout and a baseline interpreter, including their language builds.
Run `experiments/euler424-pairs.mjs` with `RANK424_BASE_RUNTIME` set to the baseline
interpreter file URL. An optional source-file argument selects the historical
paired source above. `euler424-run.mjs` runs a selected execution mode/count;
`euler424-check.mjs` validates every map with the independent cell oracle.
Raw observations: `baselines/2026-11-06-euler424-followup.json`.
