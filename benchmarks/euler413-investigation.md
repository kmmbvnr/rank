# Euler 413 investigation

Historical research snapshot. Implemented changes and authoritative delivery
measurements are in [euler413-followup.md](euler413-followup.md).

Base/runtime: f59b6b10, Apple M5 and remote Intel x86_64, Node v24.15.0.
Research only: no production demo, compiler, audit exclusions or timeouts changed.
Issue #447 still lists this task as deferred at a historical ~95 s compiled.
The current runtime is substantially faster already.

## Current bottleneck

The demo performs dynamic programming over capped suffix-remainder counts,
packed as ternary digits, plus a bit for the number of divisible substrings.
At each position it unpacks all states to an N-by-W matrix, permutes/merges
remainder rows, packs them again, builds ten digit transitions, sorts them
and sums counts for matching states.

Full default answer: 3079418648040719 in every completed experiment.
The original current compiled run publishes about 1.007 billion typed cells
across intermediate arrays, not simultaneously live. Peak RSS is much less
than their cumulative payload. There are 6073 compiled tensors but zero
compiled whole loops: array arithmetic does run native kernels; the complete
DP is not one compiled loop. Whole-loop rejection includes unsupported copy
and W operations and Dg input types. This is not purely interpreter dispatch.

A sampled CPU profile attributed about 23% to mapStoredInt32Binary, 8% to GC,
5% to radixOrder, plus gather, scan, broadcasting and generated kernels.
This is consistent with both repeated array passes and state merging costs.

## Measurements

Fresh processes, parsing included, startup/import excluded. Three original /
lookup pairs per host. On Mac the last initial pair overlapped another local
experiment; it is retained in raw results but excluded from the reported
medians and replaced by a subsequent pair. Other system activity is not
controlled. Peak RSS is a process maximum, not retained heap.

| Host | Original compiled | Lookup compiled | Original RSS | Lookup RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac | 8.683 s | 5.524 s | 1623.9 MiB | 1267.1 MiB |
| Intel | 22.090 s | 14.625 s | 1156.3 MiB | 817.5 MiB |

Single reference runs: Mac original 19.628 s, lookup 6.715 s;
Intel lookup 17.671 s (original reference not measured on Intel).

The lookup prototype retains the DP. For gcd(N,10)=1 the remainder mapping
R -> 10 R mod N is a permutation. Split each ternary key into two halves;
precompute their permuted contributions and add two gathers. This avoids
unpacking every state to an N-by-W matrix. At N=19 the tables have only
19683 and 59049 entries. No ternary carries occur because the mapped digits
are disjoint. Non-coprime lengths retain the original capped row merging.
The experimental source needs refactoring before production: it adds a
branch and several setup variables, and retains the original nested loops.

Additional single Mac experiments:

| Variant | Compiled time | RSS | Finding |
| --- | ---: | ---: | --- |
| Select valid states before constructing next keys | 8.637 s | 1570.7 MiB | No useful speedup |
| Skip final state construction/merge | 8.221 s | 1702.5 MiB | No clear benefit |
| Lookup plus skip final merge | 5.292 s | 1280.4 MiB | Marginal against lookup; not established |
| Lazy quotient before mod-3 unpack | 8.328 s | 1248.3 MiB | Lower observed peak, no speed improvement |
| Lazy next-key expressions through gather | 39.327 s | 1353.3 MiB | Reject this form with current compiler |

The failed first lazy experiment froze mutable Z through plan Nw; it was
corrected to a separately computed Extra and nonmutating Z assignment.
Only the corrected version has the timing above. Explicit plan ownership
rules were retained.

## General compiler/runtime opportunity

The tensor IR has a select node, but binding a numeric vector gather requires
`a.view` and a one-dimensional source in jit/tensor-kernel.ts. Thus an
irregular gather of a computed expression cannot simply propagate its index
into that producer. Lazy next-key expressions consequently execute many
individual cells: the experiment reports 301 million computed cells and
binding/scalar-timing fallbacks. Merely adding apostrophes is not sufficient.

Useful general work would compile a computed producer together with its
index/filter consumer, and eventually feed the resulting keys and weights
into a sparse group accumulator. Preserve demand-time errors, index checks,
empty selections, cancellation/budgets and explicit eager binding boundaries.
Do not remove deferred-binding or scalar-timing guards without equivalent
proof. Existing `sum by` uses dense nonnegative result indices; it is not a
safe replacement for these sparse keys (up to ~2.3 billion at N=19).

A manual JS control uses the same capped-remainder DP, the same lookup and
fused per-state digit transitions, accumulating directly in Map. It visits
41,461,111 digit transitions and up to 529,949 states. Single runs:
Mac 3.425 s / 323.4 MiB; Intel 3.779 s / 298.2 MiB. This is an opportunity
bound for a combined implementation, not a measured compiler patch or a
promise that one fusion change achieves the whole difference. The control
uses safe JS integer counts and asserts that stored counts and the final
total remain safe. Rank must retain exact fallback for wider inputs.

## Verification and reproduction

- 48 comparisons: original and lookup sources, both engines, Digits=0..11.
- Independent decimal-substring brute force for lengths 1..5; cumulative
  counts 9, 29, 389, 3090, 7186. Also checked existing 7/11-digit expectations.
- Existing 413_onechild_test.ra passed scoped differential (two test blocks).
- Full-default original/lookup answers agree on both architectures;
  full-default lookup also agrees in both engines.
- No full suite or exhaustive audit started.

Run `node benchmarks/euler413-investigation.mjs compiled 19 original` or
`lookup`; replace compiled with reference for that engine. Other variants:
select-first, final, lookup-final, lazy, lazy-select. Export a generated
source by setting RANK413_SOURCE to a scratch path. Run the independent
verification with `node benchmarks/experiments/euler413-verify.mjs` and
manual JS with `node benchmarks/experiments/euler413-native.mjs 19`.

Raw measurements: baselines/2026-11-05-euler413-investigation.json.
