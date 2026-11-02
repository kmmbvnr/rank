# Euler 337: data lifetime and compact Fenwick storage

The selected compact helper is now implemented in the production demo. It
reuses Phi for prefix counts, halves the Fenwick tree and keeps array range
initialization. The existing compiler joins the helper's fresh arrays and
loops into one private Number region; no compiler implementation change was
needed. The sections below retain the original investigation and its controls.

## Current execution

The demo computes Euler's totient sieve and a Fenwick-tree DP through
20,000,000. The recurrence for N != 6 is
`V(N) = sum(V(J), J < N, phi(J) < phi(N)) - Prefix(phi(N))`, modulo 10^8;
V(6) = 1. The subtraction restricts predecessors to J > phi(N).
The answer is 85068035.

Both original loops already run in the Number backend. No overflow replay,
typed-storage unpack or CoW copy is recorded. The old 23-second measurement
in totient-stairs-results.md describes an earlier runtime and is not a current
baseline. Storage is now Int32 for these values, rather than the older report's
BigInt64/Float64 staging. Diagnostic CoW counters do not count all speculative
private buffers; zero CoW is not a claim of zero copying.

The sieve costs O(N log log N), the DP O(N log N), and storage O(N).
This is already a reasonable algorithm for the full input. There are useful
constant-factor and storage-lifetime improvements before replacing it.

## Exact reductions

1. Once the sieve finishes, consume Phi in increasing N. Since phi(N) < N,
   the current totient is read before that cell is overwritten with Prefix(N).
   Prefix(phi(N)) and Prefix(N-1) are already available in consumed cells.
   Reset Phi(1) to zero, guarded for Limit=0. This removes Pre completely.
2. phi(N) is even for N >= 3. The sole odd totient, at N=2, carries zero ways.
   Map totient T to T//2: query Q=T//2 and update I=T//2+1. The Fenwick tree
   needs Limit//2+2 cells instead of Limit+2. The strict phi comparison remains
   strict under this mapping for every nonzero contribution.
3. Each Fenwick cell and V are in [0,10^8). Their sum needs at most one
   conditional subtraction of 10^8. The general modulo for the query result
   remains, because that subtraction can produce negative values.
4. Put initialization, sieve and DP in an ordinary helper. Its fresh local
   arrays are admitted into one existing compiled function prefix, avoiding
   per-loop external-buffer snapshots and intermediate publication.

The selected prototype is experiments/euler337-private-range.ra. It retains
`Phi = 0 to Limit array`; manual initialization is unnecessary. The generated
single Number kernel includes rangeArray, createArray and all five loops.
The earlier scalar-function proof reports unsupported-op:to, but this does
not mean compilation failed: the function-prefix backend succeeds afterward.

Fusing sieve and DP into one interleaved outer pass is also correct: later
prime updates never touch consumed cells. It loses performance on both CPUs
and is not recommended. A manual initialization loop saves no useful memory
over the compact array expression and is also not selected.

## Full-size measurements

Node 24.15.0 on local arm64 Mac and remote x86_64 Intel. Serial fresh processes,
three samples per case; medians of execution time and process peak RSS.
Timing includes parsing and compilation, excludes imports/process startup.
RSS includes the runtime and is not retained-array size. Other machine activity
is uncontrolled; individual samples and discarded variants are retained.

The final Mac comparison was repeated from the exact isolated runtime snapshot
used on Intel: another session changed and rebuilt the shared workspace during
research. Those initial Mac exploratory rows below are retained as screening
results, not used to establish an exact compiler-only effect. Final isolated
Mac samples are 4.591–5.332 s before and 3.684–4.379 s after; the machine is busy.

| Variant | Mac seconds | Mac MiB | Intel seconds | Intel MiB |
| --- | ---: | ---: | ---: | ---: |
| Original, final isolated baseline | 5.249 | 580.3 | 10.364 | 582.3 |
| Original, initial Mac screening | 4.580 | 580.0 | — | — |
| Reuse Phi only | 4.657 | 503.6 | — | — |
| Reuse Phi + conditional subtraction | 3.921 | 517.5 | 8.533 | 507.7 |
| Interleaved sieve/DP + half tree + subtraction | 5.032 | 432.8 | 10.874 | 419.4 |
| Separate passes + half tree + subtraction | 3.535 | 512.8 | 7.550 | 446.1 |
| Same in helper, manual initialization | 3.706 | 278.5 | 7.401 | 281.0 |
| Same in helper, array range initialization, isolated | **3.688** | **276.0** | **7.375** | **278.9** |
| Direct JS, original recurrence | 1.536 | 280.3 | 4.401 | 284.4 |
| Direct JS, compact recurrence | 1.966 | 166.0 | 4.213 | 170.2 |

Selected Rank prototype: about 30% faster in the final Mac medians / 29% on
Intel; peak RSS about 52% lower on both. Mac timing is load-sensitive: initial
screening indicated about 20% improvement. The top-level compact version has less stable RSS,
consistent with private buffers surviving until GC. The helper is primarily
a memory improvement over that version; it is slightly slower on Mac.

The JS controls use the same integer sieve/Fenwick recurrences and Int32
arrays, but a handwritten loop body without Rank's guards, checkpoints,
publication and language runtime. They are controls, not an identical kernel
with one flag disabled. Compact Rank remains about 1.85x / 1.75x slower than
compact JS (about 1.88x on the final isolated Mac measurement). The JS control
and Rank runs were sampled at different times, so these ratios are approximate.
Both execution overhead and the chosen recurrence matter.

## Research verification

- Every full compiled measurement asserts 85068035 on both CPUs.
- The final full diagnostic confirms one Number kernel, five loops,
  30000003 published cells, zero overflow replays and zero typed unpacks.
- An independent oracle counts coprimes directly with gcd and enumerates
  all allowed predecessors. All 301 prefix cells through Limit=300 agree
  for ten prototypes in both engines: 6020 checked cells.
- Small boundary runs cover Limit=0,1,2,5,6,7,8,10,17,100,201 across initial
  variants; additional boundary runs cover the final variants.
- Existing checkpoints 10, 100, 10000 and 1000000 agree where sampled.
- Single reduced reference runs at 10000 do not establish a speedup; full
  reference was not run. No ordinary/exhaustive package suite was needed
  for this research, which changes no production code.

The delivered demo exposes Answer instead of the removed Pre table; the CLI
fixture now asserts Answer and covers empty input and the seed at 6. No new
compiler defect is established here. A general follow-up could extend private execution
across eligible top-level statements, but needs the same error-timing, aliasing
and observation guarantees as the existing function-prefix path.

Reproduce after building:

```sh
node benchmarks/euler337-investigation.mjs original compiled 20000000
node benchmarks/euler337-investigation.mjs private-range compiled 20000000
node benchmarks/euler337-investigation.mjs private-range compiled 10000 diag
node benchmarks/euler337-investigation.mjs private-range verify 300
node benchmarks/euler337-investigation.mjs private-range verify-reference 300
node benchmarks/experiments/euler337-native.mjs compact
```

Raw samples: baselines/2026-11-02-euler337-investigation.json.
Remote research files are isolated in /tmp/rank337-research, using the unchanged
runtime snapshot in /tmp/rank336-delivery; the intervening 372 commit modifies
no runtime implementation. The final Mac copy is /tmp/rank337-mac, extracted
from that same remote snapshot. Key runtime file hashes match on both hosts.

## Delivery verification

The actual production file was remeasured separately from the prototypes.
Each sample asserts the full answer. Three serial fresh-process samples per
variant and host, alternating original/production; Node 24.15.0:

| Host | Original seconds | Production seconds | Original peak MiB | Production peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 4.549 | 3.669 | 579.1 | 275.6 |
| Intel x86_64 | 10.248 | 7.408 | 583.2 | 279.2 |

The final demo is about 19% / 28% faster, with about 52% lower peak RSS.
Background machine activity remains uncontrolled. These are whole-process
peak RSS medians, not post-GC memory or per-array measurements.

Validation on an isolated source copy at a52e99eb plus these task files:

- Langium generation and `tsc -b tsconfig.build.json` pass.
- 277 focused tests pass in euler337, number-function-prefix, number-loop
  and loop-control (5 new Euler tests).
- All five CLI fixture assertions pass, including Limit=0 and Limit=6.
- All three exclusion-metadata checks pass.
- The final production program additionally matches all 301 independently
  computed prefix cells through 300, in both engines on both hosts.
- Both full diagnostic runs confirm one Number kernel containing five loops,
  30000003 published cells, zero overflow replays, CoW copies and typed unpacks.
- Full reference execution and exhaustive corpus audits were not run.

The full demo remains excluded from repeated uncompiled corpus execution:
its sieve and Fenwick traversals still visit hundreds of millions of cells.
Small CLI fixtures remain eligible; euler337.test.ts covers the full compiled
default. The exclusion reason now describes this coverage.

Mac delivery uses /tmp/rank337-delivery-local with private package links and
a fresh build, preserving unrelated shared-workspace changes. Intel delivery
uses /tmp/rank337-delivery with the existing isolated 336 runtime. SHA-256 of
number-loop-runtime.js, integer-loop-expressions.js and integer-loop-statements.js
matches between those runtimes. This delivery includes no compiler patch.

Final samples and verification metadata:
baselines/2026-11-02-euler337-delivery.json. The `production` harness variant
reads demos/euler/337_totientstairs.ra directly, without source rewriting for
timing runs.
