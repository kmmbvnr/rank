# Euler 393: row-profile symmetries and reference entry overhead

Investigation at `9c86a262`, Node v24.15.0, Apple M5 and Intel
Core i7-10750H. The historical investigation below predates the delivery described next.
The experiments preserve the exact answer `112398351350823112`.

The next unfinished ascending case in #447 is `393_ants.ra`. Euler 150
already has checked investigation entries. The historical 393 inventory
records 96.2 s reference / 3.3 s compiled; current main is substantially
faster, so those old times are not an appropriate before baseline.


## Delivered change

Implemented on top of `fa18d253`, which also integrates the general execution
boundary improvements in `797a4391` and `004d2b63`. The demo canonicalizes
matching-layer exchange and horizontal reflection. The interpreter omits
scalar entry selector creation when that capability is immutably disabled;
definitions made under inspection retain their selectors. No polling,
ownership, exactness, budget or execution-lane rules changed.

Three fresh processes per mode on each machine, parse + execute, no profiler
or diagnostics. Historical original baseline at `9c86a262` versus delivered
code on integrated main:

| Machine / mode | Original | Delivered | Original RSS | Delivered RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.804 s | 0.369 s | 306 MiB | 268 MiB |
| Mac reference | 17.969 s | 4.544 s | 580 MiB | 487 MiB |
| Intel compiled | 2.416 s | 1.058 s | 287 MiB | 259 MiB |
| Intel reference | 64.456–70.317 s | 15.591 s | 552–559 MiB | 458 MiB |

Historical Intel reference has two samples; all delivered rows have three.
The before/after series span upstream changes, so they are overall results,
not attribution to this patch alone. Paired controls on integrated main,
using the same optimized demo and removing only the new selector guard:

| Reference | Old selector | Delivered | Old RSS | Delivered RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac | 5.395 s | 4.544 s | 484.2 MiB | 487.2 MiB |
| Intel | 18.897 s | 15.591 s | 456.6 MiB | 458.2 MiB |

The generic selector change improves time by about 16–17%, but is not a
memory optimization: median RSS is about 0.4–0.6% higher in these controls.
The earlier isolated Intel RSS increase did not recur on integrated main;
individual GC high-water marks remain variable. The complete change lowers
RSS relative to the original demo on both architectures.

Validation on the final integrated source:

- Mac: 264 tests in 12 focused files; Intel: 189 tests in eight files.
- Two scoped type/differential checks for `393_ants_test.ra` pass.
- 64 standalone original/prototype/delivered result comparisons pass, including
  independent ant enumeration on N=0..4 and exact N=5,6,8 checkpoints.
- Full N=10 answer is `112398351350823112` in both engines on both machines.
- New source regressions prove no argument-storage compilation proofs occur
  for disabled entries, and actual compiled container calls work after
  inspection, including functions defined under inspection.
- Main and test TypeScript builds, semantic boundaries and application forms
  pass. No full suite or exhaustive audits were run.

`baselines/2026-11-04-euler393-delivery.json` retains raw final samples and
validation metadata. One Mac control overlapped the small fixture audits and
was replaced by a clean fresh-process sample; both observations are recorded.
Final checks ran in an isolated worktree because another session temporarily
stashed this implementation in the shared checkout.

Reproduce the delivered code and its isolated reference control:

```sh
node benchmarks/euler393-investigation.mjs 10 compiled
node benchmarks/euler393-investigation.mjs 10 reference
ENTRY_CONTROL=1 node benchmarks/euler393-investigation.mjs 10 reference
node benchmarks/experiments/euler393-verify.mjs
```

The `EARLY_GUARD` loaders below reproduce historical research on `9c86a262`;
use `ENTRY_CONTROL` for the delivered runtime.

## Historical findings

The current algorithm is a row-frontier DP over two disjoint perfect
matchings of the bipartite grid. One matching describes black ants moving
to white squares; the other describes white ants moving to black squares.
An edge used in both would mean ants crossing each other and is rejected.
This models the [problem statement](https://projecteuler.net/problem=393).

The algorithm is suitable for N=10. Its redundant state orientations can
be removed without changing the recurrence:

- Exchanging the matching layers preserves all possible completions.
- Reflecting both masks horizontally also preserves completions.
- Normalize each outgoing state to the smallest of these four encodings,
  accumulating transition multiplicities into that representative.

This merges histories with equivalent futures; it does not divide the
answer by four. Empty incoming/outgoing states are fixed by the symmetries,
so the initial and terminal conditions remain unchanged. Precompute the
1024 mask reflections once, then use ordinary array reads in the helper.

The layer-only experiment needs three new scalar statements at the leaf.
The combined experiment also needs the small reflection lookup table.
Neither adds another traversal of the DP nor converts totals to Number.
The final answer exceeds the safe integer range of Number.

## Full-input measurements

Fresh processes, execution includes parsing and excludes module import.
Confirmation samples have neither diagnostics nor CPU profiling enabled.
Mac values are medians of three sequential samples. Intel compiled values
are medians of three; baseline reference has two samples and the candidate
reference is one sample. Memory is process peak RSS, including runtime.

| Machine / mode | Current | Prototype | Current RSS | Prototype RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.804 s | 0.376 s | 306 MiB | 269 MiB |
| Mac reference | 17.969 s | 5.380 s | 580 MiB | 485 MiB |
| Intel compiled | 2.416 s | 1.149 s | 287 MiB | 257 MiB |
| Intel reference | 64.456–70.317 s | 22.508 s | 552–559 MiB | 457 MiB |

The Mac layer-only compiled candidate is 0.533 s / 276 MiB.
The primary table isolates symmetry normalization with the stock interpreter.
Separate combined Mac samples with the dynamic early-entry guard are
0.396 s compiled / 5.037 s reference. The Intel combined static-selector
prototype takes 16.600 s reference / 537 MiB. That last single control is
faster but uses more peak RSS than symmetry alone (22.508 s / 457 MiB);
additional measurement is needed before claiming a memory-safe selector win.

Cached row profiles decrease from 9306 to 2474; cached transitions from
177830 to 42784. Diagnostic probes counted 1620502 index writes in the
original, 804731 for layer symmetry and 395661 for combined symmetries.
This demonstrates reduced state/cache work independently of timing noise.
Peak RSS does not decrease proportionately: execution frames, GC and the
interpreter remain significant, particularly in reference execution.

Raw completed samples, source hashes and sampling limitations are in
`baselines/2026-11-04-euler393-investigation.json`. An Intel baseline series
was deliberately stopped after two completed reference samples to prioritize
candidate checks; its interrupted sample is not counted as a completion.

## General interpreter opportunity

A reference CPU attribution probe put `prepareSetAdd` among the leading
frames, alongside expression evaluation, execution continuation and GC.
This probe is not a timing baseline.

`FunctionInvocation.scalarEntryForCaptures` checks `compiledEntryArgumentType`
for object arguments even when `compiler.scalars.entries` is disabled.
For set arguments this invokes detailed storage/property/method guards,
often twice per invocation. Reference recursion pays for proofs it cannot use.

Two research loaders explore removing this unnecessary work:

1. A dynamic capabilities check on every entry. Its three-sample original
   Mac reference median is 18.220 s versus 17.969 s baseline: no established
   benefit. Do not ship this based on the initial single faster probe.
2. Avoid constructing the selector when immutable entry capabilities are
   disabled at function definition, provided definition is outside inspection.
   Under inspection, retain the existing selector so later execution can
   select compiled capabilities. A later original-program control pair is
   22.548 s baseline / 16.449 s candidate; process RSS is about 600 MiB in
   both. This is promising but only one clean control pair under varying
   machine load, not a reliable percentage or a memory optimization.

The static probe passes the same result comparisons, plus checks of
inspection results and restoration of runtime compiler capabilities. It does
not establish that a function defined under inspection later enters a scalar
compiled kernel. Add focused source-level regressions for entry selection
and turbo/inspection transitions before delivering a production change.

The row helper and sparse integer update loops already compile. The outer
row orchestration creates new containers and keeps an index of indices/sets,
which is outside the current integer-only container proof. Compiling that
whole region would need broader container-domain proofs, not simply removal
of the guard. After symmetry reduction, this is a smaller priority than the
unnecessary disabled-tier reference work.

## Verification and reproduction

The verifier directly enumerates each ant's legal destinations for N=0..4,
rejecting occupied destinations and reversed edges. It uses neither row
masks nor matching layers. Expected counts are 1, 0, 2, 0, 88.

For original, layer-only and combined sources, both engines additionally
check N=5,6,8 against 0,207408,22902801416. That is 48 comparisons per loader
configuration. Full N=10 matches in both engines on both machines.
Existing `sparse-profile` and `compiler-capabilities` tests pass: 36 tests in
two files. No exhaustive audits or full suite were run.

```sh
# Build emitted modules before using research loaders.
node benchmarks/euler393-investigation.mjs 10 compiled
node benchmarks/euler393-investigation.mjs 10 reference
EARLY_GUARD=1 node benchmarks/euler393-investigation.mjs \
  10 compiled benchmarks/experiments/euler393-symmetry.ra
EARLY_GUARD=static node benchmarks/euler393-investigation.mjs \
  10 reference benchmarks/experiments/euler393-symmetry.ra
EARLY_GUARD=static node benchmarks/experiments/euler393-verify.mjs
```

The loaders assert the expected emitted source before modifying it in memory.
They are experiments, not changes to the installed compiler. The historical suggestion was combined symmetry normalization and a separately
verified disabled-entry selector fix; both are now implemented as described
in the delivery section.
