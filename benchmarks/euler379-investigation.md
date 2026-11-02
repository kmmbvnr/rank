# Euler 379: nested vector work and private-copy admission

The unchanged full quotient-value sieve now enters the private Number backend
for both prime-vector loops. `Limit=10^12` produces `132314136838185` exactly.
The only demo change handles `Limit=0` and `1`, whose empty high-value table
previously caused an out-of-bounds read.

## Cause and change

The default has two destination vectors with 2000001 cells in total. The outer
prime vector has only 78498 cells. Its length does not amortize the destination
snapshots, so copy admission rejected Number mode above the 262144-cell probe
cap. Each outer iteration actually contains substantial inner range passes.
The old estimate missed that work; removing the cap experimentally exposed it.

The compiler now derives a lower bound from complete nested range passes in
at most the first and last iterations of a trusted packed integer vector.
It tracks pure integer arithmetic, standard scalar min/max, known branches and
local assignments. The last iteration contributes only without a possible
escaping break/return. Entry values assigned anywhere in the region cannot be
reused as immutable bounds. A preceding nested pass invalidates its scalar
writes and induction names before later bounds are examined.

Unknown bounds, calls/callouts, unsupported statements, shortened inner passes
and iterator storage shared with a destination retain the previous policy.
All destinations contribute to the cost; stepped ranges use their cardinality.
The existing 64-cell sentinel allowance applies. Below the probe cap, measured
feedback is unchanged. Overflow checks, exact replay, error state and publication
remain in the existing backend. This is a general compiler admission change,
with no Euler-specific values or answer recognition.

## Measurement

Node 24.15.0 on the local Mac and saved Intel host. Raw samples and source hashes
are in `baselines/2026-11-02-euler379-investigation.json`.
Measurements are elapsed interpreter execution time and process peak RSS,
including parsing and setup. Shared hosts can have unrelated activity.

| Full compiled input | Mac | Intel |
| --- | ---: | ---: |
| Three-process median | 9.901 s | 24.384 s |
| Median peak RSS | 236.0 MiB | 245.2 MiB |
| Previous admission control | >30 s, stopped | >60 s, stopped |

The series predates the final preparation guard that skips this analysis for
loops without destinations; that guard does not change either Euler 379 sieve.
Final runtime verification is retained separately in the raw artifact. Its Mac
diagnostic run takes 8.565 s and 232.0 MiB; the matching final Intel run takes
23.958 s and 244.7 MiB, also with four Number loops and no overflow/copy probe.
Earlier overlapping exploratory series are identified separately and are not
used for these medians.

The control replaces only `prepareVectorEntryWork` with `undefined` in the built
runtime through a fresh-process Node loader hook. It leaves the same Rank source,
other compiler paths and exact arithmetic intact. The cap itself is unchanged.

```sh
node benchmarks/euler-neighbours-runtime.mjs 379 full
CONTROL=vector-work node benchmarks/euler-neighbours-runtime.mjs 379 full
DIAGNOSTICS=1 node benchmarks/euler-neighbours-runtime.mjs 379 full
```

Full Mac controls reached the 30-second deadline without a result; the Intel
control uses a 60-second deadline. These are censored measurements, not completed
baseline times or memory comparisons. The new implementation's diagnostic run
has four Number loops, no overflow, no copy probes and no copy-budget fallback.
The optimization admits amortized snapshots; it does not eliminate them.

## Verification and limits

- New admission tests cover forward/reverse traversal, early exits, shortened
  passes, mutable bounds, helper calls, shared backing storage, empty/singleton
  vectors and exact overflow replay.
- An independent ordinary prime-factor sieve counts divisors of each `n^2`.
  Its accumulated `(sum d(n^2) + N) / 2` agrees with compiled, exact-loop and
  reference execution at square/quotient boundaries through 10000.
- Exhaustive explicit LCM pair enumeration through 100 checks that oracle.
- A dedicated full default golden test requires both prime sieves to compile
  with no Number overflow or speculative copy probe.
- The fixture now includes 0 and 1. Its scoped type and differential audits pass.
- The five-file compiler regression run has 249 passing tests and one existing
  diagnostic-count failure in `number-loop-adaptive.test.ts`: the condition-loop
  overflow/error case records two overflows while expecting one. With the new
  vector-work preparation disabled it records the same two overflows and the
  same bounds error; this change does not alter that case.
- TypeScript build, application-form checks and semantic-boundary checks pass.
  Full exhaustive corpus audits were not run.

Full reference execution remains excluded from corpus audits. The dedicated
compiled full test and small reference fixture cover their respective paths;
the compiler improvement does not make a claim about full interpreter speed.
