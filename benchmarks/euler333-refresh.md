# Euler 333: one-table DP and condition-loop copy admission

Implemented on top of `c4bbcab6`, measured 2026-11-02, Node v24.15.0.
This follows [the original recursive-to-layered improvement](euler333-results.md).
The full answer remains **3053105** and partitioncounts retains every exact
count, its shape, and the empty partition at zero.

## Changes

The old layered recurrence allocates a fresh million-cell table for each
power of three. Update one table instead:

1. Visit odd N >= Power in descending order: C[N] += C[(N-Power)/2].
2. Visit positive even N in ascending order: C[N] = C[N/2].

The descending pass reads smaller indices before they have been updated;
even entries still belong to the old layer. The ascending pass then reads
halves already belonging to the new layer. Odd entries below Power remain
unchanged. Complexity is still O(Limit log_3 Limit) time and O(Limit) storage,
with one count-table allocation instead of thirteen at the default limit.
The hot passes also avoid a parity branch for every cell.

The compiler now recognizes a condition loop beginning with complete range
passes. For an entered first iteration it sums their lengths from guarded
entry integer bounds. It stops at a non-range statement or a range whose
bounds a preceding pass changed. Calls, early exits, branches hiding a pass,
unknown lengths and array-cell bounds do not qualify. All destinations still
contribute to copy cost. Existing private writes, overflow replay, aliases,
error publication, 64-cell allowance and 262144-cell probe cap are unchanged.
The rule is general, not keyed to the demo or helper names.

Here the first iteration visits Limit-1 cells. This already covers copying
its destination under the existing single-sentinel allowance; later iterations
provide further work. Without the new rule the condition loop rejects Number
admission and runs an exact BigInt kernel. The production demo needs neither
real-valued counters nor an extra stage-counting loop to bypass that rejection.

## Measurements

Medians of three sequential fresh processes per compiled case, alternating
before/after order. No same-host tests or builds ran during the final samples.
Other host activity is not controlled. Solve time includes compilation, count
allocation and prime selection, excluding interpreter construction, imports and
helper definitions. RSS is a whole-process peak, not retained DP storage.

Both rows below compare the saved old algorithm with the delivered program on
the updated runtime, with no benchmark loader control enabled:

| Host, full compiled | Old layered program | Delivered | Old peak RSS | Delivered peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac | 147.65 ms | 72.74 ms | 263.9 MiB | 170.1 MiB |
| Intel | 393.23 ms | 179.60 ms | 262.5 MiB | 173.0 MiB |

One full Mac reference control per version (not medians):
**12.303 -> 6.927 seconds**, **220.0 -> 184.0 MiB** peak RSS.
All completed full-input runs return 3053105.

For the delivered source alone, disabling only the new admission proof gives
**1169.24 -> 72.74 ms** on Mac and **3510.93 -> 179.60 ms** on Intel.
These controls distinguish compiler improvement from the algorithm change.
The disabled control uses a Node module loader hook before runtime import;
its process RSS includes that hook, so use the ordinary table above for the
headline memory comparison. No production module or runtime option is changed.

Separate diagnostics: typed published cells fall from 14,078,498 to 1,078,498,
including prime-selection outputs. Both versions have zero CoW copies and zero
typed unpacks. These counters measure published allocation volume, not all
allocations or live storage. The old algorithm enters 13 Number loops; the
new algorithm enters one. Disabling the proof on the new source enters zero.

Compiler-only controls on other full demos, median milliseconds:

| Demo | Mac proof disabled | Mac enabled | Intel disabled | Intel enabled |
| --- | ---: | ---: | ---: | ---: |
| 185 | 526.17 | 520.03 | 1409.50 | 1386.36 |
| 331 | 1436.68 | 1438.60 | 3452.20 | 3448.64 |

These small differences do not establish a speed change for those demos.
Golden answers pass for every sample. Intel uses /opt/rank-bench-node/bin/node
on root@viewflow.io:22022. The isolated /tmp/rank333-delivery snapshot contains
both current built packages and current control demo sources, with its language
package link resolving inside that snapshot.

## Verification

- 297 focused tests across euler333, number-loop-adaptive, number-loop and
  loop-control, including short calls, phase changes, empty roots, descending
  and strided ranges, changed bounds, branches, multiple destinations, aliases,
  overflow replay and preceding stores before an error.
- Production counts match the saved recurrence in 1,021,331 compiled cell
  comparisons and 21,331 reference comparisons. The same comparisons pass with
  the new admission proof disabled.
- The existing independent native exhaustive traversal (183,872,640 recursive
  calls, 40,549,126 leaves) matches every million-cell production count and the
  prime sum. Oracle work is outside solve timing.
- Full-input regression checks the exact answer, admitted Number execution,
  no CoW/unpacking and fewer than two million published typed cells.
- Rank fixture passes; TypeScript project build and whitespace checks pass.
  Full suites and exhaustive corpus audits were not run.
  The default retains its reference-budget exclusion; its reason now describes
  12.6 million updates rather than the removed thirteen-table allocation.
  All three execution-exclusion metadata checks pass.

```sh
node benchmarks/euler333-refresh.mjs verify
ENTRY_WORK=0 node benchmarks/euler333-refresh.mjs verify
node benchmarks/euler333-refresh.mjs original compiled 1000000
node benchmarks/euler333-refresh.mjs production compiled 1000000
ENTRY_WORK=0 node benchmarks/euler333-refresh.mjs production compiled 1000000
node benchmarks/euler333-refresh.mjs production reference 1000000
node benchmarks/euler333.mjs --worker=layered --limit=1000000
node benchmarks/euler333-refresh.mjs demo185
node benchmarks/euler333-refresh.mjs demo331
```

The harness retains the initial conditional prototype as inplace, the stage-
counted research workaround as ranged, and the saved layered algorithm as
original. Production loads the actual delivered demo. Diagnostic runs add diag
as a fourth argument and are separate from ordinary timing samples.

[Raw delivery samples and diagnostics](baselines/2026-11-02-euler333-delivery.json).
