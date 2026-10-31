# Disjoint slice operands in Number regions

Compiler improvement following the Euler 292 investigation. The local
experiment below freezes baseline modules at `220d12bc`. The streaming form
is now used in the demo; see [delivery results](euler292-investigation.md#delivery).
Measurements: macOS arm64, Node v24.15.0, three fresh-process samples per case,
serial alternating case order. Parsing/JIT are included, imports excluded.
External host load is uncontrolled. Child-process transpilation prevents the
baseline loader from retaining TypeScript's compiler heap in timed processes.

## Which copies can disappear

The original slice prototype binds `Old = Dp`, then processes all perimeters
for each edge multiple. Reading updated Dp instead of that old state would
reuse the same direction and change the answer. A logically distinct old
version is required by that source. The compiler cannot simply alias it to
one mutable buffer. More elaborate versioned storage could reduce physical
copying, but is not part of this change.

A streaming slice formulation keeps perimeter descending and edge multiples
inside that pass, selecting the Y coordinates as strided slices. Every source
has a smaller perimeter, so it has not yet been updated for the current
direction. This source needs no `Old` table. The meaningful digon counter is
updated at the end of the direction, giving the region a scalar result after
its slice writes. Ordinary alias/snapshot language semantics are preserved.

This exposed two general compiler limitations, now fixed locally:

* Number slices always allocated the complete RHS operand snapshot, even for
  different numeric buffers or provably disjoint arithmetic selections.
* Any source written in the region blocked Number compilation because a slice
  assignment returns a live RHS selection. That restriction is now retained
  for escaping results, but not for results overwritten inside the same region.

The emitted kernel tests non-overlap after validating both selections and
matching shapes. Distinct buffers qualify. Within one buffer, disjoint bounding
intervals qualify, as do equal-absolute-stride selections with different
residues (such as alternating columns). Unknown shared-buffer views and possible
overlap keep the complete snapshot. Scalar widening can replace the destination
buffer without invalidating borrowed disjoint source cells.

The selected operand buffer, start and stride are chosen once before the inner
loop; a cursor advances through that buffer. An earlier experiment chose the
buffer with a conditional on every element, which slowed the old snapshot
prototype by about 28%. The cursor version removes that observed regression.

Result-discard proofs stop at the actual loop region, and require the region
to be an ancestor. Later source statements executed by the caller do not count.
Function prefixes exclude the final return, so their final compiled statement
is used as a conservative boundary. Retained mutable live slice results still
use the publishing backend. Source-name tracking for named-row validation is
separate and remains active even when the result is discarded.

## Final measurements

| Compiled workload | Before | After | Before/after peak RSS |
| --- | ---: | ---: | ---: |
| Same streaming source, N=60 | 1416 ms | 186 ms | 900 / 193 MiB |
| Original snapshot source, N=120 | 659 ms | 660 ms | 361 / 276 MiB |
| Euler 290, full default | 179 ms | 163 ms | 198 / 187 MiB |
| Streaming source, N=120 | not timed in this series | 361 ms | — / 222 MiB |
| Compact scalar source, N=120 | not timed in this series | 348 ms | — / 207 MiB |

The full streaming golden remains `3600060866`. Its final diagnostic run
reports two Number regions, zero `numberLoopSliceCopies`, zero
`numberLoopSliceCopyCells`, 11,616,448 `numberLoopSliceDirectCells` and zero
ordinary COW copies. The baseline same-source N=60 run has one Number region
plus an exact DP region, with 140,957 native slice writes over 660,832 cells.
The improved DP is one whole Number region rather than those exact slice calls.

This does **not** eliminate the invocation-private destination copy used for
Number overflow replay. That one working buffer and its publication policy
remain. Copy-admission thresholds, deferred-binding rules and live-result
contracts are unchanged. Whole-process RSS is not retained DP storage.

The reference interpreter is unchanged: an exploratory N=60 streaming run
was 1.62 s. No new full N=120 reference timing is claimed here. The compact
scalar source is cheaper in reference execution. Delivery selects the array-slice
form to retain array operations and exercise the now-competitive compiled path.

## Verification

* TypeScript build passed.
* 23 focused interpreter files: 1104 tests passed, local `--testTimeout 15000`.
* Language result-discard tests: 20 passed.
* Full compiled Euler 289, 290 and 291 golden checks passed.
* Streaming prototype: 68 independent oracle comparisons (34 per engine),
  including odd limits, zero and multiple primitive edge lengths.
* Focused coverage includes disjoint and overlapping selections, both stride
  directions, differing strides, source borrowing during Int32 widening,
  ordinary errors and overflow replay, live returned operands, source writes,
  nested function prefixes, continue/break, and compilation boundaries.

The new slice diagnostic counters count selected cells using each attempted
path; cancellation/overflow can prevent completing all of those stores.
Full suites and exhaustive audits were not run. The measurements in this
section describe the local experiment before delivery.

```sh
./node_modules/.bin/tsc -b packages/language packages/interpreter
python3 benchmarks/euler292-slice-series.py 3
python3 benchmarks/euler292-verify.py streamed
DIAGNOSTICS=1 node benchmarks/euler292-investigation.mjs compiled streamed 120
```

Raw initial/final series, diagnostics, source hashes and oracle results:
`baselines/2026-10-31-euler292-slice-compiler.json`.
