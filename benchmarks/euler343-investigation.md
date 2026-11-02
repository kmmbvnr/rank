# Euler 343: current execution and slice-write preparation

Research on 2026-11-02, source snapshot `5e8babc3`, Node 24.15.0.
The next unfinished numbered workload in issue #447 is
`euler/343_fractional.ra`. It already received an algorithm and factorization
improvement, documented in `quadratic-factors-results.md`; its main execution
exclusion remains open. This investigation does not replace that earlier work.

## Findings

The current quadratic-root sieve is appropriate. Every discovered prime removes
its factors along two arithmetic progressions, with the double root visited
once. A second sieve records largest prime factors of `k+1`. The final sum is
exact. Current full runs finish in seconds, rather than the historical slow
per-number factorization. All full samples return `269533451410884183`.

The main quadratic loop already uses the Number backend. The prime-driven
linear sieve uses the exact compiled loop and 148,933 bulk slice assignments,
covering 5,808,802 cell stores. It does not need a new factorization algorithm.
`integer-loop-header.ts` currently rejects Number lowering of prime iterators;
the exact compiled backend handles them.

A general allocation issue occurs in `prepareRegionArrayWrite`:
`prepareArrayAssignment` and its synthetic statement and host wrappers are rebuilt
on **every execution** of the same compiled slice-write site. Ordinary interpreted
statements already retain their prepared statement. A prototype prepares the
compiled write once and supplies current selectors/RHS through an invocation
frame, restoring the previous frame in `finally` for errors and nested calls.
The Rank program, array syntax, bounds validation before RHS evaluation,
ordinary binding boundaries and exact bulk-store primitive are preserved.

This prototype is in `experiments/euler343-prepared-write.patch`, applied only
to a private snapshot. It is not a production change. Dedicated reentrancy,
callback/error and cancellation regression coverage is still required before
shipping it. Existing tests passing is evidence, not a complete proof of those
contracts.

## Full default measurements

Three alternating serial rounds per machine; medians below. Parse, compilation
and execution are timed; imports/process startup are outside the timer. Memory
is the median of the three **whole-process peak RSS** values, not retained
storage. Mac: Apple M5 arm64. Intel: Core i7-10750H x86_64, accessed through the
saved tunnel; hardware and Node version were verified. Other machine load was
not controlled, so small timing differences are not a reliable ranking.

| Variant | Mac time | Mac peak RSS | Intel time | Intel peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Current program/compiler | 0.977 s | 511.7 MiB | 2.854 s | 491.2 MiB |
| Same program, reuse write preparation | 0.791 s | 413.5 MiB | 2.158 s | 346.1 MiB |
| Shared factor buffer + reused preparation | 0.758 s | 410.5 MiB | 2.054 s | 390.8 MiB |
| Scalar linear sieve, current compiler | 0.804 s | 269.6 MiB | 1.784 s | 257.8 MiB |

Reusing preparation gives about 19% / 24% less elapsed time and 98 / 145 MiB
less peak RSS on Mac / Intel. This is a compiler-only comparison.

The scalar control expands the one slice assignment into an inner loop. Its
lower memory use is a target for improved slice lowering, not a reason to
replace the concise array expression by hand. Sharing `Largest` with the
linear-factor table removes a full table and final gather/max temporaries:
typed published cells fall from 14,000,005 to 8,000,003. However, whole-process
RSS does **not** improve consistently; it rises on Intel relative to the
compiler-only prototype. Do not adopt that representation based on these
results. It also changes the internal `Largest` table's meaning, which existing
oracle tests intentionally inspect.

A replacement scalar final reduction did not improve the first exploratory
sample (0.831 s versus 0.833 s current), and its RSS was higher. There is no
reason to replace the final array reduction.

Single complete reference runs of the unchanged source took 28.089 s / 696.6 MiB
on Mac and 75.602 s / 504.8 MiB on Intel. These are single samples, not medians;
the Mac run overlapped a short test run. They establish that reference execution
still has a large gap, not a precise speedup. The preparation-cache prototype
only affects compiled region writes and does not speed the reference lane.

## Verification

- All 24 full compiled samples assert the same golden result. The existing
  independent Python modular-root sieve also reconfirmed the full checksum
  in 2.244 s (one run).
- Six hundred independent comparisons: every sum prefix from 1 to 100, using
  direct trial division of `k^3+1`, for original, shared-buffer and scalar-linear
  sources, with compilation both enabled and disabled.
- 218 focused tests passed against the isolated preparation-cache prototype:
  quadratic factors, Number-loop vectors and vector bounds, bulk slice writes,
  slice-write snapshots, slice assignment and loop control.
- Langium generation and TypeScript project build passed.
- No exhaustive audits or full test suite were started.

Raw samples: `baselines/2026-11-02-euler343-investigation.json`. Earlier exploratory
samples were not combined with the final Mac series. No production source,
exclusion, issue table or GitHub comment was changed for this research.

## Recommended implementation

First make write preparation reusable in the compiled backend, with explicit
coverage for nested/reentrant calls, exception cleanup, selector-before-RHS
validation, snapshots and cancellation. Then investigate a prepared arithmetic
range store that avoids constructing the general assignment machinery for
each prime. Keep the existing array-oriented demo and exact fallback.
Recheck both architectures and unrelated slice-heavy demos before deciding
whether the full execution exclusion can be removed.

## Reproduction

Use separate clean source snapshots for current and prototype runtimes; apply
`experiments/euler343-prepared-write.patch` only to the latter. Build each with
Langium generation and `tsc -b tsconfig.build.json`. For each runtime:

```sh
RANK343_RUNTIME=/absolute/path/packages/interpreter/out/index.js \
  node benchmarks/euler343-investigation.mjs original compiled 2000000
RANK343_RUNTIME=/absolute/path/packages/interpreter/out/index.js \
  node benchmarks/euler343-investigation.mjs original reference 2000000
RANK343_RUNTIME=/absolute/path/packages/interpreter/out/index.js \
  node benchmarks/euler343-verify.mjs
```

The first argument can instead be the shared-buffer or scalar-linear Rank
file under `benchmarks/experiments/`. Add `diag` after the limit to collect
counters; diagnostic samples are separate from timing samples.

## Delivery

The preparation cache is now implemented in `eval/assignments.ts`. One prepared
ordinary assignment is retained per compiled write site; synchronous invocation
frames provide current selectors and RHS and restore the previous frame in
`finally`. The Rank demo stays unchanged: its existing array sieve is retained.
The shared-buffer and scalar-linear variants remain experimental controls.

Five dedicated unit cases cover preparation once, current operands, nested
invocation success/failure, selector-before-RHS validation, exception cleanup
and cancellation recovery. The related eight-file test run passes 223 tests;
a full compiled checksum regression is also added. The companion CLI fixture,
600 independent small-prefix comparisons, four scoped type/differential cases,
seven audit infrastructure tests, semantic boundary check, Langium generation
and TypeScript build pass. The scoped differential includes the complete main
and takes about 50 seconds under test instrumentation. The full main is now
eligible for corpus execution. No exhaustive audit or full suite was run.

Fresh alternating three-sample controls on each host, unchanged source and
full golden answer asserted in every process:

| Host | Baseline s | Delivered s | Baseline MiB | Delivered MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 0.996 | 0.825 | 511.9 | 404.3 |
| Intel x86_64 | 3.178 | 2.301 | 503.6 | 345.8 |

These are medians of serial fresh processes on Node 24.15.0; import/startup
excluded, parse/preparation/execution included, whole-process peak RSS.
Background load was not controlled. Raw delivery samples are appended to the
baseline JSON. Reference execution is unchanged by this compiler-only fix;
its general per-iteration overhead remains a separate improvement opportunity.
