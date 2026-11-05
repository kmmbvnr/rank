# Euler 193 investigation

Revision `f9e7fe91d025d5dff05fe8e1a8daae82b6ee1260`, Apple M5, macOS arm64,
Node v24.15.0. Euler 193 is the next unfinished numbered workload in #447.
The demo and runtime are unchanged by this investigation.

| Workload | Compiled execution | Reference execution |
| --- | ---: | ---: |
| Full main, Power=50 | 0.577 s | 201.707 s, one run |
| Existing fixture, powers 10/20/24 | 0.130 s | 0.178 s |
| Main, Power=40 | Not sampled | 6.243 s |

Except for the single full reference check, entries are medians of three serial
fresh processes. Full compiled samples span 0.559–0.586 s, with median peak RSS
494.4 MiB. The reference full check used an extra `Top print` before the loop;
that checkpoint occurred at 0.117 s. It used 574.2 MiB peak RSS. Do not treat
the single full reference observation as a repeated speedup estimate.

Timers include interpreter construction, parsing, compilation, execution and
output callbacks. Imports, result assertions, oracle execution and disposal are
excluded. RSS is the whole-process high-water mark, captured before the oracle.
Diagnostics and CPU profiles ran separately from the timing cohort. Small-input
RSS and timings describe the Rank workload, excluding the oracle.

## Findings

The algorithm computes the Moebius sum
`sum(mu(d) * floor((2**Power - 1) / d**2))` using a linear sieve. Time and
storage are O(sqrt(N)); the default visits 33,554,430 outer iterations, rather
than enumerating roughly 10^15 candidate numbers. It is a reasonable compact
algorithm for this input and is already fast in the compiled engine.

The entire nested search executes as one Number loop. Separate diagnostics:
`compiledLoops=1`, `numberLoops=1`, `numberLoopOverflows=0`,
`typedUnpacks=0`, `compilerRejections=[]`. The initial scalar/constructor
fallback records concern preparation outside the loop. Ordinary `=` bindings
are appropriate; there are no deferred array stages to fuse here.

Reference execution pays generic statement/expression evaluation, array
selection/assignment, exact arithmetic and range traversal on every iteration.
A separate Power=40 CPU profile distributes self samples across loop streaming,
sequence iteration, range construction/registration, assignment, expression
evaluation and execution continuations. There is no missing compiler construct
blocking this program. The compiled profile's largest self entry is generated
code; `writeInteger32Cells` publication also appears prominently. These are
whole-process sample profiles, including imports/preparation, not precise phase
percentages for the search alone.

The default creates 33,554,432 Mu cells and 4,194,403 prime slots in Int32
storage: about 144 MiB together. It actually finds 2,063,689 primes. The numeric
region adds private Int32 copies and byte dirty masks, about another 180 MiB,
before other runtime/process memory. Those copies preserve exact replay on
overflow and ordered publication. A narrower representation for small integers
could save memory, but is an unimplemented general runtime direction; no speed
or memory saving is claimed here.

## Verification and decision

The full answer is `684465067343069` in both engines. All existing fixture
assertions pass in both engines. An independent oracle marks multiples of every
square directly, without Moebius values or a prime list: powers 1–10, 12, 16,
20 and 24 match in both engines (28 checks).
The TypeScript build, benchmark syntax check, and scoped type/differential
checks for `euler/193_squarefree_test.ra` pass (2 tests).

Retain the algorithm and runtime for this workload. The remaining large gap is
general reference-engine overhead; the existing full reference execution-budget
exclusion is unchanged. Smaller representations or a more complicated summatory
algorithm should be justified by a separate measured objective.

Reproduce after `npx tsc -b tsconfig.build.json`:

```sh
node benchmarks/euler193-squarefree.mjs
node benchmarks/euler193-squarefree.mjs --reference --phases
node benchmarks/euler193-squarefree.mjs --fixture
node benchmarks/euler193-squarefree.mjs --fixture --reference
node benchmarks/euler193-squarefree.mjs --power=24 --oracle
node benchmarks/euler193-squarefree.mjs --power=24 --oracle --reference
node benchmarks/euler193-squarefree.mjs --diag --phases
```

Use an external process deadline for the synchronous full reference run.
[Raw samples, diagnostics, profile summaries, source and controller](baselines/2026-10-27-euler193-investigation.json).
