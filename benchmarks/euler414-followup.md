# Euler 414: delivered compiler and demo changes

For the subsequent compiler-only speedup, see [ownership-only loop frames](euler414-loop-frames.md).

The compiler now tries an intermediate mixed-integer tier between exact
outputs and broad BigInt arithmetic. Exact required inputs and their scalar
consumers remain BigInts; independent intermediates use checked Numbers.
A transitive dependency closure handles loop-carried assignments. Existing
transactional replay, broader mixed arithmetic and exact fallback remain.
This addresses general loops with a large external modulus, not just Euler 414.

The demo retains the two-difference memoized Kaprekar search. It stores only
`0 <= Inner <= Outer` in a triangular table and computes the next state using
order statistics of four digits: the greatest digit is already `Base - 1`.
The zero-inner-difference case is separate. Buffer construction retains the
existing vector pool. A fresh `array shape ... fill` alternative consumed
more process memory in research and was not selected.

The algorithm still visits 163,760,506 states across the default bases. This
is a constant-factor improvement, not a reduction in asymptotic work.
The full answer remains **552506775824935461**.

## Full compiled measurements

Three alternating fresh-process original/runtime-baseline and delivered
source/runtime pairs per host, Node v24.15.0. Parsing is included, module
imports excluded. Diagnostics are enabled. The hosts were not idle; other
work was not controlled. All twelve answers matched, with no arithmetic
replay in the delivered full runs.

| Host | Original median | Delivered median | Original median peak RSS | Delivered median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 45.976 s | 32.733 s | 235.8 MiB | 267.2 MiB |
| Intel x86_64 | 60.264 s | 48.241 s | 284.7 MiB | 248.5 MiB |

Time decreased by about 29% on Mac and 20% on Intel. The delivered version
won all three pairs on both hosts. Mac original times ranged 38.3-46.6 s;
these are loaded-machine observations, not stable latency guarantees.

**Memory is a tradeoff.** The memo table has 1,626,306 instead of 3,250,809
cells at the largest base. Diagnostics show 66,979,676 instead of 134,090,220
bytes allocated through the vector pool per full run. However, median process
peak RSS rose by 31.4 MiB on Mac and fell by 36.2 MiB on Intel. We do not
claim a universal process-memory reduction. Peak RSS includes runtime,
compiler preparation, transient arithmetic and GC timing, not just table size.

The measured baseline is `1589193d`; interpreter/common/language sources
were unchanged from the research base `067a6638`. Baseline interpreter output
was archived before applying the patch. Intel used the research baseline
built from the same runtime sources. Later main integration is verified
separately; unrelated concurrent sieve and linalg changes do not participate
in this demo's execution.

Raw observations are in `baselines/2026-11-05-euler414-delivery.json`.
Historical, unsuccessful and compiler-only comparisons remain separately in
[euler414-investigation.md](euler414-investigation.md).

## Direct JavaScript control

The same memoized two-difference algorithm, a reused Uint16 distance table,
checked safe Number weights and exact BigInt totals produced the full answer:

| Host | Direct JS single probe | Peak RSS |
| --- | ---: | ---: |
| Mac | 13.693 s | 69.3 MiB |
| Intel | 22.768 s | 74.5 MiB |

Delivered Rank is about 2.4x/2.1x slower compared with these single probes.
These are not paired JS medians. The control uses narrower storage, fewer
runtime guards and does not publish Rank intermediate bindings. The observed
maximum walk depth is 613; that observation alone does not authorize Uint16
storage for arbitrary Rank inputs without widening/fallback semantics.
There is still useful general compiler/storage work beyond this delivery.

## Verification

- 636 focused interpreter tests passed across 17 files on Mac, including six
  new mixed-tier tests and six Euler 414 tests.
- 40 focused tests passed on Intel: Euler 414, mixed outputs and exact consumers.
- The existing `414_kaprekar_test.ra` fixture passed scoped differential audit.
- The independent test oracle enumerates sorted five-digit multisets, counts
  permutations by factorials and computes transitions by base-b subtraction.
  It agrees for bases 15,21,27. Existing statement/fixture values, empty
  bounds, small moduli and sums across multiple bases are preserved.
- The investigation verification runner passed 50 cross-mode comparisons of
  archived, alternative and delivered sources, plus its independent oracle.
- TypeScript build and interpreter test typecheck passed. Semantic boundaries
  (65 owners) and application-form checks passed. Whitespace and 40-column
  production Rank checks passed.

No full suite or exhaustive corpus audit was started. The full reference
search remains excluded from corpus audits; the exclusion description now
states that scope rather than the obsolete 1.9-minute compiled timing.
The bounded fixture stays in audits. The benchmark runner asserts the full
answer, without raising existing audit timeouts or removing assertions.

## Reproduce

```
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/experiments/euler414-run.mjs compiled 2 300 delivered
node benchmarks/experiments/euler414-verify.mjs
RANK414_REUSE=1 node benchmarks/experiments/euler414-native.mjs 2 300
```

To compare archived runtimes, use `RANK414_RUNTIME` on the runner.
`RANK414_DELIVERED=1 RANK414_BASELINE=/path/to/baseline/out/index.js`
selects original/delivered pairs in `euler414-pairs.mjs`. With no delivered
flag, that script compares the archived original source on both runtimes for
compiler-only research. The archived `.patch` describes the earlier research
prototype against `067a6638`, not a patch to apply on the delivered main.
