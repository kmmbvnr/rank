# General runtime steps: entry proofs and producer routing

Baseline: `08dac75e`. Candidate includes `efbd1901` (entry proofs) and the
shared shift/concat reader change delivered with this report. No demos change.
Candidate interpreter source SHA-256 (sorted relative `.ts` paths, NUL, bytes):
`3611f583791a78b836e37d9b86859fceb7d7297b4b58097a8903c2bc51d20d9d`.

The first step reuses the disabled-selector fix from `08df1964`, without its
Euler changes, and removes duplicate storage proofs within an invocation.
The second stores native recipes independently of compilation and extends
integer grouped consumers with shift/concat routing on every axis. Generated
tensor kernels and readers share metadata proofs. Source and fill reads remain
lazy; a concat reads only its selected segment. Lookup is logarithmic in the
number of segments. Ordinary assignment and observable-demand boundaries remain.

## Method

Node v24.15.0, Apple M5 and Intel i7-10750H. Three fresh processes per case,
engine and revision, alternating revision order. Execution includes preparation
and compilation but excludes parsing and startup. Integer-loop compilation is
disabled in both revisions to isolate scalar entry selection in the entry case;
tensor and scalar-function capabilities otherwise follow the selected engine.
All results are checked against exact independent formulas. Tests/builds were
finished before each host's timing series; other system load was not controlled.

Each combination has a separate diagnostic-on observation, excluded from timing
medians. RSS is process peak, including parsing/startup. Retained heap and buffer
totals after GC are recorded while the interpreter is reachable; these are not
isolated object-graph sizes or cumulative allocations. No allocation reduction
is inferred from RSS alone.

- `routing`: 200,000 exact wide products, shift with fill, concat, grouped sum.
- `stored`: completed Int32 values/keys, controlling the existing fast path.
- `entries`: 10,000 calls with a mutable integer set, accumulating exact results.

## Medians

| Host | Case | Engine | Baseline ms | Candidate ms | Peak RSS MiB, before / after |
| --- | --- | --- | ---: | ---: | ---: |
| Mac | routing | reference | 81.13 | 36.44 | 171.5 / 154.8 |
| Mac | routing | compiled | 84.80 | 38.18 | 171.3 / 155.0 |
| Intel | routing | reference | 231.12 | 95.37 | 158.6 / 141.6 |
| Intel | routing | compiled | 226.73 | 96.01 | 159.4 / 142.2 |
| Mac | stored | reference | 6.93 | 6.80 | 152.7 / 154.0 |
| Mac | stored | compiled | 7.40 | 7.39 | 152.4 / 143.6 |
| Intel | stored | reference | 15.08 | 15.80 | 139.1 / 139.3 |
| Intel | stored | compiled | 17.34 | 17.78 | 128.4 / 139.2 |
| Mac | entries | reference | 121.42 | 88.10 | 220.8 / 204.2 |
| Mac | entries | compiled | 106.31 | 83.37 | 192.2 / 190.3 |
| Intel | entries | reference | 423.16 | 302.34 | 201.2 / 184.0 |
| Intel | entries | compiled | 313.88 | 271.50 | 176.8 / 173.5 |

Routing improves about 2.2–2.4x in these cases. The stored Intel controls are
about 5%/3% slower; no universal speedup or memory reduction is claimed.
Diagnostic routing runs select two native readers after the change, versus one
before it, in both engines. Initial research missed reference recipe registration;
strengthened tests now require both value/key readers, not merely a positive
counter that the stored keys alone could satisfy.

## Verification

- First step: build and 60 targeted Mac tests before commit.
- Second step: build, 176 tests in nine Mac files, 11 semantic-boundary tests,
  65 semantic owners, and both application-form checks.
- Combined candidate: 118 tests in five Intel files.
- Independent coordinate/prefix oracle covers three axes, extreme signed shifts,
  exact wide integers, repeated demands, empty segments, and completed snapshots.
- Earlier key errors precede later concat failures; completely shifted-away
  failing cells remain unread. Existing host/effect/budget tests retain fallback.
- Full suites and exhaustive audits were not run.

These first two steps do not implement scatter fusion, general region work/effect proofs,
array-rotation ownership analysis, or per-definition integer range propagation.

## Reproduction

Build baseline and candidate with Langium generation and TypeScript project build.
Run from the candidate:

```sh
node benchmarks/general-runtime.mjs --baseline=/path/to/built/baseline --cases=routing,stored,entries
```

Raw observations: [Mac](baselines/2026-11-04-general-runtime-mac.json) and
[Intel](baselines/2026-11-04-general-runtime-intel.json).


## Final integration verification

The combined implementation includes the subsequent [entry-work proof](entry-work-results.md),
[array transfers](array-transfer-results.md), [binding ownership](array-ownership-results.md)
and [integer ranges](integer-range-results.md). It is integrated with main through
`1199b736`, preserving its independent mixed-output, finite-iterable and bitwise
compiler changes and the ACMP updates.

Final interpreter source SHA-256 (sorted repository-relative `.ts` paths under
`packages/interpreter/src`, each followed by NUL and its contents):
`e1cf750b79d41442f2d41ea34cddbb66ecaec4bae5f4ea278dedb78cda0c65af`.

The ordinary interpreter run excluded `types.test.ts`, `differential.test.ts`
and `nurikabe.test.ts`, using the audit-aware runner with four workers. It
finished with 11913 passed tests, 13 failed tests and one file-load error across
558 files. This was not a clean full run. Each failing file was investigated:

- The shared entry-work proof incorrectly treated outer `continue` like an
  escaping jump. Fixing that restored the original Euler 379 numeric-region
  assertions. A new regression compares the state with exact execution.
- Alias compilation, boolean storage fills, Euler 388's replaced Mertens helper,
  and main's additional mixed tier required updated test expectations. Exact
  answers, alias snapshots and observable polling checks remain in place.
- Euler 644, 362, 671 and 505 timeouts and the Euler 696 loader error did not
  reproduce in isolated runs. No timeout limits were increased. Euler 505 took
  64.5 seconds with its existing 180-second process deadline.

Mac reruns passed: 287 tests in five affected files; all 70 tests in five
work-proof/mixed-tier/full-demo files (69 first, then the corrected Euler 288
counter check); five tests in Euler 362/671; and the full Euler 505 check.
Intel passed 543 focused tests in 12 files on the final runtime. The TypeScript
project build, 11 semantic-boundary tests, 65 semantic owners, application-form
checks, and all six ACMP 928 examples also pass. The entire ordinary suite was
not repeated after the narrow work-proof repair. Exhaustive audits were not run.

Final smoke checks on Apple M5 and Intel i7-10750H independently assert the
expected result for all 16 compiled benchmark cases and the three reference
producer/entry controls, with diagnostics both off and on. These are one-sample
integration checks, not new comparative performance measurements. The earlier
five-sample reports remain the evidence for speed and memory changes. Raw final
candidate observations: [Mac](baselines/2026-11-04-general-integration-mac.json)
and [Intel](baselines/2026-11-04-general-integration-intel.json).
