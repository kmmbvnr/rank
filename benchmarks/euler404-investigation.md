# Euler 404 investigation

Historical research at `be4dce18`. The implementation and final controlled
measurements are described in [the delivery report](euler404-followup.md).
The historical compiler loader below requires the research base; the final
series script measures the delivered implementation.

Research base: `be4dce18`, Node 24.15.0, 2026-11-04. Issue #447 still lists
`euler/404_crazyellipses.ra` as unfinished; Euler 401 is complete. No production
source, audit exclusions or GitHub status changed in this investigation.

## Findings

The existing conic parameterization avoids enumerating ellipses individually.
Its remaining O(sqrt(N)) search is still large: approximately 137 million
(m,n) pairs at N = 10^17. The main avoidable cost is completing many array
stages for every pair, including pairs subsequently multiplied by zero.

Original diagnostics report 418,986 typed publications and 2,464,789,896
published cells; these count allocation traffic, not simultaneously live
storage. There are no copy-on-write copies. Only 46,806 tensor kernels run;
the outer loop declines with `loop:unbound-name:NameExpression` at `Ns` while
trying to compile the gcd expression. Other operations use stored-array native
kernels and interpreted dispatch, so enabling compilation alone is insufficient.

At N = 10^12, the original takes 0.421 s reference / 0.447 s compiled on Mac
(single exploratory samples, including startup parsing). Both produce
11992009413. This is not a full-scale reference benchmark.

## Full-scale controls

All completed full-scale controls produce **1199215615081353**.

| Variant | Mac seconds / peak MiB | Intel seconds / peak MiB |
| --- | --- | --- |
| Original | 23.811 / 1352.7 | 48.820 / 435.0 |
| Select valid Ns before geometry | 20.535 and 17.467 / 702.4 and 713.4 | 41.432 / 431.1 |
| Bounded scalar loop | 28.012 / 176.5 | 28.750 / 165.5 |
| Count before gcd, scalar | 29.120 / 175.3 | 35.187 / 163.0 |
| Hand JS, checked narrow geometry + exact wide arithmetic | 9.530 / 51.5 | 10.318 / 52.9 |

The Mac original is bracketed by the two selected-array runs in one sequential
series. Other Mac entries are exploratory and overlap other work; external
machine load changed substantially. Original exploratory times ranged from
21.156 to 39.391 s. Intel variants were sequential but have one sample each.
These are evidence of direction and remaining headroom, not stable speedup
medians. The manual JS excludes runtime type/storage publication, precise Rank
error attribution, budget/cancellation and compilation/startup contracts.

`euler404-selected.ra` keeps the existing outer loop and array operations:
filter Ns by coprimality and the modulo-5 condition, then compute geometry
only for survivors. It eliminates the two 0/1 mask arrays. The Mac peak drops
about 48%; Intel RSS is almost unchanged. It is a useful candidate, but does
not resolve the compiler gap.

## Compiler experiment

The in-memory loader `euler404-range-copy-prototype.mjs` admits copied finite
progressions as fresh private vectors and routes grouped native vector calls
through the same scalar operands. Used with inline boolean selectors instead
of completed boolean mask variables, this compiles the entire array loop on
safe inputs. Completed boolean array stages in the original remain unsupported
by this route. This is a research patch: production admission needs alias,
error-location, rebound builtins, cancellation and budget regression coverage.

At N = 10^14, the same selected-array source on Mac, three fresh processes per
backend in alternating order:

| Backend | Median seconds | Median peak MiB |
| --- | --- | --- |
| Existing compiler | 1.703 | 467.9 |
| Prototype compiler | 0.404 | 204.2 |

The same six-process alternating series on Intel gives **4.734 → 0.826 s**
(about 5.7x) and **406.3 → 181.4 MiB**. Thus the safe-input compiler benefit
is observed on both architectures, with lower memory.

Answer **1199214189437** agrees in every run. The prototype enters one Number
loop; the control enters none. This isolates a roughly 4.2x compiler opportunity
on that safe input, separately from rewriting the algorithm.

At full N = 10^17, the prototype declines `number-loop:unsafe-input`: N and
2N exceed safe Number integers. Products U*V can also exceed that range.
The existing mixed wide scalar path supports the scalar control, but does not
carry this private vector pipeline through the required exact operations.
Simply removing guards would lose integer precision. The full prototype falls
back and still produces the original exact answer; it is not a full-scale
compiler optimization yet.

Recommended implementation order:

1. Support copied finite progressions and canonical native-call grouping in
   private vector stages, with the normal entry guards and error contracts.
2. Extend mixed exact/Number lowering to these vector consumers, keeping wide
   products, division and inputs exact. Complete boolean stages also need a
   representation if the original program is to compile unchanged.
3. Apply the selected-array rewrite if repeated Mac/Intel comparisons retain
   its benefit. Keep the array formulation and avoid helper wrappers solely
   to persuade the compiler.

## Other experiments

A smaller exact upper bound is
`Top = (64 * N // 25) isqrt isqrt`.
For t=n/m in (1/2,1), the raw U*V polynomial divided by m^4 is increasing
from 25/8; normalization divides by at most 4. A nonzero contribution requires
m^4 < 64N/25. This only removes about 8% of pairs: the old
`3 * N isqrt isqrt` already means the fourth root of 3N, rather than three
times the fourth root. It is not a large algorithmic speedup.

For positive U,V, `2*N // U // V` exactly equals `2*N // (U*V)`. This avoids
the product array but adds another division pass. Exploratory results do not
establish a useful gain: selected-array 25.467 vs selected/divide 25.821 s,
about the same RSS. Keep the clearer original until controlled results justify
changing it.

Moving only the modulo filter before gcd, hoisting the scalar parity, lazy
names, and introducing a named helper/consumer did not establish a better
full-scale portable candidate. Replacing completed arrays with lazy names
alone declines loop compilation; it is not a solution to materialization.

## Correctness and reproduction

`euler404-verify.mjs` makes **126 cross-mode comparisons**: seven variants,
both engines, nine limits (0,1,208,209,210,500,1000,10000,1000000). The first
seven expected values come from independent direct (a,b,c) enumeration using
an exact rational c^2 and integer-square check. The last two are published
[problem statement checkpoints](https://projecteuler.net/problem=404).
The same 126 checks pass with the compiler prototype loaded.

The full answer agrees between the original, every retained full-scale
candidate, and the hand JS on both hosts where measured. That is a full-size
agreement check, not an independent full-size geometric oracle.

From the repository root:

```sh
node benchmarks/experiments/euler404-verify.mjs
node benchmarks/euler404-investigation.mjs \
  benchmarks/experiments/euler404-selected.ra \
  100000000000000000 compiled
node --import \
  ./benchmarks/experiments/euler404-range-copy-prototype.mjs \
  benchmarks/euler404-investigation.mjs \
  benchmarks/experiments/euler404-selected.ra \
  100000000000000 compiled
```

Intel host connectivity was verified through `ssh -p 22022 root@viewflow.io`;
measurements used the isolated `/tmp/rank401-final-20261104` runtime snapshot,
which has the same interpreter implementation as the research base.
Raw observations and source hashes are in
`baselines/2026-11-04-euler404-investigation.json`.
