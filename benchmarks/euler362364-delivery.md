# Euler 362 and 364 delivery

The changes implement the investigations in `euler362-investigation.md` and
`euler364-investigation.md`; their earlier tables are historical measurements.
Production code, focused tests and reproduction scripts are included together.

## Changes

- Euler 362 uses the prefix squarefree count to bound its factor loop, reads
  simple terminal results directly, and memoizes only nonterminal states.
  The prefix table extends to twice sqrt(Limit), while the factor queue still
  ends at sqrt(Limit). Limit=0..3 no longer tries to read an empty queue.
- Euler 364 cancels factorials in the summand and combines the two identical
  groups. Existing modular scans build the factorial/inverse/power tables;
  array expressions compute the terms, leaving only a three-iteration loop.
  The final modular answer is stored in `Answer`, preserving fixture behavior.
- Scalar Number functions now lower an integer `A * B mod M` with the same
  checked exact modular multiplication as Number loops. Unsupported moduli
  retain exact replay. Ordinary stored assignments are not fused across.
- Modular scan/reduce now consumes constructor-proved finite arithmetic
  progressions with any step, including descending and very wide integer
  ranges. It constructs residues directly, avoiding huge factorial prefixes
  when the descending scan is written inline. Host sequences without a
  constructor proof retain their ordinary iteration and error behavior.

No unsafe call-signature cache, implicit memoization of primed variables,
relaxed precision checks or new Number admission threshold was introduced.
The normalized-buffer borrowing experiment was not selected.

## Full input results

Final values are three fresh-process medians. Time includes parsing,
preparation and execution after imports/interpreter construction. Peak RSS
includes imports. Node 24.15.0 on both hosts.

| Program / engine | Mac | Mac peak RSS | Intel | Intel peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 362 compiled | 4.600 s | 299.0 MiB | 11.038 s | 284.6 MiB |
| 364 compiled | 0.222 s | 213.7 MiB | 0.518 s | 195.6 MiB |
| 364 reference | 0.271 s | 245.8 MiB | 0.654 s | 225.9 MiB |

The initial delivery series on Mac had unrelated, simultaneous Vitest workers
and an Euler 505 benchmark. The final series above, after integrating remote
604547c2 and local 6355cc83, ran after that load subsided. The initial new
solver median was 8.006 s; the final 4.600 s is consistent with the original
quiet-Mac 4.674 s experiment.
A same-load single control of original 362 took 71.580 s / 1391.0 MiB. Running
the new demo on the old compiler under that load took 8.695 s / 301.5 MiB,
confirming the change is algorithmic rather than a new compiler slowdown.
Do not compare the earlier quiet-Mac 4.674 s experiment with the busy-Mac
8.006 s delivery as evidence of a regression.

Original Intel 362 was 80.271 s / 1366.2 MiB (one investigation control).
The factor cache now has 522598 entries instead of 9373998; the squarefree
query cache has 49999 entries. Full answer: **457895958010**.

For 364, the earlier three-process original controls were 0.456 s compiled /
13.387 s reference on Mac, and 0.963 s / 39.705 s on Intel. Original reference
RSS was 458.6 / 431.2 MiB. Compiled Mac RSS rises by about 7 MiB versus the
original 206.7 MiB, while Intel drops from 202.8 to 195.6 MiB. The array
rewrite is especially useful for reference
execution, with smaller peak RSS. Full answer: **44855254**.

The isolated general scalar-function compiler fix, without changing the
original 364 demo, previously measured 0.268 s Mac / 0.531 s Intel. Its benefit
is covered independently of the production rewrite, which removes that helper.

A production 362 full reference run was stopped after 120 seconds. Its corpus
exclusion remains with an updated explanation. A dedicated full compiled
golden test and the original small fixture remain active. This delivery does
not claim a fast full reference solver for 362.

## Verification

- TypeScript build passes, including test types.
- 497 focused tests in 13 files pass in consolidated runs on each host after
  integrating the concurrent runtime changes. A further 203 tests pass in an
  isolated coexistence check with all eight pre-existing dirty tracked files.
- Independent squarefree-factor enumeration plus fixture verification:
  104 checks per host, covering production and three research variants,
  both engines, Limits 0..10000.
- Independent seat-mask enumeration (N=1..12) and exact factorial/binomial
  checks (N=20,30,100,200,1000): 170 checks per host across both engines.
- 987 modular-product arithmetic checks per host include signed safe-integer
  boundaries, wide input replay, unsupported/negative moduli and zero errors.
- Both actual Rank fixture files pass in both engines: 10 test blocks per host.
- 11 script tests and the semantic-boundary check pass. No full package suite
  or exhaustive type/differential/corpus audit was started.

The focused tests also cover caller write rollback, pre-error stores, array
buffer calls, ordinary `=` boundaries, wide/negative range steps, reduction
seeds, empty-array boundaries through the demos, and host iteration behavior.

## Reproduction

```
node benchmarks/euler362364-delivery.mjs
node benchmarks/euler362-verify.mjs
node benchmarks/euler364-verify.mjs
node benchmarks/euler364-mulmod-verify.mjs
node benchmarks/euler362364-fixtures.mjs
```

Set `RUNTIME=file:///path/to/packages/interpreter/out/index.js` to select a clean
built interpreter. The delivery series runs serially in fresh child processes.
Raw delivery samples are in
`baselines/2026-11-03-euler362364-delivery.json`.
