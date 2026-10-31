# Euler 295 investigation

Baseline: `dc006139054bfcea814da2a22d396b6947fc05cb`.
The shipping demo adopts the bit-only variant below, retaining the geometric
algorithm, full N=100000 input and answer. Both 295 execution exclusions have
been removed. The fixture keeps its full default and N=10/100/1000 examples,
and adds N=0/1/2. No compiler code or admission thresholds were changed.

## Delivery verification

Three additional fresh serial processes per shipping workload gave medians:

| Shipping workload | Compiled | Reference |
| --- | ---: | ---: |
| Full default | 0.772 s | 13.588 s |
| Extended fixture, three test blocks | 0.845 s | 11.984 s |

These samples omit diagnostic instrumentation. The short difference between
full and fixture reference timings reflects fresh-process/load variation;
there is no claim that running more checks makes the algorithm faster.
Raw samples: [delivery JSON](baselines/2026-10-31-euler295-delivery.json).

Scoped type/differential audits passed four tests, including matching full
execution state in compiled/reference modes and all three embedded fixture
blocks. Scoped name-facts audits passed two tests. The 90-execution oracle now
checks the shipping source alongside the original and vectorized variants;
all passed. No full/exhaustive suites were started.

## Results

The original full compiled execution was stopped during investigation. A
separate phased execution with a 60-second limit completed its first five
stages in about 0.45 seconds but timed out during subset counting. This is
not a measured 60-second whole-program median.

Three fresh serial processes per case, Node 24.15.0, macOS arm64:

| Full N=100000 | Median | Range | Median peak RSS |
| --- | ---: | ---: | ---: |
| Bit operations, compiled | 0.785 s | 0.717–1.074 s | 279 MiB |
| Also vectorize radius expansion, compiled | 0.851 s | 0.810–0.880 s | 429 MiB |
| Original, reference | 13.828 s | 12.290–13.984 s | 555 MiB |
| Vectorized variant, reference | 12.670 s | 10.485–13.562 s | 675 MiB |

Module startup and interpreter construction are excluded; parse/JIT are
included. Runtime diagnostics are enabled consistently in this series. Host
load is uncontrolled. Reference ranges overlap: the vectorized variant has
no convincing overall advantage, particularly given its higher memory use.
The bit-only reference variant had one exploratory phased sample of 14.854 s;
there is no claim that bit syntax alone accelerates reference execution.
Every successful full run returns `4884650818`.

Raw [samples](baselines/2026-10-31-euler295-samples.json),
[diagnostics and controls](baselines/2026-10-31-euler295-diagnostics.json),
[verification](baselines/2026-10-31-euler295-verification.json).

## Workload and compiler failure

The [problem](https://projecteuler.net/problem=295) asks for distinct pairs of
radii, not distinct circle placements. The existing geometric algorithm
constructs radius families, sorts equal radii and removes multiple counting
by inclusion-exclusion over family subsets. At the full input it has:

* 1,304 distinct families and 1,454,232 radius occurrences;
* 1,174,794 distinct squared radii;
* 261,476 shared-radius groups, with 540,914 family memberships;
* group sizes 2: 251,093; 3: 3,062; 4: 7,130; 5: 132; 6: 54; 7: 2; 8: 3;
* 890,176 nonempty subset visits and 18,457 distinct subset keys of size >=2.

These are substantial but tractable counts. The observed minute-scale
compiled delay is not explained by an inherently enormous subset count.

The source tests membership of bit J using `(Mk // 2 ** J) mod 2 equal 1`
and bounds masks with `2 ** Sz - 1`. The speculative Number backend supports
computed integer exponents, but the publishing exact backend supports only
nonnegative literal exponents on its direct power path. Wide packed subset
keys (base 2048, up to eight digits) cannot all fit checked Number arithmetic.
The original source therefore falls back to smaller executions instead of
retaining one direct exact region for the whole subset traversal.

A 15-second V8 sample of the original compiled run attributed 5,385 of 10,030
ticks (53.7%) to `writeInteger32Cells`. Its two loops scan the complete dirty
bitmap to validate and publish a private Number result. Small nested loops
can repeatedly publish arrays with 400,000 cells. Buffer preparation and
publication costs amplify this further. The existing copy admission policy
intentionally bypasses general nested range regions, to preserve beneficial
large compiled traversals; this also admits the pathological short regions.
This is a general runtime/compiler performance issue, not a wrong answer.

## Smallest successful demo variant

`euler295-bits.ra` changes only three lines:

```
use bits
for Mk in 1 to ((1 shl Sz) - 1)
  ...
  if Mk bit J
```

The algorithm and data structures are unchanged. Both operations express
the mask intent directly and have exact compiled support, so wide keys can
fall back to one large BigInt loop instead of fragmented execution. A full
phased sample spends 0.521 s in subset counting and reports only seven
compiled loop entries in total. The whole-program serial series above is
the relevant final timing, rather than this one phased observation.

The vector variant additionally creates each family's radii with array
arithmetic and writes slices of `Rr` and `Fi`. This removes the explicit
per-radius expansion loop, but currently costs more memory and does not
win convincingly enough to recommend over the bit-only variant.

## General compiler experiment and rejected shortcut

`euler295-copy-policy.mjs` is a process-local loader experiment. It applies
the existing budget to all nested ranges too, without changing constants or
production files. On the original full source, one phased run completes in
7.859 s with the right answer. It still has about 1.4 million compiled loop
entries; avoiding repeated large buffer publications helps, but does not
restore one efficient exact region.

The same shortcut fails controls:

| Compiled control, one fresh process each | Existing policy | All nested ranges budgeted |
| --- | ---: | ---: |
| Euler 292, N=60 | 0.177 s | 0.184 s |
| Euler 292, full N=120 | 0.586 s | 12.337 s |
| Original Euler 295, N=10000 | 0.202 s | 0.442 s |

All control answers match. The full 292 regression also raises peak RSS from
223 to 662 MiB. Do not ship this unconditional policy change. A general fix
needs to distinguish useful nested work from repeated short mutations,
with bounded probes or a stronger work estimate. Another candidate is better
exact compilation of computed nonnegative integer powers; negative powers,
type changes, error timing and partial publication must retain their contracts.
Neither candidate has a production implementation in this investigation.

## Verification and reproduction

The small oracle uses the same geometric family parametrization but computes
the union of all radius pairs explicitly, rather than inclusion-exclusion,
packed keys or sorted shared-radius groups. Python modular inversion replaces
the demo's hand-written extended Euclid. This independently verifies counting,
not the geometric parametrization itself.

All 90 executions passed: original, shipping bit-only and vector variants, compiled and
reference, at N=0,1,2,3,5,9,10,11,20,21,30,50,75,99,100. The official 10/100
examples match. Full-input checks compare with the retained golden answer.
Production verification is summarized above; the full/exhaustive suites were
not started.

```
node benchmarks/experiments/euler295-samples.mjs
python3 benchmarks/experiments/euler295-verify.py
node benchmarks/experiments/euler295-delivery.mjs
PHASES=1 node benchmarks/euler295-investigation.mjs compiled bits
node --import ./benchmarks/experiments/euler295-copy-policy.mjs \
  benchmarks/euler295-investigation.mjs compiled original
```

Delivery retains the geometric algorithm and adopts the compact bit syntax.
Address the general nested-loop copy/publication policy separately with
292 and other large useful regions as mandatory controls. The reference has
roughly fourteen seconds of ordinary geometric, grouping and subset work;
this investigation has not found a decisive algorithmic improvement for it.
