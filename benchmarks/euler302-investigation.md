# Euler 302: strong Achilles numbers

## Delivery (2026-10-31)

The default limit remains 10^18 and the answer remains **1170060**. The same
prime-exponent search now uses packed factors of P-1 (a flat integer vector and
offsets), unique unfinished factors and array count reductions. Each recursive
node builds its next factor vector once per selected prime. Products remain
exact BigInts. Published fixture assertions are retained and small cases added.

General compiler improvements:

* Compile recursive scalar-return helpers that write only their own fresh,
  constructor-owned arrays. Parameter and alias writes still fail ownership.
* Admit settled stored-vector iteration in linked function regions, including
  ordinals, and read stored array length without traversing its cells.
* Let recursive owned-array helpers enter the exact function backend. Preserve
  the existing private Number loop preference for ordinary array-only helpers;
  the CSES max-subarray cached-entry/changed-input control still uses that tier.

No Number admission constants or eager/deferred binding contracts changed.
General counters and indices with array values are still outside this compiler
scope; the demo's packed factor representation avoids that requirement.

### Final full-input measurements

Apple M5 / Node v24.15.0, fresh processes, serial runs. Before is the original
program/runtime at 29f6185b. After includes the demo, compiler and signature-cache
fix. Times include parsing/execution, exclude runtime imports and process startup.
External host load is uncontrolled. Full reference runs and the old full compiled
control are single samples; final compiled is a median of three (5.654–6.043 s).

| Mode | Before | Final | Before peak RSS | Final peak RSS |
| --- | ---: | ---: | ---: | ---: |
| compiled | 109.447 s | **5.746 s** | 1109.8 MiB | **567.2 MiB** |
| reference | 103.164 s | 91.301 s | 1049.8 MiB | 979.5 MiB |

Compiled is about 19x faster against that single full baseline, with about half
the peak RSS. Reference is still expensive; its full input retains the reference
execution-budget exclusion. A dedicated full compiled regression checks both
1170060 and over 1.6 million compiled function entries.

The final compiler-only control uses the **same new demo and new signature
cache on both sides**, restoring just the three compiler modules for the old
side. At 10^12: 1.818 s old compiler -> 0.321 s new compiler (three-sample
medians; ranges 1.472–4.715 s and 0.272–0.796 s). That control attributes useful
headroom to compiler support independently of the source rewrite and memory fix.
Host timing variation precludes precise small percentage claims.

### Memory bug found and fixed before delivery

The first rewritten reference run peaked at **2881.5 MiB**. It exposed the
argument-signature memo's use of WeakRef: eligible argument arrays were kept
alive until the current host job ended, even after the memo was replaced. A long
synchronous Rank execution could therefore pin millions of already completed
arrays. This behavior follows [ECMAScript WeakRef kept-object semantics](https://tc39.es/ecma262/multipage/managing-memory.html#sec-weak-ref-objects).

The memo now compares opaque identity tokens stored in a WeakMap. Tokens have
no back-reference to arrays. Identity, revision, rank and known scalar-domain
checks still control memo reuse. No extra evaluation is introduced.

On the **same rewritten full reference program**, peak RSS fell from 2881.5 to
**979.5 MiB**, about 66%. These are single full samples from separate phases;
their times were 83.596 and 91.301 s, so this is a memory result, not evidence
of a signature-cache speedup. The final compiled series is also later/slower
than the pre-memory-fix series (4.613 s median); do not attribute that difference
to this cache without a timing control.

A separate synchronous-job control signs 2000 completed integer arrays of
4096 cells, with explicit GC in the same job. Old memo: **64.7 MiB** retained;
new memo: **0.19 MiB**. The memory regression test enforces an 8 MiB bound and
the existing signature tests retain mutation, identity and type invalidation
coverage. The packed demo exposed the bug because its materialized array
arguments qualify for signature memoization, whereas the old helper's index
argument prevented that all-arguments memo path.

### Verification

* TypeScript project build and semantic-boundary checks pass.
* Ordinary interpreter suite: **450 files, 10315 tests passed**. Exhaustive
  types/differential/Nurikabe audits were excluded as required.
* New recursive ownership, exactness, aliases, error locations, depth fallback,
  stored metadata, unused deferred stage and loop receiver tests pass.
* New synchronous-job signature memory test passes.
* Scoped type and differential audits pass for the two-block Euler 302 fixture;
  scoped name-facts check passes for the fixture.
* An independent SPF/totient exhaustive oracle checks strict limits 100, 1000,
  10000, 100000 and 1000000 against four variants in both modes: **40 checks**.
* Full default compiled and reference answers agree, as do original controls;
  full compiled regression retains the default limit and exact expected answer.

Raw delivery data labels: `before` is original source/runtime; `after` is the
rewritten source/new compiler **before** the memory fix; `after-memory` is final;
`before-compiler` is old compiler with the **new** signature cache. The earlier
research files below remain historical controls. Zero/empty diagnostic counters
are omitted from diagnostic JSON.

Reproduction after building the current project:

```
node benchmarks/experiments/euler302-build-baseline.mjs /tmp/rank302-before
node benchmarks/experiments/euler302-build-baseline.mjs /tmp/rank302-before-compiler compiler-only
node benchmarks/experiments/euler302-build-baseline.mjs /tmp/rank302-before-signature signature-only
node benchmarks/experiments/euler302-delivery-samples.mjs
RANK_BENCH_RUNTIME=/tmp/rank302-before/out/index.js node --expose-gc benchmarks/experiments/euler302-signature-memory.mjs
node --expose-gc benchmarks/experiments/euler302-signature-memory.mjs
node benchmarks/experiments/euler302-verify.mjs
```

The delivery sampler resumes existing JSON; move it aside for a completely new
series. Baselines copy current out and restore only the indicated modules from
29f6185b; other modules are identical across the corresponding control.

## Initial investigation (before implementation)

The following describes the initial 29f6185b source/runtime and archived
experiments. Delivery findings above supersede its implementation proposal.

## Finding

Execution overhead is the main opportunity. The algorithm is already a pruned
prime-exponent search, not an enumeration of all integers below 10^18.
A direct JavaScript control of the same search, with exact BigInt products and
reused per-node factor data, completes the full input in a median **238.5 ms**
(234.3–283.3 ms, three fresh processes), returning **1170060**. It visits
1,635,470 recursive nodes, 1,882,677 candidate primes and caches 78,498
factorizations. Peak RSS is about 105.3 MiB.

The unchanged full Rank compiled run was stopped after approximately 100 s
without a result. This is a censored run, not a measured full execution time;
the full Rank answer has not been verified in this investigation. The JS
control is not a compiler prototype or a promised Rank speedup: it uses native
maps/arrays and Number for proven-small primes/exponents, and also avoids some
redundant work. Rank timings include parsing/execution; JS control timing covers
sieve and search but excludes loading the control script.

At smaller inputs all algorithms and both Rank modes agree:

| Limit | Original compiled | Original reference | JS control |
| --- | ---: | ---: | ---: |
| 10^12 | 2.432 s | 1.611 s | 0.0066 s |
| 10^14 | 6.310 s | 6.934 s | 0.0180 s |

Rank entries are medians of three fresh processes. Samples were run serially
with rotating variant order and no other tests/builds launched by this
investigation. External host load was uncontrolled: ranges are wide (at 10^14,
original compiled 6.240–9.306 s, reference 6.405–9.796 s). Do not interpret these
medians as precise engine-to-engine ratios.

## Why this algorithm is reasonable

It enumerates distinct primes in descending order, with exponents at least two.
The largest prime needs exponent at least three: otherwise its exponent in phi
is one, and no larger prime can contribute another factor. Thus the prime
sieve stops below the cube root of the limit.

`Gn` tracks the gcd of exponents in n. `Fs` carries factors of phi whose
exponents may still change; `Gp` tracks gcds of completed phi exponents. Once
choosing P, every unfinished prime greater than P must already have exponent
at least two. A missing P needs exponent at least three in n; an existing P
can start at two. The search checks that n and phi(n) are powerful and are not
perfect powers. These are substantial mathematical reductions already.

## Actual compiler boundaries

On limit 10^8 diagnostics record 203 compiled loops, all Number loops. They are
small inner work, not the recursive search. There are also 1,198 mask
materializations (762 cells) and 413 numeric distinct operations.

The recorded `scalar-function:unsupported-op:len` at `Fs len` is from the
initial default scalar-domain proof. It does not mean adding a len opcode
alone compiles this function. Confirmed independent boundaries:

* `compiledEntryArgumentType` only admits integer-valued tracked indices.
  The factor cache C contains arrays. After running limit 10000,
  `Facs.entries.integers` is false and `compiledEntryArgumentType(Facs)` returns
  undefined. See `jit/compiled-argument-type.ts` and `jit/compiled-callee-type.ts`.
* `new counter Fs` has no counter domain in scalar-function proof/lowering.
  An indexed gather from a counter needs the same domain support.
* The function uses filters, distinct factors, concatenation, metadata reads,
  factorization and recursive calls together with a shared mutable cache.
  `function-plan.ts` currently restricts len to a recognized native producer;
  a general input vector's metadata needs a sound proof as well.
* The final scalar-function proof rejects plan bindings mixed with containers
  or array writes. Merely extending argument admission would still leave this
  boundary, in addition to proving each native operation.

A CPU sample on original compiled limit 10^12 records 231 GC samples out of
1,657 (13.9%). Interpreter advance/stream/frame work, collection construction,
concat and materialization are visible. This profile includes startup/parsing
and is qualitative; it is not a full-input allocation measurement.

## Prototypes compared

`euler302-reuse.ra` constructs one factor counter and distinct-key vector per
node, reuses the counter for high factors, delays the low filter until the
branch is valid, and builds F2 once per selected prime instead of per exponent.
The search tree and count stay the same.

`euler302-prune.ra` additionally finds the largest unfinished factor with
exponent one and starts candidate primes at its lowerindex. Choosing a smaller
prime cannot repair that factor. The extra mask, max and search can cost more
than the rejected branches save.

| Limit / mode | Original | Reuse | Reuse + singleton bound |
| --- | ---: | ---: | ---: |
| 10^12 compiled | 2.432 s | 1.801 s | 1.773 s |
| 10^12 reference | 1.611 s | 1.742 s | 1.623 s |
| 10^14 compiled | 6.310 s | 6.607 s | not sampled |
| 10^14 reference | 6.934 s | 4.799 s | not sampled |

No prototype consistently improves both modes across the sampled limits.
Reuse peak RSS at 10^14 is also mixed: compiled 557.2 -> 587.0 MiB,
reference 628.4 -> 522.4 MiB (medians). Do not ship a source rewrite on the
strength of the small-input compiled result alone.

## Useful implementation direction

Keep the current compact array-oriented search. Extend linked function regions
to support typed counters and integer-keyed indices containing integer vectors,
then admit the required native array stages and metadata without boxing every
cell or forcing unused plans. Preserve the fast integer-index specialization.
Shared-cache writes must retain reference semantics, including aliasing,
exceptions and recursive visibility. Array capture/concat arguments need safe
storage or plan proofs rather than unconditional eager copies.

This is a general compiler feature, not a Number threshold adjustment. The
products may reach 10^18; keep exact integer operations first, then consider
checked Number speculation with the established overflow/replay contract.
The JS control shows useful headroom but does not validate that implementation.

## Verification and reproduction

An independent SPF/totient sieve exhaustively classifies integers below each of
100, 1000, 10000, 100000 and 1000000. Counts are 0, 2, 7, 34 and 99.
All three Rank variants match in both engines: **30 oracle checks**.
The published fixture values 7 at 10000 and 656 at 10^8 also match the original
Rank executions. All timed variants agree at 10^12 (16176) and 10^14 (70645).
The JS control agrees at these two larger limits; full-input control is not an
independent full Rank oracle verification.

```
node benchmarks/euler302-investigation.mjs compiled 12 original
DIAGNOSTICS=1 node benchmarks/euler302-investigation.mjs compiled 8
node benchmarks/experiments/euler302-samples.mjs 12
node benchmarks/experiments/euler302-samples.mjs 14
node benchmarks/experiments/euler302-control.mjs 18
node benchmarks/experiments/euler302-verify.mjs
```

Raw samples, control runs, diagnostics (zero/empty counters omitted), and oracle
results are in `benchmarks/baselines/2026-10-31-euler302-*.json`. Exhaustive audits
and broad test suites were not started; this investigation changes no runtime.
