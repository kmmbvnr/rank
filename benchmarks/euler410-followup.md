# Euler 410: compact stages and exact numeric reductions

Built on `29557b8d`, including the concurrent helper-effect and exact-output
changes from main. Node 24.15.0; Apple M5 arm64 and Intel i7-10750H x64,
2026-11-05. R=100000000, X=1000000000; full answer:
**799999783589946560**. The limits and original fixture assertions are retained.

## Program

The segmented arithmetic sieve and summation formula are retained. The program
stores 2^omega(m) directly by multiplying by 2 for each distinct prime, instead
of constructing a large array power after the sieve. A small exact outer-power
table prepares the prime-power stages once; the binary length of the bound
sets its width, and clipping removes powers outside the bound. There is no
fixed maximum exponent or number of distinct prime factors.

There is one explicit loop, over these stages. Block sums use `rank 0`.
Direct arithmetic slices avoid allocating completed selector arrays in reference
execution. P and Q in the loop denote a prime and its power; the other names
are words. Production lines, including comments, fit within 40 columns.

For a=R//m, b=X//m, w=2^omega(m), o=m mod 2, the summand is
`w*(1+o)*a*b + w*(1-o)*(a mod 2)*(b mod 2)`. Safe array stages are completed
before the final sum. The potentially wide product belongs to that sum,
rather than a separately completed array. Default Block is 500000; it remains
a CLI argument. This changes working memory, not the mathematical limit.

## General runtime and compiler repairs

- Stored integer powers use checked numeric multiplication where exactness is
  proved. Wide results use BigInt; negative exponents and other numeric kinds
  retain the existing real/domain-error path. Checking a floating-point power's
  final value alone would not prove that its intermediate arithmetic was exact.
- Numeric vector power uses the same checked scalar lowerer, including trailing
  broadcasting, multidimensional arrays and replay on unsupported domains.
- Bounded native prime iteration lowers in numeric regions, including ordinal
  bindings and captured lower/upper bounds. Native identities remain guarded.
- Whole-array `+=`, `-=`, `*=`, `//=`, and `mod=` reuse pointwise array binding
  lowering, with its shape, alias and representation checks.
- Direct named arithmetic selectors keep an affine snapshot of captured values.
  Publication produces ordinary completed arrays. Other array consumers,
  mutations and unused bindings keep their materialized path; observable range
  completion under budgets/cancellation retains the publishing backend.
- Numeric slice/scatter stores can coexist with independent exact scalar outputs.
  Address and stored-cell dependencies remain checked Numbers. Captured scalars
  outside safe Number range keep an exact reducer within the mixed region.
- Pure rank-one integer sums of addition/subtraction/products keep numeric
  partial sums. On cell overflow they retry only that cell exactly, retaining
  prior numeric work. Separately completed wide array bindings retain fallback.

The full main has one initial numeric function-prefix replay when its first
sum exceeds safe Number range. Its mixed reduction then evaluates six offending
summand cells with BigInt. The other 499994 cells in that first block remain
numeric; subsequent blocks complete in the ordinary numeric tier. The counters
measure evaluated cells, not the number of allocated BigInt objects.
The 64-cell copy allowance, 262144-cell probe cap and precision guards are
unchanged. No Euler-specific admission rule or unchecked arithmetic was added.

## Final measurements

Fresh sequential processes. Time includes parsing and execution; RSS is process
peak MiB. Each compiled final value is the median of three runs. The workstation
was not isolated from unrelated activity. RSS varies with GC; final Mac samples
range from 280.2 to 350.9 MiB, Intel from 278.0 to 331.3 MiB.

| Full input | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original control at 7f1c799c, block 10m, median of 3 | 21.301 / 1769.5 | 56.444 / 1385.3 |
| Final integrated program/runtime, block 500k, median of 3 | **5.082 / 296.2** | **11.675 / 322.2** |
| Original source on immediate parent 29557b8d, one sample | 20.901 / 1727.0 | 56.674 / 1388.6 |
| Final source on parent runtime, one sample | 9.798 / 414.0 | 25.475 / 342.7 |

Relative to the three-sample original control, the final compiled program is
4.19x faster on Mac and 4.83x on Intel; median process peak RSS is 83% and 77%
lower. The same final source is also faster with the compiler/runtime repair
than with its immediate parent; those parent controls are single samples.

Reference execution uses single fresh-process samples, not medians:

| Reference | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original control | 75.501 / 2791.7 | not rerun |
| Final | 45.231 / 621.6 | 140.773 / 548.2 |

Compiler-observed final runs, using the differential audit's public callback
options, return the same answer in 5.226 s / 299.0 MiB on Mac and
12.026 s / 330.7 MiB on Intel. Vitest's source-module execution adds substantial
reference overhead; audit timings are recorded separately below.

## Independent controls and memory choice

Before integrating the two concurrent compiler commits, a three-sample series
isolated changes on the same base (7f1c799c):

| Compiled variant, block 10m unless specified | Mac seconds / MiB | Intel seconds / MiB |
| --- | ---: | ---: |
| Original + old runtime | 21.301 / 1769.5 | 56.444 / 1385.3 |
| Original + runtime repair | 9.172 / 1165.0 | 24.638 / 790.7 |
| Array-stage program + old runtime, block 1m | 10.681 / 361.3 | 28.035 / 338.2 |
| Array-stage program + repaired runtime, block 1m | 5.393 / 407.7 | 12.517 / 335.5 |

This separates the benefit of the reusable runtime repairs from the source
rewrite. At a million cells, private numeric execution increased Mac RSS versus
the source-only control while halving its time. A same-version 500k-block probe
took 5.212 s / 283.5 MiB on Mac. The integrated 500k named-selector variant took
5.081 s / 280.2 MiB and 12.207 s / 269.1 MiB. The final direct-slice variant also
keeps reference execution and audited execution practical. Archives retain each
source version and its explicit block arguments; there is no universal block
size or cross-architecture admission threshold inferred from these timings.

Private vector-buffer acquisitions across all 200 final blocks total about
3.2 GB. This is cumulative scratch allocation traffic, not peak retained memory.
Function prefixes still publish their completed local bindings, so reducing
cross-invocation buffer traffic remains a general optimization opportunity.

The historical hand-JS control is 1.617 s / 200.9 MiB on Mac and one Intel sample
is 5.633 s / 200.7 MiB. It has narrower contracts: it omits Rank snapshots,
observable binding/error behavior, budgets and cancellation. It shows remaining
algorithmic headroom and is not equivalent generated code or a promised speedup.

## Verification

- 1424 focused tests in 48 files passed on each host after integration. The final
  direct-slice source then passed all 71 solver/region/power tests again on each.
- 210 additional checks compare the production, original and direct-weight
  sources against independent trial division and exact BigInt arithmetic. They
  include zero/singleton bounds, symmetry, uneven blocks, and inputs beyond safe
  Number and Int64 ranges.
- Full answer verified in both engines on both hosts; three final compiled
  samples per host, one final reference sample per host, and callback-observed
  samples all agree. Exact full Euler 283 also passed after integration.
- On Mac, scoped differential, inferred-type and name-fact audits cover both
  410 files. The final Intel differential pair also passes: main 274.6 s,
  fixture 0.9 s, with the unchanged 300 s timeout. Full parallel-corpus timing
  remains CI validation. Final scoped timing/results are in the raw report.
- TypeScript build including interpreter test types, semantic-boundary checks
  (65 owners), application-form checks, syntax/whitespace checks pass.
- A final unsafe-scalar regression does not change Euler 410 code generation;
  both numeric and mixed generated sources have identical before/after hashes.
  Final real-vector power domain guards also replay the ordinary error path.
- Full suite and exhaustive corpus audits were not run.

The original fixture is unchanged. The full main is restored to execution
audits. See issue #447 for delivery and the consolidated results comment.

## Reproduction

Build TypeScript first, then run from repository root:

```sh
node benchmarks/euler410-investigation.mjs
node benchmarks/euler410-investigation.mjs \
  demos/euler/410_circleandtangent.ra \
  100000000 1000000000 reference 500000
node benchmarks/experiments/euler410-verify.mjs
```

`observed` enables the differential audit's callback options. Historical compiler
controls use `RANK410_BASELINE=1` with
`--import ./benchmarks/experiments/euler410-controls.mjs`. Without a prepared
control JSON, the loader transpiles the archived 7f1c799c modules from git;
`RANK410_CONTROL` accepts an equivalently prepared source map for a detached
snapshot. No generated runtime files are edited by these controls.

[Raw records, hashes and sample distinctions](baselines/2026-11-05-euler410-followup.json).
[Historical investigation](euler410-investigation.md).
