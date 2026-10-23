# Euler 338 exact floor sums (#365)

Measured on Apple M5, Node v24.15.0. The baseline runtime is
`9ce0237f53cf422a463824309c9c353a5361711f`; the original Rank program is retained
in [fixtures/euler338-original.ra](fixtures/euler338-original.ra).
Raw samples are in [baselines/2026-10-23-euler338.jsonl](baselines/2026-10-23-euler338.jsonl).
Execution includes parsing. Each sample runs in a fresh process and asserts the
exact BigInt result. Five-sample comparisons alternate baseline and candidate.
The original full-input comparison has one sample per runtime, taken separately.

| Program | Runtime | N | Execution | Samples |
|---|---|---:|---:|---:|
| Original | Baseline | 10^10 | 1.826 s | 5, median |
| Original | Conditional remainder | 10^10 | 1.626 s | 5, median |
| Triple counting | Baseline | 10^10 | 0.293 s | 5, median |
| Triple counting | Conditional remainder | 10^10 | 0.289 s | 5, median |
| Original | Baseline | 10^12 | 45.798 s | 1 |
| Original | Conditional remainder | 10^12 | 46.246 s | 1 |
| Triple counting | Baseline | 10^12 | 2.483 s | 5, median |
| Triple counting | Conditional remainder | 10^12 | 2.183 s | 5, median |

Compiled BigInt floor division now calculates a remainder only when operand signs
are different. Same-sign division already rounds down. Modulo and checked Number
loops still prepare their remainder. The original program improved about 11% at
10^10, but the full-input samples show no improvement from this change alone.

The algorithm remains ordinary Rank. If D(N) counts ordered pairs with product
at most N, and T(N) counts ordered triples, the old nested sum is T(N) - D(N).
For each A <= B <= C, the new program counts all admissible C at once. Equal
triples have weight 1, triples with two equal entries have weight 3, and distinct
triples have weight 6. Only A <= cube_root(N) and B <= sqrt(N // A) are visited.
D(N) uses the exact hyperbola identity 2*sum(N // I, I=1..isqrt(N))-isqrt(N)^2.
All arithmetic stays exact; no public operation or floating approximation was added.

The dominant loop falls from 5,325,414,070 quotient-block iterations to
148,534,687 strict (A,B) pair visits at 10^12, changing O(N^(3/4)) work to
O(N^(2/3)). The complete new program produces 999999999600010915614292, whose
residue modulo 10^8 is 15614292. The full run is comfortably below 30 seconds.

Focused tests cover signed and arbitrary-precision division in all three code
generation paths, zero-division errors, and independent small-input enumeration
around square and cube boundaries with compilation both enabled and disabled.
The full assertion is separate from the ordinary corpus fixtures because scalar
reference execution still has about 150 million pair visits.

Build with `npm run build`, then run `node benchmarks/euler338.mjs`. To compare
runtimes, build the baseline separately and pass
`--baseline=/absolute/path/to/packages/interpreter/out/index.js`.
The slower original full calculation is optional:
`--cases=original-full --trials=1 --timeout-ms=90000`.
Run its replacement's full assertion with
`node packages/cli/bin/cli.js test demos/euler/338_gridpaper_default_test.ra`.
