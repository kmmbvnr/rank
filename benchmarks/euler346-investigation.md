# Euler 346: Strong Repunits

Research on 2026-11-02 against `bb0caf05`, Node 24.15.0. The next new
workload after 344 in issue #447 is 346. The earlier 343 investigation is
still separate and unshipped. The initial investigation was read-only. The delivery section below records
the subsequent implementation and verification.

## Cause

The current algorithm generates all repunits of length >= 3 for bases from 2
through floor(sqrt(Limit-1)). A set removes duplicates and its values are summed.
At Limit=10^12, diagnostics show 1,011,530 compiled set-add effects inside one
compiled BigInt loop, plus the separately executed insertion of 1. This is not
an accidentally uncompiled hot loop. Interpreter dispatch adds cost in reference
mode, but generating and retaining roughly a million values is avoidable.

Owned integer sets already use numeric keys (`runtime/collections.ts`), so
replacing string keys with numeric keys would duplicate existing functionality.
The compiled mutation calls still use the ordinary collection adapter and
publish loop bindings. `integer-loop-statements.ts` excludes mutation effects
from Number lowering; `number-loop-runtime.ts` also requires number-safe calls.
An overflow retry must not replay already-visible set mutations. Removing these
checks without ownership, rollback and error-order guarantees is unsafe.

## Algorithm

Every length-3 value is b^2+b+1. For a strict bound L, the final base is
B = floor((isqrt(4L-7)-1)/2). Their sum, including 1 and excluding bases 0 and 1,
is B(B+1)(B+2)/3 + B - 2. Limits below 7 need a separate boundary branch.

Enumerate only longer repunits. Their initial value is b^3+b^2+b+1, so stop
at the first base whose initial value reaches L. At 10^12 this visits bases
2..9999 and 11,532 values, all distinct in this particular full-input run.
Do not assume this distinctness for arbitrary limits: keep deduplication.
A longer value v is already counted in the quadratic family exactly when
4v-3 is a square. Full-input overlaps are 31 and 8191, but the code checks the
general square criterion rather than special-casing these two numbers.

`experiments/euler346-split.ra` uses a small set and tests this criterion before
insertion. `euler346-generator.ra` instead yields longer values, applies
`unique`, and uses an array square-test mask. Both retain general deduplication.
The array version reads cleanly and is close in cold execution, but the set
version is a little faster. A control that merely replaces the original set
with a generator and `unique sum` is slower and uses slightly more memory.

The old helper returns 1 for Limit=1, contrary to its strict upper bound.
The revised prototypes return 0 for Limit <= 1. Correctness comparisons treat
the original Limit=1 behavior as a recorded incompatibility, not a new expected
mathematical result. Original Limit=0 raises an isqrt domain error; the original
program does not define a useful nonpositive-input contract.

## Measurements

Three alternating serial fresh processes per case, including parse, compile
and execute, excluding interpreter module import and process startup. Time and
whole-process peak RSS entries are medians. Background load was not controlled;
these are not isolated hardware guarantees. Both machines used Node 24.15.0.
Mac is arm64; the connected Intel host is x86_64. The same built interpreter
from the 344 delivery was used locally and on Intel; no runtime patches.

| Variant | Mac compiled | Mac reference | Intel compiled | Intel reference |
| --- | ---: | ---: | ---: | ---: |
| Original | 0.367 s | 1.176 s | 0.778 s | 2.830 s |
| Formula + small set | **0.116 s** | **0.136 s** | **0.288 s** | 0.360 s |
| Formula + generator + mask | 0.124 s | 0.137 s | 0.318 s | **0.348 s** |
| Original enumeration + generator | 0.502 s | 1.348 s | 1.098 s | 3.111 s |

| Variant | Mac compiled MiB | Mac reference MiB | Intel compiled MiB | Intel reference MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 313.8 | 322.2 | 297.7 | 305.5 |
| Formula + small set | 160.7 | 178.1 | 159.4 | 165.3 |
| Formula + generator + mask | 161.7 | 178.5 | 162.4 | 164.5 |
| Original enumeration + generator | 326.2 | 339.9 | 307.9 | 318.0 |

A separate five-call Mac warm control reuses one interpreter. Original compiled
calls took 299, 257, 270, 260, 284 ms; split calls 17.1, 6.1, 3.6, 3.7, 3.9 ms;
generator calls 25.9, 8.7, 8.6, 7.0, 6.4 ms. This short series illustrates that
most remaining cold latency is setup, not a robust steady-state benchmark.
Repeated original calls increase whole-process peak RSS; these warm peaks are
not substituted for the fresh-process memory comparison.

## Verification

`euler346-verify.mjs` inspects base digits of each integer below 100,000 to build
an independent oracle. It checks 617 limits: 1..512, explicit boundaries around
repunit collisions, and deterministic random limits. Original, split and array
variants run with compilation enabled and disabled: 3,700 mathematical checks
per host, all passed on both hosts. Two additional original Limit=1 observations
per host assert the known old result of 1 rather than counting it as correct.

Every one of the 48 formal full-input samples checks 336108797689259276.
No full test suite or exhaustive audit was run. No interpreter/compiler source
changes are part of this optimization. Delivery removes the two audit exclusions
after checking the optimized full workload.

## Recommendation

Use the formula and enumerate only longer values. The small-set prototype is
the measured speed choice; the generator/mask version offers array-oriented
filtering at a modest cold cost. The delivery includes strict-boundary regression tests. There is no demonstrated compiler correctness bug in
this workload. Private-set Number execution and deeper generator compilation
could be useful general work, but have not been prototyped or proven here; the
remaining solver work is already only a few milliseconds on the local Mac.

Reproduce using an interpreter built from this revision:

```
node benchmarks/euler346-verify.mjs
node benchmarks/euler346-investigation.mjs original compiled
node benchmarks/euler346-investigation.mjs \
  benchmarks/experiments/euler346-split.ra reference
node benchmarks/experiments/euler346-series.mjs /tmp/rank346-samples.json
```

Set `RANK346_RUNTIME` to an absolute `packages/interpreter/out/index.js` path
when benchmarking a separate build. Raw samples are in
`baselines/2026-11-02-euler346-investigation.json`.

## Delivery

Promoted the small-set variant to `demos/euler/346_strongrepunits.ra`.
The first length-4 value uses two multiply-add steps; the discriminant is
assigned once. Production Rank source lines stay within 40 characters. The top-level
`Answer` binding is retained for the existing full-default fixture.

Added three small Rank test groups covering examples, strict bounds (including
0 and 1), and the 31/8191 overlaps. Added four interpreter tests: independent
base-digit enumeration around boundaries and the full target in both modes.
Removed the main and full-default fixture from execution exclusions.

Delivery verification: focused interpreter tests 4/4, small CLI tests 3/3,
full-default CLI test 1/1, audit-infrastructure checks 7/7. Language generation
and TypeScript build passed. Exhaustive audits and the full suite were not run.
The standalone oracle also includes the delivered program in both modes, for
4,934 successful mathematical comparisons (plus the two original Limit=1
compatibility observations).

Three final-source fresh-process trials per mode and host also verified the full
answer. Their raw samples are in the baseline JSON under `delivery.samples`.
