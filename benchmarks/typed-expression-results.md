# Typed expression compiler measurements

## Native text calls and call preparation

Measured on Node v24.15.0 / Apple M5. Each case uses five fresh-process samples after warming both builds, with alternating execution order. Outputs are checked against independent expected answers. No other local tests or benchmarks ran during timing.

The baseline is `c2be797f`, the pre-catalogue build used by the #103 audit. That audit found the catalogue migration performance-neutral on these cases. The measured candidate is `0d8a6932`; its implementation source trees are identical after rebasing to `6ecad0c0`. The JSON artifact records both revisions and source-tree hashes.

| Program | Baseline median | Candidate median | Candidate / baseline |
| --- | ---: | ---: | ---: |
| Euler 004 | 4665 ms | 2331 ms | 0.500 |
| Euler 014 | 12815 ms | 12303 ms | 0.960 |
| AtCoder Frog 2 | 477 ms | 488 ms | 1.023 |
| CSES Coin Combinations I | 561 ms | 563 ms | 1.005 |
| CSES Dice Combinations | 437 ms | 438 ms | 1.002 |

Frog 2 initially measured 2.3% slower. A five-sample repeat starting with the candidate measured 479 → 482 ms (1.006). Both runs are retained; the repeat does not erase the first result.

These measurements show about half the elapsed time for Euler 004 and a 4% improvement for Euler 014 on this machine. The shorter cases are close to baseline, with the variability shown above. They do not establish a general speedup or a result for Node 22.

Reproduce after building both checkouts:

```sh
node benchmarks/compiler-catalogue-bench.mjs BASELINE CANDIDATE 5
node benchmarks/compiler-catalogue-bench.mjs BASELINE CANDIDATE 5 'AtCoder Frog 2' candidate
```

## Verification

The combined implementation passed `npm test`: 759 language tests, 3,187 interpreter tests with 333 unobserved corpus cases skipped, 237 common tests, 490 CLI tests and 10 exporter tests. The corpus retains its aggregate observed-program and settled-name gates.

The compiled candidate matches the recorded interpreter-only #103 reference on
1,356 tests in 392 files, 74 standalone programs (including 54 CSV exports and
9 isolated database updates), and the unchanged chess-password program under a
deterministic pure digest fixture. Module-load tracking accounts for all 858
demo sources. This is not a full real-MD5 password search. Comparison ignores
compiler counters and generated code because this stage intentionally expands
compiler coverage; it retains outputs, errors, test results and export hashes.
The final #102 acceptance audit will also rerun the reference on the completed
implementation.

Reproduce with `compiler-catalogue-audit.mjs` using the `tests`, `unpaired` and
`chess` selections, then compare each result with `--behavior-only`. The fixture
requirements are recorded in `compiler-catalogue-results.md`.

#102 remains open: broader input/array domains, shared loop/tensor inference, effects/cost metadata, higher-order paths and per-node fallback are still required.

## Ranked scalar callbacks through checked array views

The next stage prepares a checked callback once per ranked application and a
cell reader once per materialization. It keeps per-cell native-binding guards,
return contracts, inspection fallback, cancellation, and binding validation.
Preparation does not read cells. The reader is not a purity proof.

Five fresh-process Euler 004 samples on Node v24.15.0 / Apple M5 measured
2342 → 2280 ms (candidate/baseline 0.973). No other local tests or benchmarks
ran during timing. The baseline is the native-text/call-preparation stage
`0d8a6932`; the candidate is `3e9a6417`, whose implementation sources are unchanged
at `fa949846`. This is a 2.7% improvement on one program, not a general performance
claim. Raw samples and source-tree hashes are in `ranked-callback-results.json`.

`npm test` passed: 759 language, 3,199 interpreter (333 unobserved corpus cases
skipped), 237 common, 490 CLI, and 10 exporter tests. Focused tests cover partial
reads, retry after failure, changing native bindings, refined binding contracts,
soft missing cells, empty frames, memo calls, inspection, and cancellation.

The candidate matches the recorded interpreter-only reference on all 1,356 tests
in 392 files, 74 standalone programs with their CSV exports and isolated database
updates, and the deterministic chess fixture. The same final-reference and
real-MD5 limitations described above apply. This stage does not close #102.

## Sequences, dyadic ranks, named outer and scans

The same checked callback now serves lazy sequence maps, both dyadic ranked
paths, named outer products and named scans (including axis scans). Actual
arguments are read in the original order before the callback checks its guards.
No extra input is read to select the kernel. Named scans over unbounded sources
retain lazy consumption.

`npm test` passed at `cd5387b5`: 759 language, 3,207 interpreter (333 skipped),
237 common, 490 CLI and 10 exporter tests. The rebase to `aab60f09` changed only
the preceding stage's report files. All 79 focused tests passed, with tests
asserting both exact reference read traces and avoidance of the generic call
wrapper. Coverage includes native replacement between reads, Unicode text,
dyadic operand order, outer products, seeded scans and axis scans.

The demo audit matches the recorded interpreter-only reference on 1,356 tests
in 392 files, 74 standalone programs with their exported files and database
updates, and the deterministic chess fixture. Audit hashes and source-tree
identities are recorded in `sequence-callback-results.json`. The final-current-
reference and real-MD5 limitations above still apply. This stage has no separate
timing claim; final #102 measurements remain required.
