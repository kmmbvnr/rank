# Private integer-loop registers (#311)

Measured on Apple M5, Node 24.15.0. Each sample runs in a fresh process; medians
use three samples. Execution includes parsing and generated-code preparation.
Cold time additionally includes process startup, imports, checks and disposal.
Diagnostic executions are separate from timed samples. Timed series ran without
other Rank audits in parallel. The baseline is main at `4a1b98a9`; the candidate
includes main's predicate-graph integration at `6e256f60`.

| Case | Baseline execute, s | Candidate execute, s | Baseline cold, s | Candidate cold, s |
| --- | ---: | ---: | ---: | ---: |
| repro | 4.504 | 0.735 | 4.759 | 0.993 |
| 150-original | 13.921 | 2.672 | 14.171 | 2.923 |
| 150-current | 13.874 | 2.356 | 14.133 | 2.608 |

The 100-million-iteration result is 999999991. Both 1000-row triangle formulations
return -271248680. Candidate diagnostics show one Number region for each case;
Euler 150 also executes its existing BigInt array-initialization loop. None of
these benchmark entries overflows. The under-one-second target concerns execution;
cold startup is reported separately. The original/current demo difference is
small: the runtime change provides the measured acceleration.

Run after building:

```sh
node benchmarks/number-loops.mjs --baseline=/absolute/path/to/old/out/index.js
```

`--trials=1` and `--cases=repro` select a short check. Every timed sample verifies
its answer; candidate medians enforce <1 s for the repro and <5 s for Euler 150.
Additional diagnostic runs assert that the Number backend actually executes.
The original demo is frozen in
[150-subtriangle-original.ra](fixtures/150-subtriangle-original.ra).
[Raw samples](baselines/2026-10-19-number-loops.jsonl) include the baseline version,
final candidate runtime commit and exact source hashes. Baseline samples come
from the preceding isolated serial series; the final candidate was rerun after
the empty-register code-generation fix.

## Exactness and memory

The language still exposes exact BigInt integers. Supported private regions use
safe Number registers with guards on integer intermediates, division/remainder
and range progression. Overflow discards an unpublished attempt and uses the
existing BigInt loop from its original inputs. Calls, mutation, unsupported
contracts and observable entry hooks retain that backend. Atomics cancellation
publishes completed assignments before error propagation and `finally`.

Eager rank-one integer reads use invocation-owned Float64 buffers after checking
all cells. Euler 150's 500501-cell prefix array needs an additional 4,004,008-byte
numeric buffer (about 3.82 MiB). Its ordinary arrays remain materialized. No
persistent numeric mirror is retained, and no peak-heap or allocation reduction
was measured. The scalar repro creates no such array buffer. See
[the runtime contract](../docs/design/runtime-execution.md#whole-integer-loops)
for eligibility, publication and fallback details.

## Differential coverage audit

All 30 previously excluded solution/test files were retried in fresh reference
processes, each with a 60 s timeout and a 1536 MiB JS heap budget. The resource-abort
cases (179 default and both 196 files) were retried with Node's default heap;
they exceeded 60 s there. Those aborts are not reported as completed timings.
The [reference audit](baselines/2026-10-19-number-loop-reference.jsonl) records
status, signals, elapsed time, output and embedded-test results.

Actual compiled/reference comparisons then verified the affordable cases:

| Restored files | Combined comparison time per file |
| --- | --- |
| 149 solution and test | 63.9 / 65.7 s, isolated rerun; approximately one minute |
| 150 small test | within one minute |
| 154 test | within one minute |
| 155 test | within one minute |
| 165 test | 21.4 s |
| 179 test | 16.6 s |
| 181 solution and test | 58.6 / 34.8 s |
| 193 test | 0.5 s |
| 195 solution and test | 48.3 / 46.4 s |

This restores 12 files. Euler 149 initially took 81–89 s during concurrent audits;
the isolated comparison is used for the approximately-one-minute decision.
Euler 150's small cases remain in its ordinary test file; the full default check
is separate in `150_subtriangle_default_test.ra`. The default solution and that
full check remain excluded from reference comparisons. The other defaults/tests
that still exceed the reference time/resource budget retain their exclusions.
The test and coverage checker use identical, file-specific patterns.

The differential harness counts loops through RuntimeDiagnostics rather than an
execution callback that may mutate bindings. This permits the Number backend to
run during comparison; shard summaries report Number entries and aggregate
coverage requires a positive count. Focused restored comparisons already execute
42 Number regions. Compiler acceleration does not itself accelerate the
`compilation: false` side; remaining exclusions are not considered fixed by #311.
