# Euler 224: array frontier execution and delivery

Research at `0edd8390` on Apple M5, Node v24.15.0, darwin arm64. Issue #447 lists
`224_almostright.ra` as the lowest-numbered unfinished case across the observed
and full-scale exclusion inventories. The fixture is already a small-input test;
it has no unfinished inventory row. The delivery below updates the demo and
fixture comments. Compiler/runtime code and the execution-exclusion catalogue
remain unchanged. The research measurements below are a separate earlier cohort.

## Integration with concurrent main changes

Before the source commit was created, main also acquired collection-chain
optimizations and a function-resolution-order repair through `02650fbe`. The
Euler source change is committed as `72d0018a`; its runtime includes those
concurrent commits. The validation checkout was synchronized to all seven
changed interpreter files and rebuilt successfully. The final integrated
original/shipping comparison was repeated from that build, separately from
the earlier delivery and source-selection cohorts.

| Source, integrated runtime | Compiled median ms | Reference median ms | Compiled/reference median RSS MiB |
| --- | ---: | ---: | ---: |
| Original | 7,791 | 16,459 | 1184 / 1223 |
| Delivered shared stages | 1,785 | 6,604 | 572 / 915 |

The integrated comparison improves compiled time **4.36x** and reference time
**2.49x**. All twelve full-input samples return **4,137,330**.
RSS is reported independently for each engine; it is process highwater and
varies with garbage collection. The raw samples and integrated runtime hashes
are retained under `integration` in the delivery baseline. The prior cohort
tables below are historical evidence, not timings to mix with this build.

Integrated verification passed: TypeScript build, 120 focused tests across five
collection/mask/block-copy/concat suites, 160 independent oracle checks, both
fixture modes, static checks of both files, and the scoped type/differential
audits. No full runtime-suite or Intel run is claimed. Neither the source
algorithm nor our chosen implementation changed during integration.

## Delivered choice and final verification

The delivered demo uses the `staged` source: stop after the filtered frontier
becomes empty, bind reusable stages with ordinary `=`, materialize shared
multiples, run the nine small arithmetic kernels, and assemble three completed
frontiers with block copies. The ternary tree, array batches, default limit and
answer are unchanged. Only explanatory comments differ from the measured staged
prototype. The fixture retains all three existing assertions and replaces its
stale 70-second timing comment with a scope description.

Final comparison: three fresh processes per source and engine on the same
unchanged runtime, at the full default input; original and shipping interleaved.
Alternative source variants ran afterwards. These measurements supersede the
historical cohort for delivery claims. Absolute times changed substantially
between cohorts; their cause has not been established, and cohorts are not mixed.

| Source | Compiled median ms | Reference median ms | Compiled/reference median RSS MiB |
| --- | ---: | ---: | ---: |
| Original | 8,137 | 16,691 | 810 / 696 |
| Three concat copies (`copy`) | 4,527 | 5,654 | 767 / 770 |
| Direct kernels without shared multiples (`kernels`) | 1,671 | 9,513 | 569 / 787 |
| Delivered shared stages | 1,892 | 6,786 | 572 / 761 |

All 24 full-input samples return **4,137,330**. Delivery improves compiled speed
**4.30x** and reference speed **2.46x** against the current original cohort.
Compiled peak RSS falls **29%**; reference peak RSS rises **9%**. Shared stages
cost about 13% compiled speed versus direct kernels, while reducing reference
time about 29%. The concat-copy alternative wins reference time but costs 2.4x
compiled time and substantially more compiled memory than the delivered source.
This is a deliberate balance with compiled speed as the priority.

Final checks on the delivered source:

- 160 independent brute-force oracle comparisons: original/shipping, forty small
  limits, both engines, all passed.
- Existing three-assertion fixture passed in compiled and reference modes.
- CLI static checks passed for both main and fixture (one file each).
- Scoped type audit passed (one fixture).
- Scoped differential audit passed (one fixture, one test block, 3,870 compiled
  entries, zero Number-loop entries).
- Validation copies match the delivery files. The three relevant runtime JS hashes
  match the existing validated build; no runtime TS/JS changes were made.

The full runtime suite was not rerun for this demo-only change. The existing
full-input execution exclusion remains; full-scale correctness was checked by
all 24 explicit benchmark runs. No Intel run is claimed. Exact delivery samples,
hashes and verification logs are in `baselines/2026-10-28-euler224-delivery.json`.
The portable shipping-source oracle is `experiments/euler224-oracle.mjs`.

The delivered benchmark harness also fixes the default-literal substitution in
`--Limit=`. Historical small trials used the language's CLI override; the updated
harness additionally rewrites the option's literal default before parsing. Full
75,000,000 comparisons above do not override the option and are unaffected.

## Algorithm and execution costs

The demo enumerates the ternary solution tree for `a² + b² + 1 = c²`. It already
handles the symmetric Pell chain separately and avoids its mirrored subtrees.
A native structural control returns 4,137,330 at perimeter 75,000,000, with ten
symmetric roots and maximum retained subtree depth 4,328. This is not the duplicate
chain problem fixed in Euler 223. The native DFS uses different storage and
traversal, so its 207 ms is not an interpreter-overhead ratio.

The source nevertheless executes `isqrt(Limit)` levels even after the frontier
has disappeared: 8,660 iterations at the default input. A data-dependent loop
can stop immediately after filtering produces an empty frontier. Arithmetic
stages are repeatedly reused, but many use deferred `'` bindings. Replacing
these with ordinary `=` is an explicit source decision, not permission for the
interpreter to change deferred evaluation or error timing.

At Limit 1,000,000 the original compiled run prepares 4,000 tensor plans; the
ordinary-binding variants prepare none again inside the loop. They still execute
compiled kernels. The whole array-frontier loop does not compile as one region.
The original reports `loop:deferred-binding`; ordinary-binding variants reach a
separate `loop:unbound-name` rejection. Removing the first guard alone would not
implement this loop or preserve deferred semantics.

## Measurements

Fresh sequential Node processes; runtime import excluded, parsing/preparation and
execution included. RSS is process highwater. Small-input numbers are medians of
three samples per source/mode. Full original and full reference numbers are single
samples; candidate compiled full numbers are three-sample medians. No Intel run.

| Source, current runtime | Limit 100,000 compiled/reference ms | Limit 1,000,000 compiled/reference ms |
| --- | ---: | ---: |
| Original | 1,452 / 1,047 | 2,531 / 1,974 |
| Stop on an empty frontier | 1,028 / 733 | 1,577 / 1,454 |
| Also use ordinary arithmetic bindings | 627 / 572 | 916 / 852 |
| Also copy the three completed concatenations | 545 / 546 | 726 / 775 |

Full default input, all answers **4,137,330**:

| Source | Compiled ms | Reference ms | Compiled/reference RSS MiB |
| --- | ---: | ---: | ---: |
| Original | 15,465 | 30,992 | 700 / 755 |
| Early exit, ordinary bindings, three concat copies (`copy`) | 9,926 | 11,371 | 790 / 916 |
| Nine direct arithmetic kernels, then block copies (`kernels`) | 6,332 | 36,251 | 495 / 560 |
| Materialized shared multiples, then nine kernels (`staged`) | 6,824 | 25,704 | 526 / 535 |

The fastest compiled source duplicates multiplications and regresses the reference
engine. The shared-stage variant improves the compiled full run about **2.27x**,
reference about **1.21x**, and reduces peak RSS about **25% / 29%** versus the single
original samples. It keeps the array algorithm and computes `2*A`, `2*B`, `2*C`
and `3*C` once before the nine two-addition maps. It is a reasonable choice when
compiled speed is the priority. The smaller `copy` change is preferable for
reference speed, but consumes more memory. There is no single winner on all axes.

Existing fixture (three assertions, one process each):

| Source | Compiled ms | Reference ms |
| --- | ---: | ---: |
| Original | 1,765 | 1,285 |
| `copy` | 747 | 849 |
| `staged` | 731 | 826 |

## Compiler experiment: computed concat segments

An inline `concat (A - 2*B + 2*C) ... copy` is attractive, but the source tensor
binder currently requires a stored view for each concat segment. A computed
segment has a shape but no view, producing `tensor:binding:concat`. The emitter
already supports recursive branch-local segment arithmetic for native graphs.

A static-domain prototype admitted computed integer segments. On the full input,
source inference conservatively returns `integer | real`, so the guard never
applied: 35,225 ms median, versus 32,106 ms for the inline source on the current
runtime. A second prototype checks the bound inputs with `totalInteger` and
propagates the exact integer concat result domain. It executes the concat kernels
and removes the binding rejection, but takes **11,066 ms** median: faster than the
inline fallback, slower than separate kernels with shared stages.

The prototype is not a production fix. Its narrow boundary probes pass, but it
has not passed the full runtime suite. A future general compiler improvement
could emit separate segment loops rather than testing the segment branch inside
every output-cell iteration. It needs independent error-order, homogeneity,
shape, layout-cache and aliasing coverage, and benchmarks beyond Euler 224. The
current evidence does not justify shipping the experimental binder changes for
this task. No Number-mode threshold was changed.

## Verification and reproduction

An independent small oracle enumerates `a <= b`, computes `c` from the squared
identity and checks perimeter, without using the tree transformations. Forty
limits from 0 through 1,000 cover original, direct-kernel, shared-stage and inline
sources, both engines, on both the shipping and dynamic-prototype runtimes:
**640 checks passed**. Nine compiler boundary cases compared both runtimes against
the reference engine: **18 checks passed**. They include exact integers above
2^53, mixed numeric concat, zero division, empty results, shape mismatch, views,
mutation and rebinding. The existing fixture passes for original, `copy` and
`staged` in both engines. The full suite was not run for this research prototype.

Raw samples, exact source variants, runtime hashes, both experimental JS diffs,
fixture results and oracle/boundary programs are in
`baselines/2026-10-28-euler224-investigation.json`. The benchmark harness runs any
captured variant without editing the demo:

```sh
node benchmarks/euler224-almostright.mjs --variant=staged
node benchmarks/euler224-almostright.mjs --variant=staged --reference
node benchmarks/euler224-almostright.mjs --variant=copy --Limit=1000000
node benchmarks/euler224-almostright.mjs --variant=staged --fixture
```

Supply `--runtime=/absolute/path/out/index.js` for a separate built runtime.
Prototype diffs are recorded against the exact shipping `tensor-kernel.js`; they
are experimental artifacts, not an endorsed patch to apply without further tests.
