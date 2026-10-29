# Euler 261: pivotal square sums

Investigation on 2026-10-29, source/main 778854e2. The delivered change replaces per-input core factorization with a shared square-removal table; no compiler source changes are needed. Issue #447 lists the main as a manual workload (~272 s); that historical timing no longer reproduces on the current runtime.

## Full input measurements

Limit=10^10; every run returns 238890850232021. macOS arm64, Node v24.15.0. Three fresh processes per case, alternating cases sequentially, including preparation/execution and diagnostics but excluding module import. Host load was about 2.46 at one observation; external activity was not controlled.

| Source | Compiled median | Reference median |
| --- | ---: | ---: |
| Original | 7.085 s | 7.054 s |
| Squarefree-core table prototype | 0.233 s | 1.271 s |

Compiled original range: 7.036–7.385 s; prototype: 0.232–0.234 s. Combined improvement approximately 30.4x; table alone in reference mode approximately 5.5x. This is not a compiler-only speedup. Raw observations are in baselines/2026-10-29-euler261-investigation.json.

## Diagnosis

The original `core` factors every M and M+1 independently and then creates factor arrays, a unique array, a broadcast equality matrix, counts and a reduction to recover the squarefree part. The factorizer already shares an internal smallest-factor sieve; repeated expression evaluation and array processing remain. At full input diagnostics count 141423 distinct operations, 1788280 cells computed and 211872 compiled-loop entries. `core` rejects scalar compilation at `N factors`; the surrounding search is interpreted, with only inner loops compiled. This explains why enabling compilation barely changes the original elapsed time.

The prototype calls the existing `factorsieve` once and builds a table C using the smallest prime p of j and t=j/p:

- if p divides t, C[j]=C[t/p];
- otherwise C[j]=p*C[t].

It then reads C[M] and C[M+1]. The Pell search, bounds, deduplication and output are unchanged. Both the table and the entire outer search compile: two loop entries, two Number entries, zero overflows at the default input, and no factor-array work.

## Verification and limits

Both engines agree on the full answer, for original and prototype in all twelve measured runs. An independent direct square-sum oracle enumerates k and m, then binary-searches n using integer square sums; it does not use Pell equations or squarefree factorization. It checks limits 4,21,24,110,250,500,1000 against both variants and engines: 28 checks passed. Existing 3,000,000 fixture result 1305678503 also matched the compiled prototype.

The native factorsieve prototype has an upper bound 2^20-1; the delivered square-removal version below avoids that restriction. No memory reduction is claimed; the prototype adds linear auxiliary tables (~70715 cells at the default).

## Delivered implementation

The production table starts with C[j]=j. For every p from 2 through isqrt(Top+1), visit multiples of p squared and divide out p squared repeatedly. This leaves exactly the odd prime exponents. Composite p are harmless because their constituent prime squares have already been removed. The outer multiple visits are bounded by Top times sum(1/p^2), plus repeated divisions. There is no factorsieve bound and no special default-input path. The existing compiler compiles both table construction and the complete Pell search.

The original source is retained only as a benchmark control in experiments/euler261-original.ra. The benchmark's `table` variant always reads the shipping demo. The earlier `sieve` observations above describe the investigation prototype, not the final square-removal implementation. New delivery measurements are recorded separately below.

The default exclusion is removed; the existing fixture retains its three original inputs and adds 0,3,4,1000. A full-input regression test checks the exact answer, Number-loop use and absence of overflow. The independent square-sum oracle checks nine limits against both sources and engines: 36 checks pass.

General compiler support for factor-sequence consumers and scalar-return helpers with local array reductions remains a separate opportunity; it needs ordinary binding, replacement, error and evaluation-order contracts, not recognition of this Euler program. It has not been implemented here.

Reproduce after building the interpreter:

```sh
node benchmarks/euler261-pivotalsquare.mjs 10000000000 compiled original
node benchmarks/euler261-pivotalsquare.mjs 10000000000 compiled table
node benchmarks/euler261-pivotalsquare.mjs 10000000000 reference table
python3 benchmarks/euler261-oracle.py
```

Set RUNTIME=/absolute/path/to/out/index.js to select an isolated build. The measured build was /tmp/rank257-current-validation/packages/interpreter/out/index.js, the current main build used for the preceding Euler260 delivery. The original feature workspace remains unchanged. Git delivery and the authorized issue update are recorded in the final results comment.

## Delivery verification

Validated against main a6d4c430 (including its independently integrated loop optimizations): interpreter build and test TypeScript check pass. Ordinary interpreter suite: 417 files / 9401 tests pass. Scoped type/differential audits: four checks pass, covering both demo files and both embedded fixture blocks. Independent direct-square-sum oracle: 36 comparisons pass. Application forms, 11 semantic-source/workflow tests and 65 semantic owner checks pass. Default full source runs in both engines within the unchanged normal audit budgets.

The existing 80-step cap and mathematical search bounds are unchanged. This change improves core construction and compilation coverage; it does not claim a new proof of the original Pell enumeration or a process-memory improvement.

## Final shipping measurements

Three sequential fresh processes per case on the rebuilt a6d4c430 runtime, after all test processes finished. Every answer remains 238890850232021.

| Source | Engine | Median | Range |
| --- | --- | ---: | ---: |
| original | compiled | 7.054 s | 7.039–7.100 s |
| original | reference | 7.217 s | 7.074–7.231 s |
| table | compiled | 0.236 s | 0.232–0.241 s |
| table | reference | 1.284 s | 1.272–1.288 s |

The shipping compiled improvement is approximately 29.9x (7.054 / 0.236 s); reference improvement is approximately 5.6x (7.217 / 1.284 s). The changed program records two compiled Number-loop entries and zero Number overflows. No process-memory improvement is claimed.
