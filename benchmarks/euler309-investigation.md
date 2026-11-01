# Euler 309: Integer Ladders investigation

Baseline: `241708d2`, Node v24.15.0, 2026-11-01. The delivery below follows
the historical research and diagnostic prototypes retained in later sections.

## Delivered changes and verification

The production demo uses packed width groups: count, prefix scan, fill one
numeric height array, then read group offsets directly. The mathematical
Euclid enumeration and integral crossing-height test are unchanged.

General compiler/runtime changes:

- Numeric loop call slots carry a positive private-index safety proof only for
  audited callback-free, effect-free scalar native operations without host
  overrides. Binding identity is still checked on entry. Rank helpers, receiver
  effects, array callbacks and host calls retain the publishing backend.
- Initially empty trusted integer indices write in place and clear on Number
  overflow before exact replay. Nonempty indices retain the existing overlay.
  Aliases share one transaction; real errors/cancellation retain preceding stores.
  Native Map size/clear intrinsics avoid invoking host hooks during strategy
  selection or rollback. Existing inspection/polling guards remain in force.
- Integer tuple keys keep their exact encoding but use flat string construction
  and avoid temporary BigInts for safe Number coordinates.

Three fresh serial samples per case on each host, with the same Node version:

| Host / full compiled case | Wall median s | CPU median s | Peak RSS median MiB |
| --- | ---: | ---: | ---: |
| Apple M5, original before | 4.906 | 5.556 | 937.6 |
| Apple M5, original with runtime fix | 4.692 | 5.156 | 666.9 |
| Apple M5, production packed demo | 0.583 | 0.831 | 237.8 |
| Intel i7-10750H, original before | 9.781 | 11.562 | 917.2 |
| Intel i7-10750H, original with runtime fix | 6.462 | 7.234 | 649.6 |
| Intel i7-10750H, production packed demo | 1.148 | 1.524 | 230.2 |

Overall: 8.4x/8.5x median compiled improvement on Mac/Intel, about 75% less
peak RSS. On the unchanged original source, the general runtime fix reduces
RSS by 29% on both hosts; do not claim a clear Mac wall improvement because
its ranges overlap. Intel runtime-only wall ranges do not overlap in this series.
Full answer **210139** is checked on every full sample.

At Limit=100,000, reference before/production medians are Mac 3.518/3.318 s
and 522/428 MiB; Intel 10.749/9.588 s and 494/405 MiB. The Mac wall ranges
overlap; this is not a large reference speedup. Answer 18609 is checked.
The full reference budget exclusion stays; no exhaustive audits or full suite run.

The Mac was busy (load about 2.8–3.4). The Intel started nearly idle and ran
only one benchmark child at a time. An initial Mac timing round overlapping a
focused name-facts check was discarded, replaced by a serial round. Raw delivery
JSON records the accepted samples and host/load information. Timing preceded
one final guard-only hardening to use the intrinsic Map size getter; final
small, hook and full-golden smoke checks ran the shipped code on both hosts.

Validation:

- TypeScript workspace build passed.
- Nine focused ordinary files: **380 tests passed**.
- Source experiments: **180 checks passed**, including the production demo.
- Scoped Euler 309 type, differential and full-compiled tests: **3 passed**;
  main source remains reference-budget excluded. Name-facts fixture: **1 passed**.
- Final portable checks on **both Mac and Intel**: 56 independent small brute
  comparisons, 12 fixture assertions, 8 transaction differential comparisons and
  3 host size/clear-hook checks. Full compiled golden also passed on both.
- Semantic boundaries (65 owners), application forms and whitespace checks passed.

Reproduce after a build:

```sh
node benchmarks/experiments/euler309-delivery.mjs prepare /tmp/rank309-check
node benchmarks/experiments/euler309-delivery.mjs run /tmp/rank309-check
node benchmarks/experiments/euler309-delivery-verify.mjs
```

For another host, transfer the prepared before/after packages, sources and the
runner, replacing node_modules links with that host's dependencies. Delivery
baselines are `2026-11-01-euler309-delivery-{mac,intel}.json` and the corresponding
verification JSON. Historical prototype builders pin the changed modules to
`241708d2`; they do not remove guards from the production runtime.

## Findings

The mathematical enumeration is already reasonable. Primitive coprime,
opposite-parity Euclid parameters generate each right triangle once; multiples
provide the two possible width/height orientations. For heights a,b at a fixed
width, crossing height is a*b/(a+b). Counting unordered pairs with integral
crossing height implements the statement's strict x<y<Limit constraint.
See https://projecteuler.net/problem=309.

At Limit=1,000,000 there are 159,139 primitive triangles, 3,961,272 stored
heights, 394,068 width groups with at least two heights, and 61,023,819 candidate
pairs. The largest group has 337 heights. Answer: **210139**.
Products are below 10^12 on this input and exactly representable in Number.

The dominant avoidable cost is representation and execution, not finding a
completely different mathematical solution:

- Original `Data W I` uses a sparse `index` with composite integer keys for a
  dense grouped collection. Both major loops compile, but only the consumer
  uses speculative Number mode. Building the index remains in the exact loop.
- CPU profiling of the original compiled program highlights private index
  reads, resource-map writes, composite-key construction and GC. The consumer
  copies each group into Hs before pair enumeration.
- A packed representation uses counts, `Cnt scan + array` for group ends,
  a second triangle traversal to fill one flat numeric array, and direct group
  offsets in the pair loop. All three loops enter Number mode; index traffic
  and per-group copies disappear. It repeats generation but wins substantially.
- The copied-group packed variant also works and remains much faster than the
  original, but costs more than reading directly from the packed buffer.
- Opposite-parity N stepping did not improve the median over the straightforward
  packed variant. Its sample ranges overlap; no production recommendation.

## Repeated measurements

Three fresh serial processes per case, rotating case order; imports/startup
excluded, parsing and execution included. CPU is process user+system, RSS is
process maximum. Every full run checks 210139. The host was busy; these figures
are workload-specific, not stable cross-machine speedup promises.

| Mode / Limit | Variant | Median wall s | Median CPU s | Median peak RSS MiB |
| --- | --- | ---: | ---: | ---: |
| compiled / 1,000,000 | original index | 7.691 | 8.461 | 934.8 |
| compiled / 1,000,000 | packed, direct group reads | 0.499 | 0.693 | 228.8 |
| compiled / 1,000,000 | packed, copied groups | 0.615 | 0.860 | 245.8 |
| compiled / 1,000,000 | packed, parity stepping | 0.535 | 0.759 | 230.8 |
| compiled / 1,000,000 | packed, named range slices | 13.801 | 16.604 | 738.8 |
| reference / 100,000 | original index | 4.519 | 5.457 | 517.7 |
| reference / 100,000 | packed, direct group reads | 4.181 | 5.084 | 427.1 |

Full compiled ranges: original 5.492–9.192 s; packed 0.461–0.560 s.
That series has a 15.4x median wall improvement and 75.5% lower peak RSS.
Reference wall ranges overlap: original 4.397–5.289 s, packed 3.778–4.829 s.
Do not claim a clear reference speedup. Full reference results were not obtained:
preliminary long runs were stopped and discarded before the serial series.
At 100,000, both variants give 18609.

## General compiler opportunities

### Pure scalar natives beside private indices

`prepareNumberLoop` rejects every region combining `plan.containers` with
`plan.calls`. Here that includes the audited scalar `gcd` call. A diagnostic
copy of the runtime with only this guard removed enters two Number loops.
Three further alternating serial before/prototype measurements on the original
full demo gave:

| Original source backend | Wall s | CPU s | Peak RSS MiB |
| --- | ---: | ---: | ---: |
| current | 10.871 | 11.291 | 908.5 |
| guard removed, diagnostic only | 5.979 | 6.537 | 1052.7 |

Wall ranges overlap (current 6.967–11.643 s; prototype 5.733–7.675 s).
The overlay retains writes before publication, adding memory; this is still
much worse than packed groups. These are a separate series: do not mix medians
with the main table.

Removing the guard is **not** a production-safe change. Arbitrary callees may
observe or modify caller state hidden by private index transactions. A general
fix should distinguish trusted scalar native operations with no Rank callbacks,
no host function and no caller-state access, while retaining binding checks,
overflow replay and ordinary error publication. User helpers require their own
effect proof. No such compiler change is delivered by this investigation.

### Named range slices inside numeric loops

The compact `Hs = Data (Start till (Ends W))` spelling is correct, but its
consumer cannot lower to Number mode. An instrumented runtime reports
`loop:unsupported-op:till`, then the enclosing Data application/assignment.
The exact compiled loop publishes 394,068 small group arrays instead; the whole
program reports 394,072 typed-array publications versus 4 for packed direct reads.

Useful general follow-up: lower locally bound, read-only affine range slices
into numeric regions with offset/length/stride addressing. It must preserve
ordinary `=` snapshot semantics, bounds/error timing, aliases, escaping results
and overflow replay. Source mutation needs copying or a proven lifetime rule.
Avoid special-casing this Euler source or dropping semantic guards.

## Memory follow-up: retain Number speed without the large overlay peak

A further controlled series compares the unchanged original demo in four runtime
configurations. Three fresh serial processes, rotated order, full answer checked.
These medians supersede earlier exploratory figures for this memory comparison;
they do not replace the separate packed-source measurements.

| Original demo runtime | Wall s | CPU s | Peak RSS MiB |
| --- | ---: | ---: | ---: |
| current compiler admission / keys | 4.898 | 5.608 | 934.1 |
| current admission, flat key construction only | 4.394 | 4.728 | 700.7 |
| gcd admitted, existing overlay | 5.127 | 5.673 | 1052.6 |
| gcd admitted, flat keys + in-place rollback strategy | 3.653 | 4.061 | 615.1 |

The last row reduces peak RSS by **41.6%** against admitted gcd with the old
overlay, while reducing median wall time by **28.7%**. Those wall ranges do not
overlap in this final series (overlay 5.125–5.137 s; combined 3.634–3.673 s).
For key construction alone, wall ranges overlap; its 25.0% RSS reduction is the
clearer result. The host remains busy; these are Mac results, not Intel results.

Two independent mechanisms explain the improvement:

1. Integer tuple keys currently concatenate the `integers:` prefix with a joined
   suffix. Building the exact same encoded string via one final join reduces
   retained string storage. Safe Number coordinates can also skip a temporary
   BigInt conversion, retaining the exact decimal encoding; unsafe coordinates
   still go through BigInt. This does not shorten or change the key format.
2. The private overlay and the growing public Map coexist at publication.
   An experimental in-place transaction writes BigInts into the guarded Map.
   For a nonempty source, an undo journal restores old values and removes new
   keys on overflow. For an initially empty source, no per-key journal is needed:
   overflow clears it, while success and ordinary errors retain preceding writes.
   Arrays and scalar bindings retain their existing publication behavior.

The latter needs the same no-observer guarantees as speculative execution:
no observable host polling, callbacks or callee access to caller state. The gcd
admission change is still diagnostic-only. A simpler production design can use
in-place/clear rollback **only for initially empty indices** and retain the old
overlay for all nonempty indices; the full undo journal is not needed to obtain
this demo's improvement. Aliases must share the same transaction.

Exploratory alternatives (separate serial series): clearing the overlay only
at the end did not reduce the peak (1051 → 1051 MiB); deleting each published
entry made it worse (1165 MiB), consistent with extra Map resizing/allocation.
A general undo journal reached about 918–921 MiB; skipping the journal for an
initially empty source reached about 861 MiB before the key improvement.
Do not mix timings from these preliminary series with the final table.

A separate one-million-key microprobe, with explicit GC after construction,
isolates retained key storage. The existing construction retained 95.68 MiB;
flat-string construction alone retained 79.65 MiB. Avoiding temporary BigInts
alone retained 95.68 MiB. Combining both retained 79.65 MiB. Thus flat string
construction, rather than the temporary Number conversion, accounts for the
retained-memory saving in that probe. Synthetic results are explanatory,
not replacements for full-demo peak RSS.

Verification of the diagnostic runtimes: **80 existing focused tests**, including
index ownership, alias wrappers, insertion order, protected storage, host hooks,
partial errors, cancellation and overflow; **48 additional differential
comparisons** against reference and exact compiled execution for empty/nonempty
indices, repeated writes, multiple indices, aliases, gcd, arrays and errors;
**1734 exact encoded-key comparisons** including mixed Number/BigInt, negative
zero, wide integers, nonintegers, nonfinite values and text. All pass. These do
not establish safe admission of arbitrary callees; no production changes made.

Reproduction after building:

```sh
node benchmarks/experiments/euler309-index-memory.mjs final
node benchmarks/experiments/euler309-index-memory-verify.mjs
node benchmarks/experiments/euler309-key-memory.mjs
```

Other memory series: `initial`, `fresh`, `keys` in place of `final`.
The verifier runs only copies of the existing focused suites, using the normal
audit runner configuration. Raw results: `euler309-memory-*.json` and
`euler309-key-memory.json` under the same dated baselines directory.

## Verification and reproduction

`euler309-verify.mjs`: **148 checks** passed. Fourteen limits from 1 through
1,000 are checked against an independent brute oracle enumerating street widths
and ladder lengths and testing integer square roots, with no Euclid parameters.
All five source variants are checked in both engines (140 cases). The existing
four fixture assertions also pass in both engines (8 assertions).

`euler309-stats.mjs` independently runs the full enumeration in JavaScript,
checks 210139, and records workload sizes. This full cross-check shares the
Euclid algorithm; only the small brute oracle is mathematically independent.
Every full compiled sample additionally checks the same golden answer.
No production change, full suite or exhaustive audit was run.

After a normal TypeScript build:

```sh
node benchmarks/euler309-investigation.mjs compiled 1000000 original
node benchmarks/euler309-investigation.mjs compiled 1000000 packed
node benchmarks/experiments/euler309-samples.mjs
node benchmarks/experiments/euler309-verify.mjs
node benchmarks/experiments/euler309-stats.mjs
# Optional unsafe diagnostic runtime copy, never modifies production:
node benchmarks/experiments/euler309-call-prototype.mjs
```

Raw results are in `benchmarks/baselines/2026-11-01-euler309-*.json`.
The next concrete change should use packed groups in the demo, preserve the
full golden in compiled checks, and address general slice lowering separately
or alongside it with semantic regressions. Flat key construction is an independent general memory improvement. Safe native-call
admission plus empty-index rollback also helps programs that need an index, but
does not replace the packed representation advantage for this demo.
