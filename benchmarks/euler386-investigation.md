# Euler 386: linked recursive vector counting

Delivered on 2026-11-04, investigated on `0e6cb9a9` and integrated with
`3ab3938f` in `a532c321`, Node v24.15.0.
The full answer remains **528755790**. The slow main-program execution exclusion
has been removed; the full compiled golden test, small fixture and scoped
corpus type/differential checks pass.

## Delivered result

| Host / full compiled program | Before | After | Peak RSS before / after |
| --- | ---: | ---: | ---: |
| Apple M5 | 15.483 s | 1.224 s | 547.5 / 460.2 MiB |
| Intel i7-10750H | 65.618 s | 3.465 s | 531.3 / 442.2 MiB |

The after measurements use the integrated `main`, including its independent
execution-cost diagnostics change. Each value is the median of three sequential
fresh processes. Measurements
include parsing/compilation and the complete 100-million default input. Peak
RSS falls about 16% on both hosts. The baseline is the same unchanged program
measured during the preceding investigation; no historical 32-second baseline
is used to inflate the improvement.

Reference execution is a tradeoff: Mac median 16.227 -> 17.525 s, with peak RSS
505.9 -> 510.5 MiB. The pre-integration Intel reference control is one sample, 73.642 s /
481.9 MiB; no Intel reference speedup ratio is claimed. Interpreter overhead
still dominates that lane. The direct JS search remains a lower-overhead
comparison, not the delivered implementation.

## Implementation

The compiler admits same-domain rank-one scalar-array `concat` inside scalar
functions and recursive call chains. Plain concat retains its persistent
snapshot semantics. Explicit `concat A B copy` copies scalar operands straight
into fresh storage, avoiding the temporary concat tree. Mixed-domain operands,
axis forms, unproved storage and argument writes keep their ordinary path.
Native `copy` identity/implementation checks prevent bypassing a host replacement.

Linked functions also consume `(Captured to Limit) len` and the exclusive
`till` form on immutable native finite sequences. The source is resolved at
demand; guarded constructor metadata can supply an exact bounded-length reader.
Dense prime sieves use the existing shared rank index without allocating a
bounded plan per query. Existing bounds, huge integer endpoints, custom methods,
cancellation, finally blocks, inspection and demand-budget fallbacks are preserved.
No Number-mode admission threshold changed.

The Rank demo retains exponent-pattern counting. Its width polynomial uses
library `convolve` instead of a handwritten pair of coefficient loops. Short
working vectors are explicitly completed. Bounded multiplication avoids oversized
trial powers in the integer-root helper; the counter also uses integer
multiplication, allowing its existing exact function proof to link the recursion.
This is not a new factoring algorithm or a precomputed answer table.

The lower prime bound is at least 3, fixing missing pattern [1,1] at limits
6–8; Limit=0 now returns 0. The fixture adds those four cases. The final full
run enters 379,003 exact counter calls and 379,003 Number root calls, with zero
Number overflows or scalar Number fallbacks. `pats`/`width` orchestration is still
ordinary execution over only 802 patterns; the hot counter recursion is linked.

A compiled prototype retaining lazy vector concatenations took 4.242 s and
1542.0 MiB peak RSS. Eliminating bounded-plan construction reduced that to
3.949 s / 1358.1 MiB but was insufficient. Explicit vector completion and its
compiler lowering were required for the delivered speed and memory result.
These are single prototype controls, not final medians.

## Verification

- 359 focused interpreter tests across 16 files on Mac; 166 across seven files
  on Intel. New tests cover recursion, wide integers, real/boolean/text arrays,
  empty vectors, value snapshots, alias/write fallback, errors, native method
  replacement, opaque getters, pre-existing bounds, cancellation and budgets.
- Full compiled golden test plus four scoped type/differential cases for the
  main and fixture pass. No whole-package suite or exhaustive corpus audit ran.
- 408 successful Rank/oracle comparisons across variants and both engines,
  plus 32 JS/oracle comparisons. Forty explicitly recorded mismatches belong
  to saved unfixed historical variants at 0/6/7/8; the delivered variant passes
  every tested input. Independent full factorization confirms 528755790.
- Both named fixture tests pass in both engines (12 limits per engine).
- TypeScript test build, semantic-boundary checks (65 owners), application-form
  checks and whitespace checks pass.

Final raw observations: `baselines/2026-11-04-euler386-delivery.json`.
Historical controls: `baselines/2026-11-04-euler386-investigation.json`.
Use `node benchmarks/euler386-delivery.mjs [file] [limit] [compiled|reference]`
for a fresh-process delivery sample; `RUNTIME` selects a built runtime and
`DIAG=1` enables diagnostics. Run timing samples without concurrent tests.

The following sections retain the pre-change investigation and rejected probes.

## Finding

The original exponent-pattern algorithm was already economical: at the full limit it
uses 802 patterns and 379,003 recursive counting calls. Runtime overhead is
the main remaining problem. The pre-change Rank compiler accelerated inner loops
and the root helper, but did not link `pats`, `cnt` and `width` into a compiled
region. Their orchestration, array values and calls used ordinary frames.

The program groups integers by prime exponents. For exponents e_i, the maximum
antichain size is the largest coefficient of product(1+x+...+x^e_i). It counts
assignments of primes to those exponents; equal exponents use increasing primes
and the final factor is counted with the finite prime sieve's length protocol.
It does not factor every integer through 100 million.

## Full-limit fresh-process measurements

Median of three sequential fresh processes per row. Peak RSS includes the
runtime. Rank timings include parsing and compilation. The JS control includes
sieve construction and the entire search, and uses the same DensePrimeSieve
implementation as Rank. These controls ran on separate machines; samples
within each machine did not overlap other measurements from this investigation.

| Host / implementation | Time | Peak RSS |
| --- | ---: | ---: |
| Apple M5 / Rank compiled | 15.483 s | 547.5 MiB |
| Apple M5 / Rank reference | 16.227 s | 505.9 MiB |
| Apple M5 / same search in JS | 0.133 s | 92.4 MiB |
| Intel i7-10750H / Rank compiled | 65.618 s | 531.3 MiB |
| Intel i7-10750H / same search in JS | 0.337 s | 92.4 MiB |

All full runs return **528755790**. The JS control has the same 802 patterns
and 379,003 calls. It uses ordinary numeric arrays and direct calls; root
comparisons avoid oversized products with a division check. This is evidence
of execution overhead, not a prediction that adding one compiler operation
will reproduce JS timing. The JS control omits Rank binding, error, cancellation,
observability and exact-fallback machinery. Those contracts must survive a fix.
The two runtimes also have different startup and object representation costs.

The old 32.59 s result in `prime-count-results.md` predates this investigation.
It must not be used as a present-day baseline or a claimed new speedup.

A diagnostic/profile control took 15.930 s, with 381,976 compiled inner loops,
379,003 compiled scalar calls and zero loop overflows. Roughly 2.56 s of
sampled CPU time was in GC. Other hot frames include execution dispatch,
semantic array types, array binding contracts, argument signatures and owned
array construction. The sieve itself stores about 6.25 MB of flags and 98 KB
of optional count indexes; that does not explain a 500 MiB process peak.

## Compiler scope

The minimal cases in `experiments/euler386-compiler-probes.mjs` distinguish
supported operations from missing composition:

- A scalar helper reading an integer array compiles correctly. A speculative
  all-integer proof can still emit `callee-binding` for `Es Pos`; that diagnostic
  alone does not mean array indexing is unsupported.
- A helper constructing `Next = concat Es (array E)` and returning its length
  falls back. A recursive helper extending a short integer vector also falls
  back at concat. Loop-level support elsewhere does not admit this expression
  into a linked scalar-function body.
- `(Sieve to Top) len` inside a scalar helper does not compile as a bounded
  captured-sequence query. Its existing exact-length implementation is fast;
  the missing step is admitting guarded use into the surrounding function.
- The stored-array iteration probe retains ordinary entry execution. There is
  an explicit policy in `fast-paths.ts:scalarEntry` preserving array-only helpers'
  existing private Number-loop backend. Simply deleting that policy would
  select a different execution tier, not establish a fast numeric call chain.

A useful general implementation would admit owned short numeric vector
construction/concat into function lowering, preserve read-only array argument
proofs across recursive calls, and consume native finite bound/length plans
without constructing Rank sequence wrappers at every call. It needs checks
for aliases, captured names and native-operation identity, precise errors,
cancellation/budgets, and exact replay after numeric overflow. No threshold
change or Euler-specific intrinsic is justified by this measurement.

## Small-input correctness defect

Independent factorization and coefficient convolution found omitted cases:

| Limit | Current Rank | Expected |
| --- | ---: | ---: |
| 0 | 1 | 0 |
| 6 | 5 | 7 |
| 7 | 6 | 8 |
| 8 | 7 | 9 |

For 6–8, the list of pattern primes ends at floor(sqrt(Limit)) = 2. It cannot
construct the exponent pattern [1,1], whose smallest representatives use both
2 and 3. The integer 6 is omitted with its width 2. The unconditional contribution
of the integer 1 also needs an empty-limit guard.

`experiments/euler386-boundary-fix.ra` raises the minimum pattern-prime bound
to 3 and handles Limit=0. It passes the independent small oracle in both modes.
These changes are now in the production source and its fixture.
The original fixture covered 1, 2, 10, 100, 1000, 10000, 100000 and 1000000;
all still pass in both engines. The added named test checks 0, 6, 7 and 8.

## Other prototypes

Single full compiled controls, suitable only to reject obvious wins:

| Prototype | Time | Peak RSS |
| --- | ---: | ---: |
| Start higher roots with Hi = N isqrt | 15.709 s | 546.1 MiB |
| Above plus library convolve in width | 15.571 s | 546.3 MiB |
| Above plus Top < Low early return | 16.361 s | 1002.8 MiB |

The last RSS is a single GC-sensitive observation, not an established memory
regression. None shows a compelling full-input speed improvement. Explicit
`array` on concat arguments was also probed at 1 million; it did not enable
the missing function compilation. A broad algorithm rewrite is not the first
priority.

## Verification and reproduction

Raw observations are in
`baselines/2026-11-04-euler386-investigation.json`.
The independent full C++ factorization oracle returns 528755790 as well.
There are 140 passing Rank/oracle comparisons across six variants and both
engines, 15 JS/oracle checks, and 40 explicitly recorded reproductions of the
four existing bad boundaries across the five unfixed variants. All five small
compiler probes agree between engines. The existing named fixture passes in
both engines. No full package suite or exhaustive corpus audit was run.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json
node benchmarks/euler-neighbours-runtime.mjs 386 full compiled
node benchmarks/euler-neighbours-runtime.mjs 386 full reference
node benchmarks/experiments/euler386-same-algorithm.mjs
node benchmarks/experiments/euler386-compiler-probes.mjs
node benchmarks/experiments/euler386-verify.mjs
clang++ -std=c++17 -O3 benchmarks/prime-count-oracle.cpp -o /tmp/rank386-oracle
/tmp/rank386-oracle 100000000
```

Repeat timing commands in fresh processes. `VARIANT=root-bound`, `convolve`,
`empty-bound`, `eager-arguments` or `boundary-fix` selects a saved Rank prototype
in the neighbours harness. Its default small case is 100000; `full` uses the
unchanged 100000000 default. These commands reproduce the historical investigation controls; delivery measurements are described above.
