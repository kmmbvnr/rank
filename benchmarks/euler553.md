# Euler 553: generating-series convolutions

Base: `46af06bdf298b3bd5d25dd17ff8ddd155d811e06`.
Full result N=10000, K=10: **57717170**.

## Cause and program change

The original program computes three quadratic coefficient recurrences. Its
four explicit loops already compile to Number loops without overflow replay;
this is not a missing compilation path. Reference execution repeatedly forms
slices and modular product arrays, with much higher peak memory.

The rewrite retains the generating-function derivation. If
R(r)=2^(2^r-1)-1, set F(x)=1+exp(-x)*sum R(r)x^r/r! and H(x)=log F(x).
The answer is N!/K! times [x^N] exp(x)H(x)^K. Since H starts with x, shift out
x^K and retain only degree N-K. Newton doubling computes 1/F, then F'/F and
integration give H/x. Binary convolution powering computes (H/x)^K. All
products use the existing exact modular `convolve` library operation. Powering
starts at the constant polynomial 1, avoiding an unnecessary padded transform.

Factorials use a modular scan; one scalar inverse and a reverse modular scan
produce reciprocal factorials. Their adjacent ratios supply reciprocal
integers. A product of K+1 through N supplies N!/K!, avoiding factorial arrays
up to N when K is close to N. Empty families and K>N are handled directly.
The Rank program has no explicit loops and every line fits 40 columns.

## Shared runtime improvement

The three CRT/NTT prime passes now share invocation-private transform scratch
arrays. Independent residue outputs survive; input arrays and earlier results
are unchanged. A product allocates two transform buffers instead of six; a
square allocates one instead of three. There is no persistent workspace cache.
Schoolbook and directly supported single-modulus transforms retain their paths.
This helps every program using modular convolution, with compilation enabled
or disabled. No compiler admission limit or Number threshold changes.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Three alternating
fresh-process pairs per mode and input. Time includes parsing/execution and
excludes importing the runtime. Every sample verifies the exact answer or the
actual unchanged Rank fixture's assertions. RSS is process high-water memory.

| Host/mode | Old seconds | New seconds | Old peak MiB | New peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64, compiled | 2.236 | 0.402 | 191.1 | 194.0 |
| Mac arm64, reference | 2.173 | 0.423 | 957.2 | 195.3 |
| Intel x64, compiled | 5.561 | 0.791 | 179.8 | 184.9 |
| Intel x64, reference | 7.215 | 0.836 | 353.9 | 185.2 |

The four-case fixture is small enough that setup dominates. Its medians are:
- Mac arm64 compiled: 0.179 -> 0.186 s
- Mac arm64 reference: 0.156 -> 0.174 s
- Intel x64 compiled: 0.452 -> 0.478 s
- Intel x64 reference: 0.438 -> 0.436 s

Mac crossover controls: new source/old runtime 0.403 s / 200.7 MiB;
old source/new runtime 2.244 s / 187.9 MiB. Intel: 0.842 s / 189.5 MiB
and 5.737 s / 182.5 MiB. The workspace change removes two thirds of the
transform-scratch allocation volume in a three-prime call; these single
controls do not establish a separate small speed gain.

The full algorithmic gain is present without compilation. Crossover controls
(new source/old runtime and old source/new runtime) separate that change from
the smaller scratch-allocation improvement. These controls are single samples.
The additional few MiB on the compiled full solver are reported explicitly;
reference execution avoids hundreds of MiB of temporary arrays.

Single full-input old/new controls for the unchanged convolution users:

| Demo | Mac seconds | Intel seconds |
| --- | ---: | ---: |
| 519 | 0.456 / 0.464 | 0.910 / 0.869 |
| 529 | 4.296 / 4.317 | 10.926 / 10.836 |
| 537 | 0.348 / 0.347 | 0.661 / 0.649 |

Every control checks its full exact result. One pair does not establish small
performance differences; the shared kernel shows no large regression here.

## Verification and reproduction

Passed: TypeScript build; **303 focused checks on each host**; two filtered Mac
differential checks for the full demo and its actual fixture. New semantic
checks exhaustively enumerate all families of nonempty subsets for N<=4 and
count their connected components independently. They also compare intermediate
bounds with the old recurrences, verify the full answer on Number/exact/reference
backends, and test N=1000000 with K=N and K=N-1 against closed forms. Kernel
checks retain inputs and prior CRT outputs across ordinary products and squares.
Full neighbouring 519, 529 and 537 results also pass. The full 553 demo is
restored to corpus execution. Exhaustive audits/full npm test were not run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler553.mjs compiled
node benchmarks/euler553.mjs exact
node benchmarks/euler553.mjs reference
node benchmarks/euler553.mjs compiled fixture demos/euler/553_powersetsofpowersets_test.ra
node benchmarks/euler553.mjs compiled 10000 benchmarks/fixtures/euler553-original.ra
```

`RANK553_RUNTIME` selects a built runtime; `RANK553_K` changes K;
`RANK553_EXPECTED` checks a golden result. `RANK553_MODULE` selects the source
loaded by the fixture. Diagnostics/profiling are separate opt-in measurements.
Raw results are in `baselines/2026-11-09-euler553.json`.
