# Euler 590: bounded inclusion-exclusion tensors

Baseline: `bcb76db94ec042a1bc3f9c739c674f497b4cf7b1`.
The delivery also incorporates main's ownership changes through `2f533341`
and the live self-selection repair `c238ddc5`. The old interpreter snapshot
uses the baseline versions of the two modified sequence modules; all other
baseline modules were copied before integration. The runtime JavaScript
manifests were verified identical between Mac and Intel.

The default remains N=50000, with exact answer **834171904**. The old issue's
22-second observation is historical; the fresh baseline is substantially faster.

## Algorithm

If the LCM has prime exponents e[j], inclusion-exclusion counts the sets as
`sum(S) (-1)^|S| * 2^product(e[j]+1-[j in S])`. Equal exponents form a group:
choosing i of c primes contributes `(-1)^i binomial(c,i)` and multiplies the
exponent by `(d-1)^i*d^(c-i)`, where d=e+1. Primes with e=1 form the large
outer group.

The previous program reconstructs each power modulo 10^9 by CRT before
weighting and summing it. The new program computes the total modulo 5^9
and 512 separately, then applies CRT once. Powers modulo 5^9 only need their
exponent modulo 1562500. When the minimum possible exponent, product(e[j]),
is at least nine, every term vanishes modulo 512. Equal exponent residues
can then merge: **10944 states become 2739** at the default input. Sparse
keyed sums avoid allocating a 1562500-cell grouping array.

Small inputs retain both residues and capped exponents without merging states.
This matters when equal residues modulo 1562500 do not establish equal powers
modulo 512. A bounded table stores powers of two through the lesser of the
maximum divisor count and 1562499. The seed supplies its zeroth power.

A scan produces exact binomial coefficients. Batches of **64 choices** bound
intermediate tensors instead of building the full 2739-by-5086 product or
retaining thousands of small per-choice views. Array reductions construct
prime exponents and expand groups. The Rank program has one explicit loop,
no nested loops and no line longer than 40 characters. Existing results for
N=0 and N=1 are preserved.

## General sequence improvement

Runtime-created integer scalar maps with `+`, `-` and `*` now retain an affine
recipe. Consequently `(0 till Count) * 0 + 2` remains a proved progression,
and the existing modular scan can consume its bounds without calculating
wide exact prefix powers first. Both reference execution and compiled consumers
can use the proof; no Euler-specific recognizer or syntax was introduced.

The proof is checked at consumption. Source constructors, every intermediate
reader and exact size must still match their runtime registrations. Changed
methods, observable getters, opaque host plans, budgeted demand, inspection
and host polling decline the shortcut. Empty and zero-stride ranges, negative
strides, scalar-first subtraction and arbitrary-precision bounds are covered.
Registration does not demand a source or evaluate its bounds. Metadata size
errors do not move an ordinary computation's BigInt exception earlier.

## Measurements

Node v24.15.0. Three alternating fresh-process pairs per mode and host; medians.
Time includes parsing and excludes importing the interpreter. RSS is the process
high-water mark. No other task-owned test/build/Node work ran on the same host
during primary measurements. One-minute load was 1.66–1.94 on Mac and 0.81–1.99
on Intel; external workload cannot be excluded. Every run checks the full answer.

| Host / engine | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Apple M5, reference | 3.695 | 0.969 | 306.4 | 279.8 |
| Apple M5, compiled | 3.629 | 1.000 | 337.8 | 280.4 |
| Intel i7-10750H, reference | 9.701 | 2.409 | 274.5 | 272.5 |
| Intel i7-10750H, compiled | 8.141 | 2.560 | 255.3 | 269.1 |

Time improves 3.2–4.0 times. Mac RSS falls in both engines; Intel reference
RSS is roughly unchanged. **Intel compiled RSS increases 13.8 MiB (5.4%).**
This is not a memory reduction on every host. The earlier scalar-choice
prototype was faster on Mac (~0.5–0.6 s), but used ~400 MiB in reference
execution. Batching was selected to reduce that reference memory cost.

An independent 65536-element affine modular scan, without the Euler program:

| Host | Old ms | New ms | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 | 350.6 | 78.4 | 174.8 | 143.9 |
| Intel i7-10750H | 888.4 | 192.7 | 158.8 | 132.3 |

These are also three fresh-process pairs and include parsing. This control
shows the shared sequence improvement outside the Euler algorithm.

Raw samples, source and runtime hashes: `baselines/2026-11-11-euler590.json`.
Reproduce with `node benchmarks/euler590.mjs reference` or `compiled`, and
`node benchmarks/affine-sequence-fold.mjs 65536`. `RANK590_RUNTIME` selects an
alternate interpreter index.js; the Euler driver also accepts N and source path.

## Verification

- 777 focused checks pass on each host after integrating current main. They
  include both full Euler engines, 17 small/power-boundary inputs against the
  original, independent subset-LCM dynamic programming through N=10, and
  mutation/opaque/getter/budget/inspection/cancellation sequence boundaries.
- Both filtered differential files pass, including both fixture test blocks.
  The fixture now asserts the full default answer. The main is restored to
  ordinary corpus execution; no full golden assertion was weakened.
- TypeScript build, 13 runner/semantic policy checks, and 65 semantic owners pass.
- Integration exposed four upstream escaping-slice failures. Compiled publishing
  stores now resolve a returned self-selection through its binding instead of
  copying the RHS. All 94 slice and array-call checks pass; the four previously
  declined cases now compile while matching reference values and errors.
- A separately run existing `numeric-call-loop.test.ts` counter assertion still
  expects four compiled loops and observes zero; values match. It was previously
  reproduced on the clean pre-589 base, and remains unchanged here. These focused
  checks are not a claim that the entire repository suite passes. Exhaustive
  audits were not run.
