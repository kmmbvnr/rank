# Euler 752: native batches of exact 2x2 modular matrix powers

Issue: https://github.com/kmmbvnr/rank/issues/554

The Rank solution is unchanged, including the direct expression
`Base matpow Exp rank 2 0 mod Mods`. There is no new builtin, wrapper or Rank
bit loop, and no change to candidate generation, factor stripping or period
aggregation. The full answer remains `5610899769745488`.

## Full-input measurements

Baseline runtime: main `b75ee8e1`. Node v24.15.0 on the local arm64 Mac and the
x64 Intel host. Both use Limit=1000000 and the same Rank source, frozen in
`fixtures/euler752-original.ra` (SHA-256
`c2a783e034c3baf11b407496ba173cadb3e96adc6eaafaaa095018437dfcee41`).

Each host ran one baseline and three serial final fresh processes, with no
profilers or diagnostics in these measurements. Times include Rank parsing
and execution; the independent oracle runs before timing. Other host load
and CPU frequency were not controlled. Baseline variance was not measured,
so ratios compare one baseline with a final median, not two distributions.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac arm64 | 199.74 | 29.11 / 32.99 / 31.51 | 6.34x | 4038.78 | 2828.55 |
| Intel x64 | 477.78 | 86.98 / 89.29 / 91.37 | 5.35x | 3981.86 | 2826.71 |

All runs matched the oracle. Median peak RSS fell 30.0% on Mac and 29.0% on
Intel; every final peak was below its host's baseline. RSS is a process
high-water mark, not live matrix payload or cumulative allocations. The older
239-second/3.16-GB observation in the issue is not used as this baseline.
Raw samples and calculated medians are in `results/euler752/`.

## Profile the complete workload before choosing a change

A separate complete Mac run used CPU sampling, 64-KiB heap allocation sampling
including objects collected by minor/major GC, diagnostics and five source
stage markers. An equivalent final profile used the same instrumentation.
These runs are excluded from the timing series above; profiling changes GC
behavior and its RSS must not be substituted for plain-run RSS.

| Stage | Baseline seconds | Final seconds |
| --- | ---: | ---: |
| Prime-power setup, including parse | 0.20 | 0.16 |
| Candidate construction and column assembly | 16.96 | 15.26 |
| Matrix powers and result-column reads | 194.90 | 2.08 |
| Order-table aggregation | 0.22 | 0.18 |
| Composite periods and final sum | 22.15 | 16.03 |
| Whole profiled execution | 234.43 | 33.71 |

The matrix stage occupied about 83% of the original profiled execution. CPU
sampling led with garbage collection (61277 self samples), `derivedArray`
(14569), `resultAt` in linear algebra (10725), `createOwned` (9897), `settle`
(6401) and `matmulValues` (4086). Repeated tiny matrix products created Rank
arrays, coordinate arrays, validators and intermediate integer results.

The allocation sampler estimated 186.74 GB of cumulative JS heap allocations
before and 38.66 GB after, about 79.3% less. This is a sampling estimate,
including already-collected objects, not retained heap or a complete measure
of native ArrayBuffer payload. Before, major allocation stacks ran through
`matmulValues`, `derivedArray`, `settle` and `resultAt`. Summaries preserve
sample counts, locations and inclusive allocation stacks.

Candidate construction had already reached approximately 1.83 GiB RSS before
the original matrix stage. After optimization, candidate construction and
ranked period callbacks dominate the remaining time and memory. The work
there has not been hidden by changing the Rank algorithm.

## General native kernel and exactness

The existing ranked modular path already snapshots stored integer matrices
and nonnegative exponents before evaluating the modulus. That path now
recognizes square 2x2 batches with positive per-matrix moduli at most 2^26 and
exponents at most 2^53-1. Broadcasted matrices, exponent frames and uniform
per-matrix moduli retain their existing shape/addressing rules.

Initial integer matrix cells may be arbitrarily wide. They are reduced with
BigInt before conversion, so the native registers contain only canonical
residues in [0,m). For this domain every two-term matrix-product dot product
satisfies

```
2 * (m - 1)^2 <= 2 * (2^26 - 1)^2 < 2^53.
```

All products, additions and remainders are therefore exact integer operations
in Number registers. The general 2x2 squaring identities use the same bound;
there is no assumption about the Euler matrix's entries or algebraic form.
Exponents are halved arithmetically, preserving bits above bit 31. The result
is published as integer storage, not as Rank real values.

Four matrix entries and four accumulator entries stay in scalar registers.
The entire batch writes one Int32 output buffer. A small normalization buffer
is reused while the source matrix and modulus are unchanged; no matrix
wrapper or result array is allocated per square/multiply. For the full input,
all 577817 logical powers take this path in one batch; its 2311268 output
cells need about 8.82 MiB of numeric payload.

Larger moduli/exponents, other matrix sizes and unsupported storage retain
the existing exact modular implementation, with bounded modular intermediates.
Real and negative-power behavior, invalid-modulus fallback and errors before
modulus effects remain on their old paths. The modulus and operands are not
reevaluated. The snapshots preserve matrix/exponent mutations caused by the
modulus expression.

New native execution declines under inspection, observable host polling and
demand budgets. Atomics-only cancellation remains supported by bounded checks
in preparation and between groups of at most 64 safe-exponent powers. The
output remains private until the batch finishes; inputs are never mutated.
`modularMatrixPowers` keeps its existing logical count, while
`nativeModularMatrixPowers` and `nativeModularMatrixBatches` expose the new path.

## Verification and audit scope

The TypeScript build passed. Both hosts passed 114 focused tests in four files.
An independent BigInt matrix-product oracle checks signs, arbitrary-width
initial cells, modulus 1, the native modulus boundary, exponent bits through
2^53-1, scalar exponents, multidimensional broadcasting and varied matrices.
Tests also cover exact fallback just beyond the bounds, operand mutation before
modulus effects, opaque readers, cancellation, budgets and existing linear
algebra behavior, in both compilation modes where applicable.

The Euler tests compare Limits 2,4,5,7,10,25,49,100,343,1000 with the existing
independent sequential prime-factor stripping/prime-power lifting oracle.
They retain the orders for 5,7,25,49,343 and the composite period for 35.
The oracle's arithmetic and algorithm were not changed: the benchmark module
now exports it, and direct CLI execution remains guarded separately.

Every full timed/profiled run also checks that oracle. Additionally the exact
command supplied in the issue passed on both hosts:

```
node benchmarks/euler752-investigation.mjs 1000000
```

Those separate CLI validations returned the full answer in 29.30 seconds on
Mac and 90.31 on Intel. They are validation runs, not extra final-series samples.

The routine corpus-audit exclusion was reconsidered and retained: about 32
seconds and 2.8 GiB on arm64, and about 89 seconds on Intel, still make this
an expensive repeated corpus case. Its reason now points to the current
measurements. Small fixtures remain eligible. No full ordinary suite or
exhaustive audit was run.

## Reproduction

Build from the repository root:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler752.mjs 1000000
```

The driver uses the independent oracle outside the timed region. Its first
argument is Limit; the optional second argument `reference` disables compiler
optimizations. `RANK_SOURCE` selects a fixture. For a separate full profile:

```sh
STAGES=1 DIAGNOSTICS=1 \
  PROFILE=/tmp/euler752.cpuprofile \
  HEAP_PROFILE=/tmp/euler752.heapprofile \
  node benchmarks/euler752.mjs 1000000
```

Stage markers only instrument the profiling source; plain runs use no markers.
`RANK_ROOT` can select another built runtime. To reproduce baseline memory
measurements, copy the same driver and oracle-export harness into a disposable
`b75ee8e1` checkout, build its own outputs and point workspace package links
at that checkout. Do not silently reuse current interpreter outputs or load
two interpreter copies through mismatched workspace links.

From `packages/interpreter`:

```sh
node scripts/test.mjs test/native-modular-matrix-batch.test.ts \
  test/modular-matpow.test.ts test/euler752.test.ts test/linalg.test.ts
```
