# Euler 671 (#499)

The demo now uses `Vm matmul Am mod P` instead of constructing a
`19 x 910 x 910` broadcast product and reducing its middle axis.
It uses the existing exact integer matrix kernel; no interpreter change,
new modular operation, or sparse matrix type is required.

For the default input, the transition matrix has 17,460 nonzero cells
out of 828,100 (2.1%). Each nonzero cell is one. Vector residues are below
1,000,004,321, so even a conservative 910-term contraction is below
2^53. The existing kernel proves the bound before using Number arithmetic
and returns integer cells. Moving the intermediate modulus to after the
contraction preserves the result.

## Measurement

Run after `npm run build`, from the repository root:

```sh
node benchmarks/euler671.mjs broadcast
node benchmarks/euler671.mjs matmul
```

Each sample uses a fresh sequential Node process. Timing includes parsing
and full execution of the default program, but excludes runtime import and
Interpreter construction. The broadcast mode reconstructs the old three-line
iteration from the new demo; the rest of the calculation is identical.
All samples assert the golden answer `946106780`.

Apple M5, Node v24.15.0: the reconstructed original took **56.40 s**
and **694 MiB** peak RSS (one sample). The matrix-product version took
**3.296 / 3.477 / 3.337 s**, median **3.337 s**, about **16.9x** faster
than that baseline sample, with **400-401 MiB** peak RSS.
An earlier unchanged-program investigation run took 60.07 s; timings near
the one-minute threshold vary, while the new version has ample margin.

Raw measurements are in `baselines/2026-11-01-euler671.json`.

## Verification

- `npm run build`: passed, including web and mobile asset builds/sync.
- Focused interpreter tests: 24 passed (`euler671`, `integer-matmul`).
- Original Rank fixture: 1 passed, covering all three statement examples.
- Exclusion manifest tests: 3 passed; Euler 671 is eligible again.
- Full `npm test` and corpus audits were not run.
