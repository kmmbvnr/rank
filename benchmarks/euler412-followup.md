# Euler 412 delivery

Implemented on top of `4e5fe2bc`. The runtime/compiler are unchanged:
existing modular folds provide the native implementation in both engines.

The demo chooses the shorter factorial tail using Wilson's theorem only for
Cells < P. It retains the forward product otherwise, including factorials
containing the modulus. Default factors decrease from 75000000 to 1543216.
Native modular reduce replaces the manual copy/slice product tree; native
scan replaces the factorial-table mutation loop. Chunk remains configurable.
All Rank source lines fit 40 columns and redundant brackets are removed.

## Final measurements

Three alternating fresh-process pairs per host, using the same current
runtime for original and delivered sources. Wall time includes parsing.
All answers are 38788800. Peak RSS is a process maximum, not retained heap.

| Host | Original | Delivered | Original RSS | Delivered RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac | 6.713 s | 0.128 s | 1429.6 MiB | 163.1 MiB |
| Intel | 12.234 s | 0.303 s | 1420.8 MiB | 145.7 MiB |

Raw results and test summaries: `baselines/2026-11-05-euler412-delivery.json`.
Research alternatives: `euler412-investigation.md`. The streaming range-fold
probe was not incorporated: it showed no material speedup on this workload.

## Verification

- 150 targeted tests on each host, including six new Euler 412 tests.
- The new tests exercise 78 small shapes against an exact independent hook
  oracle in both engines, Chunk=7, the full default answer and two larger
  inputs (a long Wilson tail and a factorial containing P).
- 624 additional oracle comparisons on Mac across original, experimental
  native/Wilson and delivered sources in both engines.
- Scoped differential, inferred-type and name-facts audits: both the main
  demo and its existing fixture pass (two selected tests per audit).
- TypeScript build and test typecheck, application-form check, whitespace
  and 40-column source checks pass.
- No full suite or exhaustive audit was started. No execution exclusions
  or timeouts were added; the full demo passes differential in both engines.

Reproduce with `node benchmarks/euler412-investigation.mjs compiled` or
`reference`; add `10000 5000 original` for the archived original source.
