# Euler 377 investigation

Status: the reuse/library implementation is applied to the demo. The runtime
is unchanged; it already provides exact modular matrix exponentiation.
Issue: https://github.com/kmmbvnr/rank/issues/447
Baseline interpreter: `80507fc94b7700ab385c43e5627b0d928e48c1a0`.

## Cause and proposed implementation

The demo uses a correct 18-state linear recurrence, but implements matrix
multiplication and exponentiation in Rank and restarts exponentiation for
every `13^i - 8`. This combines redundant algorithmic work with interpreted
array access, writes and helper dispatch. The compiler accelerates some loops,
but does not turn the entire helper chain into one kernel.

Use the existing `linalg` operation `Mat matpow 13 mod Mod`, and keep the
previous matrix power. If `M = A^(13^i)`, the next matrix is `M^13`.
Starting from the state at digit sum zero, only the count component is one;
therefore the wanted digit sum is simply matrix entry `(0, 9)`. The separate
small-state DP, state vector, vector application and three handwritten helper
functions can all be removed.

For 17 terms the original helper performs 850 matrix multiplications plus
17 matrix-vector applications. The reuse prototype needs 85 matrix
multiplications: each library exponentiation by 13 uses three squarings and
two accumulator products. Both retain O(log exponent) exponentiation; reuse
avoids repeating earlier powers across terms.

Compare:

- `experiments/euler377-library.ra`: use existing modular matrix operations,
  keeping the original exponents and state. Separates library overhead from
  the algorithmic change.
- `experiments/euler377-reuse.ra`: recommended compact implementation.
- `experiments/euler377-inner-mod.ra`: reduce each product before storing the
  intermediate sum. No meaningful gain; does not unblock the helper chain.

## Compiler and runtime findings

`Expressions.modularMatrixPower` already recognizes integer `matpow ... mod`
and calls `prepareMatrixPower`. This is also active with compilation disabled:
it avoids constructing astronomically large unreduced powers, retains exact
BigInt arithmetic, and preserves operand validation/evaluation order.

Original diagnostics show 55 compiled loops, 22 Number loops, 16
`number-loop:condition-work` fallbacks, and **zero Number overflows**.
Scalar-function proof rejects `R mul A` / `B K J` in the nested helper chain.
This is evidence of incomplete helper coverage, not evidence that rank-2
reads are universally unsupported. Moving the product's modulo inside the
assignment leaves these diagnostics unchanged. Do not raise copy thresholds
or replace exact products (up to approximately 10^18) with floating point.

There is a general follow-up opportunity in whole array-returning function
compilation and modular matrix-product kernels. No compiler patch is required
to use the already implemented library path in this demo; no general compiler
fix was established or measured by this investigation.

## Verification and measurement

`experiments/euler377-verify.mjs` independently computes counts and digit sums
by direct DP up to 13^4, without matrices. The original and all three proposed implementations match
for Terms 0 through 4, in compiled and reference execution (40 checks).
Full Terms=17 runs assert the established answer `732385277`; Terms=1 asserts
`856884757`. The demo fixture covers empty input, the first term, successive powers and
the full default answer. All four pass in both engines on Mac and Intel.
Focused linalg, modular-matpow and demo-numerical suites pass: 66 tests, 3 files.
Full exhaustive audits were not run.

Fresh-process samples measure execution including parsing; peak RSS is for the
whole Node process, including runtime initialization. Runtime snapshots isolate
the baseline from unrelated changes in the shared workspace. Node 24.15.0 was
used on the Apple M5 Mac and the Intel host `root@jack.lan`. Three alternating
samples per variant/mode are recorded in the accompanying baseline JSON.
An initial Mac series overlapped local correctness verification and was
discarded; it is retained separately in the raw data.

## Results

Medians of three fresh processes; times in seconds, RSS in MiB.

| Host | Variant | Mode | Time (range) | Peak RSS median |
| --- | --- | --- | --- | --- |
| mac | original | compiled | 0.721 (0.638–0.936) | 188.3 |
| mac | library | compiled | 0.184 (0.183–0.197) | 187.9 |
| mac | reuse | compiled | 0.116 (0.111–0.123) | 176.1 |
| mac | original | reference | 9.987 (8.991–10.223) | 354.7 |
| mac | reuse | reference | 0.118 (0.112–0.210) | 174.3 |
| intel | original | compiled | 1.963 (1.933–2.072) | 172.1 |
| intel | library | compiled | 0.494 (0.490–0.497) | 169.1 |
| intel | reuse | compiled | 0.317 (0.316–0.320) | 163.3 |
| intel | original | reference | 34.803 (32.789–35.600) | 297.9 |
| intel | reuse | reference | 0.299 (0.297–0.336) | 162.8 |

The shared Mac has visible timing variation; all samples are retained.
The same improvement on Intel supports the direction without assuming equal
speedups across architectures. RSS is process-wide, not matrix storage alone.

Reproduce from the repository root, setting RUNTIME to the isolated built
interpreter entry point:

```sh
node benchmarks/euler377-investigation.mjs benchmarks/experiments/euler377-original.ra compiled 17
node benchmarks/euler377-investigation.mjs benchmarks/experiments/euler377-reuse.ra reference 17
node benchmarks/experiments/euler377-verify.mjs
```
