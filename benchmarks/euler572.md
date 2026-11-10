# Euler 572: batched projections and private deferred loop stages

Base: `01b7bd09f2e98dd5b4c81ff6f0641f9a34ed0a1e`.
The default bound N=200 retains **19737656** idempotent integer matrices.

## Algorithm and Rank program

Every nontrivial 3x3 idempotent is p w^T or I-p w^T, with primitive integer p
and p.w=1. Coordinate permutations and sign changes let p=(A,B,C), with
A>=B>=C>=0. An orbit multiplier and division by two account for all signs and
the redundant pair (-p,-w).

The old program scanned five nested scalar loops and evaluated all nine box
constraints for each accepted dot product. The new program has one outer loop
on A, with bounded tensors for the triangular (B,C) frontier and the w2,w3
square. Nonprimitive p is discarded before the large broadcast. Only positions
with an integral w1=(1-B*w2-C*w3)/A enter subsequent checks.

For A>4R the inverse enumeration is smaller: broadcast w1,w2,w3 and B,
then solve C=(1-A*w1-B*w2)/w3 for nonzero w3. Keep integral 0<=C<=B.
The dot product automatically proves primitivity. After sign redundancy, each
solution has weight 24, or 12 when A=B, B=C or C=0. Those exceptional cases
cannot overlap for primitive p with A>=2. For w3=0, solve B instead; the sum
over all C=0..B contributes 48B. No division by zero enters the tensor.
The crossover compares the approximate search sizes 8AR^3 and 2A^2R^2,
rather than introducing a bound-specific table. Both branches are array helpers
without loops; the caller has the sole outer loop.

Let R=floor(N/A). The rank-one condition is simply |w1|<=R. Rank-two conditions
are identical except at the box boundaries:

- If A divides N, remove w1=-R and cases B*w2=-N or C*w3=-N.
- If A divides N+1, add w1=R+1 when B<A.
- Otherwise both rank counts coincide.

This follows from the diagonal interval 1-N<=p_i*w_i<=N+1 and the already
bounded off-diagonal products. The three A=1 patterns have orbit sizes 6,12,8.
For (1,0,0), both counts are (2N+1)^2. For (1,1,0), both are 2N(2N+1).
For (1,1,1), rank-one count is 3N(N+1) and rank-two count is 3N^2. Their
weighted contribution is 96N^2+60N+6; adding zero and identity gives the initial
polynomial. The N=0 edge case is corrected to 1: identity lies outside its box.

The program has one loop, no nested loops, and lines within 40 columns.
All arithmetic remains exact. Flattening the coordinate tensors explicitly
made both engines slower and was not adopted.

## Shared compiler change

A fresh arithmetic/comparison recipe inside a function loop can remain deferred
until an eager `indices`, `copy` or `sum` consumer. The proof keeps only closed
private stages whose captures are completed private bindings or scalar
parameters. Escaping/public plans, rebindings before the last consumer,
unknown calls and unsupported expressions retain ordinary execution. Ordinary
`=` bindings retain their completion boundaries.

Unused erroneous recipes are never computed. Unknown captured names still fail
at construction; demanded arithmetic errors replay at their ordinary location.
Proofs retain syntax only, and new invocations get fresh values. Budget and
inspection execution retain ordinary publication; cancellation preserves its
existing guarded path. Tests cover both supported stages and fallback cases.

A separate eligibility repair lets a numeric helper reach its own bounded
region proof even when it exceeds the generic block dispatcher's 64 statements.
The existing numeric proof budget remains 128; neither constant is raised.
When numeric guards fail, the ordinary body executes, including exact replay
after overflow. Tests cover repeated calls, empty arrays, type errors and
source locations, budgets, interruption and inspection.

The demo's fastest form uses an eager mask. An unchanged private-helper fixture
with a quoted mask separately measures the compiler improvement. Merely removing
the deferred-binding rejection would compute unused recipes prematurely and
would not preserve the language's error contracts.

## Measurements

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.344 | 0.358 | 194.0 | 221.3 |
| Mac reference | 24.738 | 0.675 | 448.9 | 322.2 |
| Intel compiled | 0.830 | 0.848 | 199.1 | 193.9 |
| Intel reference | 67.595 | 1.682 | 423.1 | 295.3 |
| Mac private quoted helper | 3.542 | 0.528 | 364.3 | 195.2 |
| Intel private quoted helper | 9.141 | 1.425 | 320.9 | 185.5 |

The reference program is 37-40 times faster. The full compiled demo stays
close to the old nested-loop kernel (4% slower on Mac, 2% on Intel in these
samples), rather than showing a compiled speedup. Mac compiled peak RSS grows
by 27 MiB; Intel compiled and both reference peaks decrease. The former
single-direction tensor prototype took about 0.462/1.193 seconds compiled,
so inverse enumeration avoids most of its compiled overhead.

The unchanged quoted-helper control isolates the general deferred-stage change:
6.7x faster on Mac, 6.4x on Intel, with substantially lower RSS. The main does
not need a quoted mask. Its new source on the old runtime took 2.037 seconds
and 321 MiB on Intel; allowing the large numeric helper to compile removes
that separate cost. On Mac, transient load affected the single controls, so
three additional old/new runtime pairs were taken: unchanged original source
medians 0.366/0.365 seconds, new source 0.989/0.372 seconds. Raw outliers are
retained; no speedup is claimed from the isolated original-source control.

Three alternating fresh-process old/new pairs per mode and host, with the full
N=200 input and exact answer checked in every sample. The private-helper pairs
use the same source on old/new runtimes. Node v24.15.0, Apple M5 arm64 and Intel
i7-10750H x64. Diagnostics and profiling are disabled. Time includes parsing
and execution, excluding interpreter import. RSS is the process high-water
mark. Intel source/runtime controls are single samples; Mac controls also have
three additional runtime pairs after a transient slowdown. After the final proof-budget correction, three
additional new-runtime runs per mode/helper retain every exact answer. Mac
main compiled samples span 0.347-1.230 seconds and reference 0.701-1.051,
so the primary medians should not be read as stable latency under other load.
These post-check samples are kept separately in the raw results:
`baselines/2026-11-10-euler572.json`.

## Verification

723 focused checks across 17 files passed on each host. Direct enumeration of
all matrices in boxes N=0,1,2 is independent of the projection decomposition.
Small bounds through 20 match the original search on Number, exact and reference
backends; all three modes retain the full default golden. Separate A=1 controls
check the polynomial against explicit enumeration through N=200. Private-stage
tests cover unused erroneous recipes, demand errors, capture/rebinding,
public/escaping plans, repeated consumers, empty arrays, repeated invocations,
wide arithmetic, scalar parameters, budgets, interruption and inspection.
Unused deferred stages also count toward the unchanged 128-statement limit.
Two filtered differential, two inferred-type and two name-fact checks passed
on Mac for the full main and fixture. Existing function/plan/vector/axis/range
tests pass. TypeScript build and five
exclusion-policy checks pass. Full npm test and exhaustive audits were not run.

```sh
node benchmarks/euler572.mjs compiled 200
node benchmarks/euler572.mjs reference 200
node benchmarks/euler572.mjs exact 200
node benchmarks/euler572.mjs compiled 200 benchmarks/fixtures/euler572-lazy-mask.ra
```

`RANK572_RUNTIME` selects another built runtime. `RANK572_EXPECTED` checks the
answer. `RANK572_DIAGNOSTICS=1` and `RANK572_PROFILE=path` enable separate
instrumented measurements.
