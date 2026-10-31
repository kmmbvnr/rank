# Numeric array stages: dimensions and real values

The numeric loop compiler now carries each array stage's shape and element
type separately from its flat row-major cell traversal. This extends the
Euler 299 rank-one integer work without changing ordinary binding semantics.

Supported by the new path:

- Eager real/mixed arrays of arbitrary positive rank for pointwise +,-,*,/
  arithmetic, with the existing trailing-axis broadcasting. Generic
  integer stages such as multidimensional gcd can join the same region.
- A full `sum` consumer, fused with its pointwise expression.
- Rank-one real mask filters, alongside integer filters.
- Fresh real arrays and their indexed writes inside numeric regions, including
  real arrays initialized with an integral-valued fill such as `0.0`.

Real values use Float64 storage, including negative zero, NaN and infinities.
Real sums retain row-major left-to-right addition, starting with zero; they
are not reassociated. Empty real sums replay the ordinary path to preserve
the integer-zero identity. Integer cells/intermediates retain checked safe
arithmetic and exact replay on overflow. Shape and division failures also
replay to retain ordinary errors and completed bindings. Unsupported views,
rank modifiers, axis reductions and operators retain their existing paths.
Multidimensional row filtering has not been added here.

Broadcast shape and strides are prepared once per pointwise stage. Equal-shape
operands use their linear offset directly; broadcast operands use aligned
strides with zero strides for singleton axes. Each leaf is addressed directly in the final broadcast frame; repeated leaves
share an offset. This avoids remapping through each intermediate expression
and avoids exponential source growth in nested expressions.
The existing rank-one fast path remains separate. Dead private buffers are
reused within an invocation; bindings, aliases and operand buffers remain
pinned until they are no longer observable.

## Verification

`test/number-loop-vectors.test.ts` compares the new path with both compilation
disabled and Number-loop compilation disabled, including shape, scalar type,
formatted values and completed state on errors. It covers rank-two/rank-three
broadcasts with varying cells, zero dimensions, mixed integer/real arithmetic,
rounding-sensitive sums, negative-zero publication, nonfinite real results,
integer overflow, alias retention and demand budgets.

The ordinary suite found a real-storage integration bug in Euler 314: fresh
arrays filled with `0.0` were admitted to the numeric region but allocated as
Int32 arrays. Passing the element type into allocation fixes the truncation
and publication contracts; a dedicated fresh-matrix regression supplements
the existing dense-envelope test.

Final validation: 447 ordinary interpreter test files / 10269 tests passed,
including all 48 numeric-stage tests; exhaustive audits were excluded. The
TypeScript project build passed. All 1600 independent Euler 299 geometric
comparisons passed after the extension, and every full rank-one control kept
the answer 549936643.

## Benchmark method

Five serial fresh processes for each case/version, rotating case order.
Baseline: archived 40adaba7 interpreter build. Current: local numeric-array
compiler changes. Node v24.15.0, macOS arm64. No own tests or builds overlap
timing. Parsing/execution are timed; interpreter import/process startup is
excluded. Peak RSS includes the runtime and inputs, not just output buffers.
Other machine load remains uncontrolled.

The working tree also received independent changes during this investigation,
including aaedb254 (lazy array resource/stored summaries). These comparisons
against 40adaba7 measure the combined working build, not an isolated causal
estimate for this patch, especially for RSS. At delivery, main had advanced to
bb42b9e5 (integer tensor-copy Number registers); compatibility was rechecked
with 399 focused tests and the TypeScript project build. The timing tables
were not rerun against that later commit.

Each case computes 262144 output cells twelve or 120 times, retaining ordinary
`C =` bindings and then summing `C`. Both workloads are reported; preparation
cost matters especially in the shorter one. Matrix cases use 512×512 arrays; the broadcast
case combines 64×1×64 with 1×64×1, yielding 64×64×64. Exact representable
constants give an independent closed-form sum checked in every process.

```
node benchmarks/experiments/numeric-array-stage-samples.mjs /absolute/baseline/packages/interpreter/out/index.js
DIAGNOSTICS=1 node benchmarks/experiments/numeric-array-stages.mjs real-broadcast
```

Raw measurements: `baselines/2026-10-31-numeric-array-stages.json`.


## Measurements and backend choice

The unrestricted prototype sent even simple multidimensional integer
arithmetic into the Number region. Its checked per-cell operations lost to
existing dense integer kernels: at 120 passes the unrestricted prototype had
median 240 ms versus baseline 157 ms (same-run comparison, raw
`2026-10-31-numeric-array-stages-120-universal.json`). Existing native kernels
can prove integer bounds and omit checks. This is not a reason to replace
those kernels with a generic checked region.

The final compiler retains the existing backend for ordinary multidimensional
integer names/literals and +,-,* expressions until a region already requires
private vector stages. New real/mixed expressions and operators such as gcd
use the private numeric path. No cell-count threshold was introduced.

Final matched measurements (medians, baseline/current):

| Case | 12 passes | 120 passes | Peak RSS at 120 passes |
| --- | ---: | ---: | ---: |
| Integer matrix, existing backend retained | 148 / 151 ms | 254 / 269 ms | 235 / 238 MiB |
| Real matrix | 205 / 183 ms | 660 / 340 ms | 250 / 184 MiB |
| Real 3D broadcast | 197 / 218 ms | 830 / 657 ms | 245 / 167 MiB |

For long real workloads these samples show about 1.9x and 1.3x speedups,
with peak RSS about 26% and 32% lower. On the short 3D case preparation
outweighs the benefit; it is about 10% slower by medians. Integer execution
retains its previous backend, with no established speed/memory improvement.
Do not generalize these results to every expression or to Intel.

The host is busy and ranges are wide. For 120 passes, baseline/current ranges
were 205–443 / 190–395 ms (integer), 624–1391 / 326–665 ms (real matrix), and
692–1555 / 514–893 ms (real broadcast). The final rank-one Euler 299 control,
three fresh processes per version, remains correct at 549936643: median
2.879 / 1.443 s and peak RSS 569 / 161 MiB against 40adaba7. Its wide time
ranges (2.461–3.809 / 1.329–2.287 s) cannot establish a small regression versus
an earlier run under different load.

The real 3D diagnostic run uses one Number region, no tensor kernels and no
Number overflow. Diagnostic execution is separate from timed samples.

Additional raw data:

- `baselines/2026-10-31-numeric-array-stages-120.json`
- `baselines/2026-10-31-numeric-array-rank1-control.json`
- `baselines/2026-10-31-numeric-array-stages-initial.json` (initial index prototype)

Use an optional final argument `120` on the sample runner to reproduce the
longer workload. Production Euler demos and issue #447 remain unchanged.
