# Euler 564: partition batches and fused real functions

Base: `f0f8736831f90af3decff7059d818442812a315e`.
Full result: **12363.698850**. The original source is retained in
`fixtures/euler564-original.ra`.

## Program

The search enumerates nonincreasing partitions of the excess above unit side
lengths. A breadth-first array frontier generates only permissible children.
The multinomial probability accounts for all ordered compositions represented
by each partition. Log factorials avoid overflowing the probability arithmetic.
Run lengths combine equal sides before evaluating their angles. Geometry is
processed in batches of 4096 rows rather than retaining a full dense histogram
and its angle temporaries. The Rank source has no explicit loops.

The radius search uses t=1/(2R). Safeguarded Newton steps remain inside a
bisection bracket and handle both an interior and an exterior circumcenter.
The stopping residual is scaled by 1/(4t²), the local area sensitivity; this
is a numerical stopping criterion, not a formally certified interval bound.
Near-semicircle endpoints are handled separately. The iteration cap is 50.

The independent JavaScript oracle uses 100 bisections, exact BigInt factorial
weights and compensated sums. Ordered compositions independently check the
small cases. All 48 full-scale means and prefixes are compared; the largest
observed mean difference was 2.73e-11, and every prefix rounds identically to
six decimals. K=0,1,2 return zero; K=3 and K=4 also have analytic checks.

## Shared implementation

Numeric array functions now fuse `sqrt`, `asin`, `log` and `exp` into their
elementwise traversal, including tuples and multidimensional broadcasting.
Builtin identities, physical representations and finite results remain
guarded. Invalid domains and nonfinite results replay ordinary evaluation,
preserving its errors. Scalar real return/reduction compilation is unchanged.

Equal-shaped vector programs use their output length as the loop bound, so
different extents can reuse generated code. Broadcast layout distinctions and
the existing bounded cache remain; concat pieces keep their individual bounds.

Real keyed folds also accept private stored Int64 keys. Word reads preserve
exact index validation without allocating a BigInt per key. Invalid high words
retain the ordinary error contract. Shared/opaque inputs and bounded observation
retain fallback; cooperative cancellation remains supported.

## Measurements and verification

Primary measurements and host details are recorded in
`baselines/2026-11-10-euler564.json`. Fresh-process timings include parsing and
execution, excluding interpreter imports; RSS is the process high-water mark.
The old full compiled baseline has one sample per host; new compiled/reference
and new-source/old-runtime controls have three. Full old reference execution
was not measured. K=10 reference comparisons are single samples and include
startup effects, so they do not establish a full-scale reference speedup.

On Mac, old compiled execution took 31.178 s / 496.1 MiB. New compiled median
was 5.085 s / 543.0 MiB; new reference was 9.055 s / 547.5 MiB. The new source
on the old runtime took 6.420 s / 528.7 MiB. The speed gain therefore includes
both algorithm and shared implementation improvements. Peak memory increases
modestly against the original baseline; this is not a memory-saving claim.
A 1024-row geometry batch was slower without reducing peak RSS.

On Intel i7-10750H x64, old compiled execution took 126.003 s / 472.1 MiB;
new compiled median was 15.703 s / 368.0 MiB and new reference was
25.896 s / 380.6 MiB. The new-source/old-runtime control median was
18.859 s / 372.3 MiB. Thus the memory outcome differs across architectures.
Both hosts used Node v24.15.0. An unrelated nightly benchmark worker remained
active on Intel; sampled one-minute load ranged from 1.65 to 4.57. These are
loaded-host measurements, not an isolated cross-architecture comparison.

Passed: TypeScript build; 274 focused checks across eight files on each host,
including all full-scale means on compiled, exact and reference modes; two
filtered differential checks on each host, two Mac inferred-type and two
name-fact checks; five
exclusion-policy checks. Full exhaustive audits and full npm test were not run.

```sh
node benchmarks/euler564.mjs compiled
node benchmarks/euler564.mjs reference
node benchmarks/euler564.mjs compiled 10
```

`RANK564_RUNTIME` selects a built interpreter; `RANK564_EXPECTED` checks the
answer. Diagnostics and profiling are separate from primary measurements.
