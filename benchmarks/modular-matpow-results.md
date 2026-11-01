# Modular matrix powers (#503)

`A matpow N mod M` now reduces after each matrix product when the matrix
contains integers, N is a nonnegative integer and M is a positive integer.
Parentheses around the power have the same behavior. A separate binding
`P = A matpow N` remains exact, even if P is later reduced modulo M.

The expression evaluator uses the existing chain-recognition mechanism.
The power routine shares validation, snapshotting and exponentiation by
squaring between exact and modular evaluation, using existing exact matmul.
No new matrix multiplication algorithm or language syntax was added.

Input snapshots preserve operand effects; ineligible real or negative powers
finish before evaluating the modulus. Shape, power-type and inverse errors
keep their timing. Builtin identity and implementation guards are rechecked
when cached expressions run and after operand evaluation. The diagnostic
counter `modularMatrixPowers` identifies the fused path.

## Measurements

Apple M5, Node v24.15.0, macOS arm64. Base revision: `3fbb64ec`.
Each engine sample is a fresh process. Three sequential sets compare an exact
named result with the fused expression on the same compiled implementation.
The dense 32 x 32 matrix contains ones; every output cell is checked against
an independent scalar modular-power formula. Timings include parsing,
execution and result traversal, excluding imports and interpreter creation.

| Calculation | Median |
| --- | ---: |
| Exact power then mod, N = 16384 | 2189.450 ms |
| Fused power, N = 16384 | 102.636 ms |
| Fused power, N = 10^18 | 142.153 ms |

The matched-exponent speedup is **21.33x**. The huge-power calculation is
well below one second in all three samples (136.669–173.414 ms). An exact
10^18 power was deliberately not attempted: its integer bit lengths grow
linearly with N.

The three requested demos were measured separately, using the same new
interpreter for both old source from `3fbb64ec` and rewritten source. Each
harness process creates a fresh interpreter per case; the case order is fixed.
Three sequential before/after process pairs gave these medians:

| Demo workload | Old loop | Fused form |
| --- | ---: | ---: |
| Throwing Dice, N = 10^18 | 128.001 ms | 111.073 ms |
| Graph Paths I, complete 3-node graph, length 10^18 | 20.832 ms | 17.569 ms |
| Euler 435, default input | 174.858 ms | 77.079 ms |

Every answer agrees. These short demo timings include parser and compiler
warm-up and should not be interpreted as steady-state kernel throughput.
Raw samples: [2026-11-01-modular-matpow.json](baselines/2026-11-01-modular-matpow.json).

```sh
node benchmarks/modular-matpow.mjs exact 16384
node benchmarks/modular-matpow.mjs fused 16384
node benchmarks/modular-matpow.mjs fused
node benchmarks/modular-matpow-demos.mjs before
node benchmarks/modular-matpow-demos.mjs after
```

## Verification

- `npm run build` passed.
- 309 focused interpreter tests passed across modular-matpow, linalg,
  integer-matmul, modular-fold, convolution and interrupt.
- 160 small-matrix comparisons cover both syntax forms, negative cells,
  zero and unit powers, modulus one, and moduli up to 15!.
- All 11 existing Rank cases passed across the three demo fixtures,
  including the default Euler 435 answer 252541322550.
- Full `npm test` and exhaustive corpus audits were not run.
