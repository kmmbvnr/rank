# Speculative storage and rollback selection

Issue: #513. Baseline: `004d2b637018fd135b474f5dd8fea7be4b94f612`.
This follow-up uses the current interpreter after #509–#512. The historical
[prototype report](loop-storage-prototypes-results.md), its raw observations and
installers are preserved alongside it. Those results used `1d4edd41`; they must
not be presented as measurements of today's runtime.

## Decision and selection rules

Retain the production strategy. There is evidence for specialized sparse and
late-overflow cases, but not for replacing the contiguous path or introducing a
size-only selector. The experiments below are executable hypotheses in isolated
copies of built JS. Production changes only document the direct-write proof
obligation; no new experimental backend or thresholds are enabled.

The existing selector already separates semantic admission from cost:

| Facts available at entry | Current action |
| --- | --- |
| Effects, observable polling, contracts, alias/storage requirements not proved | Use the existing publishing backend |
| Safe read-only packed storage | Borrow cells with the existing guards |
| Mutable speculative destination | Private contiguous numeric copy, dirty tracking, publication on success or ordinary error |
| Up to 64 copy cells | Small-copy path |
| Larger unamortized destination, at most 262144 cells | Bounded copy probe and exact-work feedback |
| Full range/vector/nested work proved to pay for copying | Existing amortized path |
| Unproved work above the copy cap | Keep exact execution; do not make a speculative whole-buffer copy |
| Overflow or a representation guard fails during speculation | Discard the attempt and replay from original inputs through the existing mixed/exact backend |

The copy cap is a profitability choice, not a Number precision limit. Destination
size alone says nothing about density: a large sparse journal can be cheaper,
while the same representation is very expensive for a dense traversal. A few
successful sparse invocations do not prove the next invocation remains sparse.
A production selector would need guarded bounds or measured write footprint with
a safe response to phase changes, and measurements of the tracking overhead.
These experiments do not establish that selector's cost or threshold.

Checkpoint selection additionally needs evidence that avoided replay pays for
checks, publication and repeated preparation. Repeated late overflow is a useful
signal; a long loop or unique destination alone is insufficient. A root-iteration
chunk limit is not a bound on the work of an arbitrarily large nested iteration.
The `nested-late-long` control makes that distinction executable.

## Direct writes and continuation

Uniqueness only answers who may observe writes. It does not restore entry values
if checked arithmetic, a wide load, shape/representation checks or allocation
limits later request exact replay. Even an unaliased array updated before a late
overflow would be updated twice if execution restarted over its mutated values.
Verification includes both unique and retained-alias versions of this case.

Direct writes are admissible only with a proof that every reachable exit needs no
replay, or a correct continuation/undo scheme carrying exact scalar and storage
state. Proofs about final results alone miss intermediate overflow. Existing exact
integer execution already writes directly with its ownership rules. The Number
index transaction is another established special case: a fresh empty index can
be cleared on rollback; a nonempty index uses an overlay. Neither proves that a
mutable numeric array can dispense with rollback.

No unsafe direct-array variant was enabled for timing. The historical scalar
promotion experiment demonstrates an operation-site continuation for a restricted
scalar arithmetic family; its early-overflow penalties and capability limits
remain relevant. It is not proof of array continuation or arbitrary deoptimization.

## Experimental capability and semantic checks

- **current:** unchanged baseline runtime, with diagnostics-only discarded-root
  iteration counting.
- **pages:** private 512-cell Float64 pages plus dirty bytes, copied on first store.
  Reads use checked accessors; untouched pages remain in the source. It bypasses
  the whole-buffer copy heuristic only for the audited scalar indexed ABI.
- **journal:** private `Map<index, number>` redo overlay; repeated stores replace an
  entry, reads consult the overlay first, publication visits changed entries.
  No original destination cells are copied eagerly. Map overhead is not estimated
  as zero bytes: it is not measured by the typed-buffer allocation counter.
- **checkpoint:** publishes completed chunks of 8192 outer iterations and carries
  the loop result across reentry. On overflow, the existing mixed/exact path resumes
  at the last published boundary. It retains the historical 262144-cell ceiling.
  For eligible regions it bypasses the copy-work gate to isolate chunk costs;
  short-call penalties therefore include forced numeric entry, not just checks.

Sparse variants exclude vector operations, local/rebound arrays, containers,
helper calls, callouts, return/yield and slice operations. Unsupported plans use
the original Number backend. Checkpoint regions require a conditional root without
control transfers, return/yield, calls/callouts, containers, vector traversal,
local arrays or predeclared wide scalars. These are research capability boundaries,
not workload-specific production exceptions. Generated-code replacements assert
unique anchors and are not an alternative compiler IR.

All variants preserve the original strategy whenever interrupts/budgets are
active. Validation found why this matters: choosing exact execution instead of
the original numeric path changed demand-budget consumption, and eliminating
preparation polls shifted atomic cancellation by one store. Delegation to the
original backend preserves the existing boundary and visible state. This is a
conservative scope restriction, not a claim that sparse/checkpoint cancellation
has been independently implemented.

Successful ordinary errors publish preceding stores. Overflow discards private
changes, including intermediate-overflow cases and late array writes. Alias,
multiple-destination, zero-iteration/result-carry, native callback, custom polling,
atomic cancellation and demand-budget controls compare complete formatted state,
outputs and errors against reference execution or the current observable contract.

## Measurement method and limits

Apple M5 and Intel i7-10750H, Node 24.15.0. Each timing observation uses a fresh
worker with an explicit GC before execution, three samples per case/variant;
job order reverses on alternate samples. Parsing, cold preparation and execution
are timed together; process startup, interpreter construction, final result
assertion and the post-execution GC are outside that time. Prototype sparse paths
also eagerly prepare an ordinary fallback, so their cold compilation cost includes
that code. These measurements do not isolate accessor cost from compilation.

There are 14 cases, four variants and three timing samples: 168 observations per
host. A separate one-sample series supplies 56 diagnostic observations per host;
its timing is not used for speed comparisons. Every completed timing/diagnostic
worker asserts the exact answer. This task's tests/builds were finished before
same-host timing. System-wide background load was not controlled. Three medians
can identify large regressions; small differences are not established gains.

Peak RSS is the whole-process high-water mark before the final GC, including
startup. Retained memory is the change in `heapUsed` and `arrayBuffers` after an
explicit GC while the interpreter and final variables are still alive, relative
to the pre-execution GC. It includes syntax, compiled code and results. It is not
peak allocation or a measurement of transient journal memory. V8 Map/closure
allocation is not included in the typed-buffer counters. The raw measurements
keep RSS, retained heap and retained ArrayBuffers separate.

Copy bytes below count private numeric snapshots and software-page initialization.
They exclude COW required by retained language aliases, publication, read-buffer
unboxing and native runtime allocations. Page copies use Float64 (8 bytes/cell);
the current compact snapshot uses Int32 where possible (4 bytes/cell). The journal
has zero *eager destination copy* bytes, not zero allocation. Diagnostics record
unboxed cells and allocated typed bytes separately where the runtime supports it.

`short` has 5000 one-store invocations over 72000 cells; `long` has three full
passes. `phase` changes from 100 one-store calls to 80 full passes. Sparse-local
and sparse-scatter each perform 32 × 4096 updates over 1048576 cells, touching
64 nearby or 256 distant cells per invocation. Sparse-many performs 2000 one-store
calls. Dense makes 32 full passes over 65536 cells; cold has 80 distinct one-store
loops. Scalar register/early cases have 2M iterations. Late-long has 20M, overflowing
near the end. Nested-late-long has the same total increment work inside only two
outer iterations. Euler 185 and 186 retain their original source and answers.

The historical study also measured tier-up, combined transfer and operation-site
promotion. Its negative results are retained, not rerun under new names here.
Current changes include compact Int32 snapshots and newer polling/admission
policies; comparisons across the historical and current absolute timings would
confound those changes and the measurement protocol.

## Results and implications

Pages reduce sparse-local elapsed time by 14% on Mac and 18% on Intel. The journal
reduces sparse-scatter time by 14% and 19%. However, pages make Euler 186 4.1×/3.4×
slower, and the journal makes it 6.2×/5.7× slower. The phase-change control is
2.2×/2.1× slower with pages and 3.3×/3.4× slower with the journal. These regressions
rule out a size-only sparse selector and support retaining the contiguous default.

The sparse gains above do **not** remove a baseline full-buffer copy: current
admission already keeps those large destinations exact. The prototypes instead
admit numeric execution using a private sparse representation. Cold distinct loops
do eliminate copying (20 MiB current versus 320 KiB pages or no eager journal
copy), but their timing gains are small/inconsistent across hosts. That evidence
supports further selective research, not a universal speed claim.

Checkpointing reduces late-long time from 262.0 to 138.7 ms on Mac and 588.4 to
310.0 ms on Intel (about 1.9×). It retains 19,996,672 completed iterations; only
3,326 entered iterations are discarded instead of 19,999,998. The exact suffix
has 3,328 iterations, including those needed to finish after overflow. Conversely,
short calls copy 1.44 GB cumulatively instead of 288 KB and take 2.4× as long on
both hosts. Nested-late-long still discards both outer iterations, with almost
20M increments inside them; it shows no useful speedup. No bound on arbitrary
nested replay follows from an 8192-outer-iteration chunk size.

Memory effects are separate from speed. Euler 186 journal RSS reaches 665 MiB
on Mac and 635 MiB on Intel, versus 228/200 MiB for current. Sparse-local RSS
falls on Mac but rises on Intel despite faster execution on both. Retained final
ArrayBuffers are generally unchanged because they hold the same program outputs;
transient journals have already been collected. The retained-heap tables capture
additional caches/code as well as output state, and show no universal reduction.
Zero eager-copy bytes must not be advertised as zero allocation or low peak RSS.

No measured alternative supplies a sufficiently general, validated selection rule
with bounded tracking/transition cost. The shipped choice therefore remains the
existing proof guards, contiguous storage and work feedback. The reproducible
specialized wins, regressions, polling restrictions and continuation limits are
recorded here for the next implementation, rather than encoded as benchmark-name
exceptions or unproved thresholds in `prepareNumberLoop`.

## Measured tables

### Mac: Execution time (ms)

| Case | Current | Pages | Journal | Checkpoint |
| --- | ---: | ---: | ---: | ---: |
| 185 | 557.64 | 1266.22 | 1018.10 | 554.39 |
| 186 | 265.43 | 1079.02 | 1636.98 | 278.09 |
| short | 124.46 | 132.88 | 121.55 | 300.62 |
| long | 92.55 | 100.75 | 106.48 | 90.86 |
| sparse-local | 114.50 | 98.42 | 100.43 | 115.27 |
| sparse-scatter | 117.13 | 122.60 | 100.44 | 118.41 |
| sparse-many | 109.78 | 117.21 | 111.44 | 109.83 |
| dense | 94.61 | 115.35 | 142.95 | 98.89 |
| cold | 138.85 | 129.26 | 131.26 | 135.79 |
| register | 85.96 | 84.95 | 88.02 | 88.57 |
| early | 91.70 | 93.30 | 90.72 | 91.30 |
| late-long | 261.98 | 259.67 | 269.21 | 138.69 |
| phase | 134.92 | 290.50 | 445.01 | 159.49 |
| nested-late-long | 206.08 | 205.03 | 206.39 | 210.01 |

### Mac: Peak RSS (MiB)

| Case | Current | Pages | Journal | Checkpoint |
| --- | ---: | ---: | ---: | ---: |
| 185 | 207.31 | 211.53 | 210.95 | 216.16 |
| 186 | 227.64 | 272.70 | 664.84 | 226.86 |
| short | 184.20 | 190.16 | 181.81 | 261.09 |
| long | 141.05 | 142.44 | 170.12 | 147.97 |
| sparse-local | 155.66 | 148.06 | 145.08 | 156.17 |
| sparse-scatter | 164.47 | 179.91 | 145.34 | 165.27 |
| sparse-many | 163.81 | 171.84 | 165.34 | 164.61 |
| dense | 139.80 | 141.05 | 144.36 | 141.56 |
| cold | 194.86 | 176.20 | 176.03 | 195.39 |
| register | 148.81 | 148.75 | 148.78 | 139.70 |
| early | 169.59 | 170.58 | 168.73 | 170.89 |
| late-long | 170.52 | 170.16 | 171.02 | 160.77 |
| phase | 172.70 | 181.86 | 314.95 | 241.38 |
| nested-late-long | 170.61 | 170.62 | 170.30 | 169.64 |

### Mac: Retained heap / ArrayBuffers (MiB)

| Case | Current | Pages | Journal | Checkpoint |
| --- | ---: | ---: | ---: | ---: |
| 185 | 25.42 / 0.13 | 25.54 / 0.13 | 25.51 / 0.13 | 25.54 / 0.13 |
| 186 | 11.48 / 30.52 | 11.56 / 46.80 | 11.53 / 30.52 | 11.43 / 30.52 |
| short | 8.30 / 0.27 | 8.25 / 5.04 | 8.23 / 0.27 | 5.37 / 0.27 |
| long | 7.25 / 0.27 | 7.31 / 0.46 | 7.29 / 0.27 | 7.33 / 0.27 |
| sparse-local | 7.90 / 4.00 | 7.98 / 4.00 | 7.96 / 4.00 | 7.93 / 4.00 |
| sparse-scatter | 8.41 / 4.00 | 8.42 / 15.43 | 8.46 / 4.00 | 8.41 / 4.00 |
| sparse-many | 8.48 / 4.00 | 8.51 / 4.48 | 8.50 / 4.00 | 8.48 / 4.00 |
| dense | 6.83 / 0.25 | 6.89 / 0.25 | 6.89 / 0.25 | 6.83 / 0.25 |
| cold | 13.27 / 0.25 | 13.74 / 0.25 | 13.72 / 0.25 | 13.40 / 0.25 |
| register | 5.75 / 0.00 | 5.79 / 0.00 | 5.76 / 0.00 | 5.87 / 0.00 |
| early | 5.79 / 0.00 | 5.83 / 0.00 | 5.83 / 0.00 | 5.94 / 0.00 |
| late-long | 5.83 / 0.00 | 5.83 / 0.00 | 5.84 / 0.00 | 5.98 / 0.00 |
| phase | 8.44 / 0.27 | 8.37 / 4.46 | 8.28 / 0.27 | 8.40 / 0.27 |
| nested-late-long | 6.36 / 0.00 | 6.38 / 0.00 | 6.38 / 0.00 | 6.37 / 0.00 |

### Intel: Execution time (ms)

| Case | Current | Pages | Journal | Checkpoint |
| --- | ---: | ---: | ---: | ---: |
| 185 | 1286.36 | 2548.77 | 2039.93 | 1259.91 |
| 186 | 647.82 | 2220.81 | 3678.41 | 635.10 |
| short | 359.67 | 383.17 | 344.03 | 849.38 |
| long | 250.33 | 249.17 | 271.81 | 252.82 |
| sparse-local | 317.68 | 261.79 | 274.00 | 311.97 |
| sparse-scatter | 315.18 | 317.99 | 255.55 | 297.50 |
| sparse-many | 292.37 | 317.75 | 290.17 | 314.04 |
| dense | 235.47 | 291.13 | 323.79 | 232.12 |
| cold | 355.75 | 347.78 | 357.31 | 345.73 |
| register | 211.51 | 212.88 | 210.80 | 217.26 |
| early | 223.41 | 235.78 | 240.40 | 227.49 |
| late-long | 588.39 | 583.07 | 601.19 | 309.95 |
| phase | 342.53 | 705.73 | 1160.79 | 390.76 |
| nested-late-long | 505.49 | 514.37 | 528.13 | 508.96 |

### Intel: Peak RSS (MiB)

| Case | Current | Pages | Journal | Checkpoint |
| --- | ---: | ---: | ---: | ---: |
| 185 | 203.54 | 222.07 | 204.78 | 227.99 |
| 186 | 199.74 | 271.06 | 635.00 | 200.49 |
| short | 170.82 | 168.01 | 169.92 | 228.71 |
| long | 128.94 | 129.86 | 163.15 | 130.16 |
| sparse-local | 129.12 | 135.12 | 135.11 | 128.52 |
| sparse-scatter | 131.94 | 180.64 | 143.24 | 132.95 |
| sparse-many | 147.80 | 135.75 | 135.02 | 149.00 |
| dense | 122.79 | 127.32 | 129.16 | 128.95 |
| cold | 182.20 | 147.30 | 129.97 | 156.61 |
| register | 129.60 | 138.14 | 129.55 | 123.29 |
| early | 128.84 | 154.98 | 130.03 | 130.08 |
| late-long | 122.25 | 130.80 | 153.64 | 129.22 |
| phase | 152.73 | 162.56 | 297.01 | 211.51 |
| nested-late-long | 129.18 | 155.79 | 154.18 | 129.61 |

### Intel: Retained heap / ArrayBuffers (MiB)

| Case | Current | Pages | Journal | Checkpoint |
| --- | ---: | ---: | ---: | ---: |
| 185 | 25.36 / 0.13 | 25.48 / 0.13 | 25.46 / 0.13 | 25.47 / 0.13 |
| 186 | 11.27 / 64.85 | 11.36 / 98.36 | 11.36 / 30.52 | 11.29 / 64.85 |
| short | 8.18 / 0.27 | 8.10 / 6.07 | 8.10 / 0.27 | 5.23 / 37.01 |
| long | 7.12 / 0.27 | 7.18 / 1.00 | 7.17 / 0.27 | 7.25 / 5.84 |
| sparse-local | 7.75 / 4.00 | 7.82 / 4.00 | 7.82 / 4.00 | 7.77 / 4.00 |
| sparse-scatter | 8.27 / 4.00 | 8.29 / 4.00 | 8.31 / 4.00 | 8.29 / 4.00 |
| sparse-many | 8.32 / 4.00 | 8.36 / 5.56 | 8.32 / 4.00 | 8.32 / 4.00 |
| dense | 6.73 / 0.25 | 6.79 / 0.25 | 6.78 / 0.25 | 6.73 / 0.25 |
| cold | 13.10 / 0.25 | 13.55 / 0.25 | 13.51 / 0.25 | 13.25 / 0.25 |
| register | 5.65 / 0.00 | 5.68 / 0.00 | 5.69 / 0.00 | 5.79 / 0.00 |
| early | 5.72 / 0.00 | 5.75 / 0.00 | 5.75 / 0.00 | 5.86 / 0.00 |
| late-long | 5.72 / 0.00 | 5.75 / 0.00 | 5.76 / 0.00 | 5.89 / 0.00 |
| phase | 8.27 / 0.27 | 8.23 / 2.08 | 8.13 / 0.27 | 7.36 / 0.27 |
| nested-late-long | 6.24 / 0.00 | 6.30 / 0.00 | 6.29 / 0.00 | 6.24 / 0.00 |

### Copy and replay counters

Same counts on both hosts (checked against all 56 paired diagnostic observations).
Copy values are bytes; replay counts are entered root iterations discarded on overflow.

| Case | Copy: current | Pages | Journal | Checkpoint | Replay: current → checkpoint |
| --- | ---: | ---: | ---: | ---: | ---: |
| 185 | 130400 | 70816 | 0 | 1956000 | 0 → 0 |
| 186 | 32000000 | 64000000 | 0 | 32000000 | 0 → 0 |
| short | 288000 | 20480000 | 0 | 1440000000 | 0 → 0 |
| long | 864000 | 1728000 | 0 | 7776000 | 0 → 0 |
| sparse-local | 0 | 131072 | 0 | 0 | 0 → 0 |
| sparse-scatter | 0 | 33554432 | 0 | 0 | 0 → 0 |
| sparse-many | 0 | 8192000 | 0 | 0 | 0 → 0 |
| dense | 262144 | 524288 | 0 | 262144 | 0 → 0 |
| cold | 20971520 | 327680 | 0 | 20971520 | 0 → 0 |
| register | 0 | 0 | 0 | 0 | 0 → 0 |
| early | 0 | 0 | 0 | 0 | 3 → 3 |
| late-long | 0 | 0 | 0 | 0 | 19999998 → 3326 |
| phase | 23040000 | 46489600 | 0 | 236160000 | 0 → 0 |
| nested-late-long | 0 | 0 | 0 | 0 | 2 → 2 |

## Verification and reproduction

On each host, 66 research scenarios × four variants pass (264 observations).
The ordinary baseline also passes 213 focused tests across six files on Mac and
Intel, covering arrays, aliases, packed integer storage, index/Fenwick transactions
and polling. TypeScript builds passed; semantic-boundary checks passed (11 tests,
65 owners), as did application-form checks. The only production source change is
a comment. Full suites and exhaustive type/differential/demo audits were not run.

The runtime JS and generated-language hashes match between hosts; manifests list
all executable-module digests. They identify the measured baseline and isolated
variants, not the comment-only rebuilt output. All timing and diagnostic workload
source hashes agree across variants and hosts.

Build baseline `004d2b63` in an isolated checkout with its locked dependencies,
generated language and TypeScript project output. From this checkout, install
experimental copies using that baseline root (never patch the baseline in place):

```sh
node --input-type=module -e \
  "import {prepare} from './benchmarks/experiments/speculative-storage.mjs'; \
  prepare('/path/to/baseline', '/tmp/rank-storage');"
node benchmarks/speculative-storage.mjs \
  --out=/tmp/rank-storage --verify=true > verification.json
node benchmarks/speculative-storage.mjs --out=/tmp/rank-storage \
  --samples=3 \
  --cases=185,186,short,long,sparse-local,sparse-scatter,sparse-many,dense,cold,register,early,late-long,phase,nested-late-long \
  > timing.json
node benchmarks/speculative-storage.mjs --out=/tmp/rank-storage \
  --samples=1 --diagnostics=true \
  --cases=185,186,short,long,sparse-local,sparse-scatter,sparse-many,dense,cold,register,early,late-long,phase,nested-late-long \
  > diagnostics.json
node benchmarks/experiments/storage-manifest.mjs \
  /path/to/baseline /tmp/rank-storage > manifest.json
```

Each timing worker uses `--expose-gc`. `--deadline` is a per-worker wall deadline
(default 120000 ms). A timeout is retained as a failure record rather than treated
as a speed result. None occurred in the final series. Custom `--chunk` values
require fresh installation and semantic verification.

Focused production checks, from `packages/interpreter`:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  --config ./scripts/type-audit.config.mjs --maxWorkers 4 \
  test/number-loop-index.test.ts test/number-loop-vectors.test.ts \
  test/number-loop-fenwick.test.ts test/number-loop-aliases.test.ts \
  test/number-loop-polling.test.ts test/integer32-storage.test.ts
```

Raw data: [Mac timings](results/speculative-storage/mac.json),
[Intel timings](results/speculative-storage/intel.json),
[Mac diagnostics](results/speculative-storage/mac-diagnostics.json),
[Intel diagnostics](results/speculative-storage/intel-diagnostics.json),
[Mac verification](results/speculative-storage/mac-verification.json),
[Intel verification](results/speculative-storage/intel-verification.json),
[Mac manifest](results/speculative-storage/mac-manifest.json),
[Intel manifest](results/speculative-storage/intel-manifest.json).
