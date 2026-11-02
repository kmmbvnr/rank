# Euler 344: Silver Dollar Game

Research on 2026-11-02 against source snapshot `16c1287e`, Node 24.15.0.
Following the investigation of 343, the next unmarked numbered workload in
issue #447 is 344 (main and full-default fixture). No issue changes are made
by this investigation.

## Current behavior

The full current program is already fast when compiled. Its Pascal table,
weight construction and carry transitions execute in Number loops: 252
completed regions, no overflow. Each modular product is below about 10^12
for the two fixed primes, well inside exact Number integer arithmetic.
The final CRT remains exact BigInt arithmetic.

The calculation depends mostly on the number of coins and the binary width
of N. It does not scan all one million board positions. The expensive reference
path executes the scalar carry/ones loops through the interpreter.

The game and published examples were checked against the
[official problem](https://projecteuler.net/problem=344). A separate minimax
oracle implements regular leftward moves, leftmost pocketing and silver-coin
identity, without using the program's counting formulas.

## Useful program changes

The selected research variant is `experiments/euler344-library-weights.ra`.
The research variant had 83 lines versus 107 in the original source.
The delivered source has 85 lines, including the bit-count invariant and a
CRT expression split to avoid nested parentheses.

1. Replace the Pascal table and custom modular-binomial helper with existing
   exact `binomial`. Build the two polynomial rows as array expressions and
   combine them with exact `convolve`, taking coefficients modulo P.
2. Process bits while the remaining target S is positive, instead of always
   processing 41 bits. Default S needs 20 bits. The generated weights satisfy
   W[0] = 1, so additional zero target bits cannot change the coefficient D[0].
   This assumption is part of the counting argument; it is not a general
   statement about arbitrary W[0].
3. Skip zero carry states. Enumerate Ones with the required parity directly,
   using stride 2. Restrict Carry to min(Z, S) and Ones to min(Z, S-Carry).
   A nonnegative weighted sum already exceeding the remaining target cannot
   contribute later. These bounds reduce work without changing modular counts.

The sequential carry DP remains a loop. Expressing its inner transition as
array gathers and scatter updates is correct, but substantially increases
allocation and compiled time; see the array control below. Native array
operations simplify weight construction; explicit scalar updates remain the
measured choice for this small, dependent DP.

The dynamic bit count also removes a fixed 41-bit ceiling from the internal
counting helper for its valid W[0] = 1 domain. Independent coefficient tests
include targets at bits 40, 41 and 53. This does not claim a complete arbitrary
CLI-input contract: the game comparisons cover legal boards N >= C+1 and the
stated default. Negative targets and invalid board inputs were not redesigned.

## Full default measurements

Three alternating serial fresh-process trials per machine, including parsing,
compilation and execution but excluding imports/process startup. Table entries
are medians. RSS is whole-process peak, not incremental working storage.
Mac: Apple M5 arm64; Intel: Core i7-10750H x86_64. Host connection, hardware and
Node version were verified. Other machine load was not controlled.

| Variant | Mac compiled | Mac reference | Intel compiled | Intel reference |
| --- | ---: | ---: | ---: | ---: |
| Current | 0.205 s | 2.775 s | 0.495 s | 8.571 s |
| Pruned carry DP, original weight helpers | 0.185 s | 0.763 s | 0.451 s | 2.409 s |
| Pruned DP + library binomials/convolution | **0.172 s** | **0.709 s** | **0.422 s** | **2.125 s** |
| Array inner transitions, original weight helpers | 0.628 s | 0.645 s | 2.230 s | 2.166 s |

The selected variant reduces cold compiled time by about 16% / 15%, and
reference time by about 3.9x / 4.0x on Mac / Intel. These are combined program
changes; they do not measure a compiler improvement.

| Variant | Mac compiled RSS | Mac reference RSS | Intel compiled RSS | Intel reference RSS |
| --- | ---: | ---: | ---: | ---: |
| Current | 187.3 MiB | 205.4 MiB | 175.8 MiB | 250.9 MiB |
| Pruned DP | 188.4 MiB | 198.6 MiB | 174.5 MiB | 184.1 MiB |
| Selected library variant | **184.9 MiB** | **195.1 MiB** | **170.5 MiB** | **180.0 MiB** |
| Array inner transitions | 445.2 MiB | 388.3 MiB | 412.4 MiB | 353.8 MiB |

The selected source publishes 13,346 typed cells rather than 47,090 in the
current compiled run, and completes 120 Number regions rather than 252.
The large fixed interpreter/parser footprint remains; these small arrays do
not imply a proportional reduction in whole-process RSS.

Repeated calls to one-prime `solvep`, after source preparation and the first
call, also improve: one process with ten timed samples gives median 11.23 to
4.51 ms on Mac and 29.37 to 12.63 ms on Intel. This excludes parsing and the
other-prime calculation/CRT, so it is not the full-program timing above.

## Compiler investigation

The compiler already optimizes the hot loops; there is no demonstrated reason
to add a 344-specific lowering. Diagnostic failures for the initial all-integer
specialization of `W len` or `A K X` do not mean those operations execute slowly
in the actual array-typed program.

There is a general optimization opportunity for iterative local buffers.
The `D = E` handoff prevents joining every bit of `count` into one private
function-prefix region. Current guards reject array aliases with calls,
mutable aliases, and generic local aliases. E is freshly allocated before
its stores on each iteration, but the current proof does not track that
lifetime across the handoff. The runtime therefore compiles each carry loop
independently and publishes each completed buffer.

A deliberately **unsafe admission-bypass experiment**, confined to the private
snapshot, lowered the original workload to 12 Number regions and 12 array
publications. Its one diagnostic full run took 0.214 s, versus about 0.195 s
for an original diagnostic run; there is no demonstrated cold latency win.
The pruned version likewise did not show a convincing full-run benefit.
These are single exploratory samples, not a controlled speed ranking.

`experiments/euler344-alias-ceiling.patch` preserves that experiment, including
its diagnostic hook, solely for reproducing the optimization ceiling. **It
must not be applied to production**: it bypasses ownership guards and is not a
correct general implementation. The source and built runtime were restored
before all final series and focused tests.

A future general compiler change would need a proof that a producer gets fresh
storage before any write after a handoff, plus correct behavior for snapshots,
retained results, branches, error replay, reentrancy and cancellation. Existing
snapshot barriers must stay. The current measurements justify shipping the
program simplification first; they do not justify removing any alias guard.

## Verification

- All 48 final full-input samples (24 per host, four variants, both modes,
  three trials) assert `65579304332`.
- 736 checks: 45 small board/coin combinations through N=10, all silver-coin
  placements, both prime residues, four variants, both engines; also the
  published W(100,10) = 1514704946113500 example modulo both primes.
- 660 internal-count checks against independent coefficient convolution of
  the finite product of W(x^(2^b)): sparse and modular-zero weights, zero
  target, binary boundaries, and selected large-bit targets.
- 95 focused tests passed on the unchanged compiler: function-prefix regions,
  Number-loop aliases and loop control.
- Existing small CLI fixture (two tests) and full CLI fixture (one test) pass.
- Langium generation and TypeScript project build pass.
- No full test suite or exhaustive audits were started.

At the end of the research, no production source or GitHub issue had been
changed. Raw research results and oracle cases are in
`baselines/2026-11-02-euler344-investigation.json`.

## Reproduction

Use a separately built clean runtime from `16c1287e` to avoid unrelated shared
workspace edits. The workers accept RANK344_RUNTIME; the default is the local
built interpreter.

```sh
RANK344_RUNTIME=/absolute/snapshot/packages/interpreter/out/index.js \
  node benchmarks/euler344-investigation.mjs original compiled
RANK344_RUNTIME=/absolute/snapshot/packages/interpreter/out/index.js \
  node benchmarks/euler344-investigation.mjs \
  benchmarks/experiments/euler344-library-weights.ra reference
RANK344_RUNTIME=/absolute/snapshot/packages/interpreter/out/index.js \
  node benchmarks/euler344-verify.mjs
RANK344_RUNTIME=/absolute/snapshot/packages/interpreter/out/index.js \
  node benchmarks/euler344-count-verify.mjs
python3 benchmarks/euler344-game-oracle.py
```

An optional N, C and then `diag` follow the mode argument. Diagnostic runs are
separate from timing runs. `euler344-warm.mjs` measures repeated one-prime calls.


## Delivery verification

The library-weight variant is now used by `demos/euler/344_silverdollar.ra`.
The final source documents W[0] = 1, keeps required argument parentheses, and
simplifies the CRT expression. No interpreter code or ownership guard changes
are included. Both full-scale 344 execution exclusions are removed: the
optimized program now completes within the reference audit budget on both hosts. The alias-bypass patch remains a clearly marked research artifact.

Verified again on the newer main base `da9619ab`, Node 24.15.0:

- Langium generation and TypeScript project build passed.
- All 1,396 independent game/count checks and 95 focused interpreter tests passed.
- Five small CLI tests cover board/coin parity, the published larger example,
  zero target and counts above bits 40 and 53; the full-default fixture passed.
- Final full-input Mac smoke runs: 0.169 s compiled / 0.690 s reference,
  186.5 / 194.0 MiB peak RSS, both returning `65579304332`.
- Final Intel full-input smoke runs: 0.410 s compiled / 2.022 s reference,
  171.9 / 180.3 MiB peak RSS, both returning `65579304332`. The optional
  Intel CLI fixture launch could not load the host's missing `chalk` dependency;
  Intel verification used direct interpreter workers. CLI fixtures passed on Mac.

These final smoke runs check integration with current main; use the alternating
three-trial research series above for speed and memory comparisons. No exhaustive
audits or full test suite were run.
