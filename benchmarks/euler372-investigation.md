# Euler 372 and nearby slow demos: investigation

2026-11-02, base HEAD `6af8014aaf1674588a13c7d56402d03a69f951da`.
The continued-fraction simplification is now applied to `372_pencils.ra`, with
independent regression tests and the full main restored to corpus execution.
The interpreter/compiler and timeouts are unchanged in this delivery. The
existing worktree contains unrelated changes. Measurements use its existing
compiled output, copied to an isolated directory on Intel.

## Findings

Euler 372 has two separate costs:

1. Integer `abs` is supported by the loop compiler, but the operation catalogue
   admits only real `abs` in scalar-function compilation. This rejects
   `surdfloor` and `surdinv`, then their callers `surdsum`, `below`, `pencils`.
   The original compiled-mode run executes no compiled scalar functions.
2. The Rank solution implements general quadratic-surd arithmetic, although
   every call starts with `(A,B,C)=(0,1,1)` and nonsquare positive K. A smaller
   exact representation eliminates gcd, temporary return arrays, repeated
   general `surdfloor` calls and recursion. This also compiles on the existing
   runtime without a compiler change.

The full input has K=249999: 125000 odd bands and 250000 calls to `below`.
The experiment retains this outer algorithm and its square-boundary handling.
It is not a full lattice-point scan or an answer lookup.

All full executions returned **301450082318807027**, using exact integers.

## Measurements

Node v24.15.0 on both hosts. Times include parsing, analysis, compilation and
execution, excluding module imports and interpreter construction. Full inputs
are Low=2000000, High=1000000000. Compiler and algorithm prototypes are separate.

| Full compiled case | Mac time | Mac peak RSS | Intel time | Intel peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Original | 255.228 s, one run | 495.7 MiB | not run | — |
| Original + integer-abs admission prototype | 9.245 s | 445.1 MiB | 35.259 s | 419.3 MiB |
| Continued-fraction Rank prototype, unchanged runtime | 0.486 s | 180.8 MiB | 1.711 s | 166.6 MiB |

The last two rows are medians of three fresh processes, alternating cases and
running sequentially on each host. The original full control overlapped other
local research probes; it is not an isolated median. The approximate 525x
original-to-final ratio is consequently diagnostic. The better-controlled
algorithm comparison, with the original already compiling, is 19.0x on Mac and
20.6x on Intel. Peak RSS is whole-process high-water memory, not live workspace.

One later serial full reference run of the Rank prototype took 17.845 s and
442.1 MiB on Mac. Full original reference was not run, so no full reference
before/after ratio is claimed. An earlier overlapping prototype reference
control took 19.523 s; it is retained separately.

Reduced inputs Low=20000, High=1000000, three serial fresh-process medians on Mac:

| Case | Time |
| --- | ---: |
| Original, compiled | 1.820 s |
| Original, reference | 1.564 s |
| Original + integer-abs admission, compiled | 0.218 s |
| Continued-fraction prototype, compiled | 0.138 s |
| Continued-fraction prototype, reference | 0.303 s |

These controls show both costs independently: integer-abs admission improves
the unchanged source, and simplifying the mathematics also helps reference mode.

Intel uses a private `/tmp/rank372-research` directory with the matching copied
runtime and language output, and its own workspace-package links. Initial Intel
probes accidentally resolved the language package from an older benchmark
directory; those samples are marked exploratory and excluded from the final
table. Final series use corrected links. Local output was compared byte for
byte against the runtime archive after measurements: no output drift was found,
although other work advanced the repository HEAD during the investigation.

Raw measurements, diagnostics, profile summary and source/runtime hashes are
in `baselines/2026-11-02-euler372-investigation.json`.

The delivered source gives the root calculation its own local variable to keep
Rank lines within 40 columns. Three final fresh-process medians are **0.490 s /
177.8 MiB** on Mac and **1.691 s / 166.4 MiB** on Intel. All full answers match.
The actual delivered source passed the extensive compiled verifier on both hosts.
The compiler prototype measurements above remain separate controls.

## Compiler control

`ABS_INTEGER=1` uses a process-local Node loader hook to replace the catalogue's
real-only scalar `abs` signature with its integer counterpart. The original
Rank source and all its arithmetic remain unchanged. This is an admission
experiment, not a shippable fix: production must preserve real support too.
`euler372-noabs.ra` is a separate source control replacing the three integer
absolute values with ordinary sign branches; it reaches the same compiled path.

On the reduced input Low=20000, High=1000000, diagnostics show the rejection
chain above, zero compiled loops and zero compiled scalar calls. The CPU profile
is dominated by interpreter advance/dispatch, tensor binding, frame reads,
function invocation and GC. In that instrumented run there were 255478
`tensor:output-shape` and 132592 `tensor:scalar-evaluation-timing` fallbacks.
These count failed paths, not elapsed-time shares or unique program operations.

The simplified full solution makes 749001 compiled scalar calls, versus
25377957 for the original with integer `abs` admitted. Zero `numberFunctions`
does not mean zero compilation: these scalar functions run exact BigInt kernels.
The scalar-call hook is necessary to observe this path.

## Exact continued-fraction reduction

Let `S(t,n) = sum(floor(i*t), i=1..n)` and
`t = (A + sqrt(K))/C`, with nonsquare K and C positive. Initially A=0, C=1.
Write `Q=floor(t)`, `D=A-Q*C`, `f=t-Q`, `m=floor(n*f)`. Then

```
S(t,n) = Q*n*(n+1)/2 + n*m - S(1/f,m)
1/f    = (-D + sqrt(K)) / ((K-D*D)/C)
```

The sum identity counts the integer points under the irrational line in an
n-by-m rectangle. Irrationality removes equality ambiguities. Since 0<f<1,
m<n, so each step reduces n.

The invariant `C divides K-A*A` is true initially and preserved by subtracting
Q*C. Thus the new denominator is a positive integer; the coefficient of sqrt(K)
stays exactly one. No general triple normalization or gcd is needed.

`Q=(A+isqrt(K))//C` is exact because the discarded fractional part is less than
one and C is a positive integer. Likewise

```
m = (D*n + isqrt(K*n*n)) // C
```

is exact, including negative D. Alternating the sign of the contributions turns
the recursive identity into a loop. The implementation deliberately keeps
`isqrt` and integer arithmetic; replacing the final answer or boundary tests
with unguarded floating-point calculations would not be valid.

## Nearby workloads

These are current reduced-input probes, not full-default benchmarks. Compiled
probes have diagnostics enabled; reference probes do not. They ran while the
long original 372 control was active. Their times locate paths and must not be
treated as isolated speedup medians. Answers match between modes in every row.

| Demo | Probe | Compiled / reference | Observed path |
| --- | --- | ---: | --- |
| 370 | Limit=10^7 | 0.211 / 0.367 s | Whole helper hits the scalar proof budget; three inner Number loops compile. Full input also has a much larger sieve and search. |
| 373 | Limit=10000 | 1.551 / 6.832 s | `divs` returns a queue; that result is not admitted into the whole scalar call chain. Many inner kernels compile. |
| 374 | Limit=10^7 | 0.211 / 0.228 s | Both main regions compile, with mixed exact arithmetic. The full input raises MaxM from 4470 to about 14.1 million. |
| 375 | Limit=Period=100000 | 0.227 / 2.105 s | Three Number loops compile. Full period is 6308948; several large arrays and multiple stack passes remain. |
| 378 | Limit=100000 | 1.873 / 1.829 s | Two loops compile, but the final loop's Fenwick array assignments are unsupported. 400000 scalar tensor shape declines remain. Full Limit=60000000 multiplies this cost. |
| 379 | Limit=10^7 | 0.210 / 0.871 s | Four Number loops compile; current implementation already has grouped sieve work. The issue records previous improvements. |
| 386 | Limit=100000 | 0.617 / 0.638 s | Array iteration, array concat, captured/callee binding and recursive call-chain restrictions keep the orchestration interpreted; small inner loops compile. |
| 388 | N=10^6, Cut=10000 | 0.197 / 0.855 s | Recursive scalar calls, index caching and some loops already compile. Full input has larger sieve/Mertens work and genuinely wide exact results. |

For 373, diagnostics record 520064 Number function attempts and 493395
fallbacks, mostly in the exact Heron-product predicate. The code multiplies
several squared sides, so safe Number arithmetic is routinely insufficient.
Avoiding repeated speculative work is another opportunity; allowing rounded
products would break the exact equality test. The current algorithm also
enumerates triples of available sides for each radius: fixing compilation alone
does not eliminate that combinatorial work.

378's Fenwick structure currently stores BigInt values and prefix sums. A useful
generic extension would admit its guarded reads and updates into a region, with
the proper observable-write/error semantics; replaying such mutations on Number
overflow is unsafe without private state or a proof. Rewriting the search in
another syntax cannot substitute for this missing operation coverage.

There is no evidence of one defect explaining every nearby exclusion. Shared
themes are incomplete native/container coverage, a compiled caller depending on
the proof of every callee, exact arithmetic exceeding Number range, and sizeable
algorithms even after compilation. The issue's old concurrent audit observations
and exclusions are not a measurement of today's isolated compiled performance.

## Verification and reproduction

Each of compiled, exact-loop and reference modes passed:

- 9798 helper comparisons against direct summation using an independent
  binary-search integer square root, for nonsquares K=2..150, N=0..70.
- 737 whole-program cases checked by direct lattice-point enumeration, also
  compared with the original Rank helper chain.
- 552 adjacent-prefix checks up to N=10^30, including values beyond 2^53.
- Both existing small fixture answers, 3019 and 254713.

The helper uses an external supplied floor(sqrt(K)); it is an internal helper
for nonsquare K, with the production caller retaining the square case.
The full experimental answer matches execution of the saved original source.
The research verifier does not replace corpus or regression tests.

Delivery validation: 97 focused tests passed, including seven new Euler tests;
all four scoped type/differential checks for the actual main and fixture passed.
The exclusion eligibility regression, TypeScript build, semantic boundaries and
application-form checks passed. The main's obsolete exclusion was removed;
the small fixture and all default arguments remain unchanged. No full suite or
exhaustive audit was run.

```
node benchmarks/euler372-investigation.mjs original compiled 2000000 1000000000
ABS_INTEGER=1 node benchmarks/euler372-investigation.mjs original compiled 2000000 1000000000
node benchmarks/euler372-investigation.mjs continued compiled 2000000 1000000000
node benchmarks/euler372-investigation.mjs continued reference 2000000 1000000000
node benchmarks/experiments/euler372-verify.mjs compiled
node benchmarks/experiments/euler372-verify.mjs exact
node benchmarks/experiments/euler372-verify.mjs reference
DIAGNOSTICS=1 node benchmarks/experiments/euler372-neighbours.mjs 378 compiled
```

`PROFILE=/tmp/372.cpuprofile` records a separate CPU profile; `DIAGNOSTICS=1`
records counters. Profiles and diagnostics should not be used for ordinary timing.

## Suggested order of work

1. Deliver the proven Rank-only continued-fraction simplification for 372,
   adding a full golden regression and retaining independent small fixtures.
2. Fix scalar integer `abs` admission generally, preserving real inputs,
   builtin identity guards, shadowing, single evaluation and error behavior.
   The loader hook is only a demonstration of its leverage.
3. Investigate container boundaries separately: queue-returning helpers (373),
   Fenwick updates (378), and recursive array call chains (386).
4. Use profiles to target repeated scalar-to-tensor attempts and speculative
   Number overflow, while preserving mutable binding/type checks.
5. Re-measure each full workload before changing exclusions or timeout policy.
   A larger proof budget alone is not a general optimization strategy.
