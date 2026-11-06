# Euler 739: native modular callback scans over stored arrays

Issue: https://github.com/kmmbvnr/rank/issues/543

Default inputs remain Length=100000000, Chunk=4194304, Prime=1000000007.
The answer remains `711399016`. The full-input Rank algorithm, two scans per
chunk, Fibonacci table construction and chunk size are unchanged. The speedup
comes from extending an existing declaration-proved runtime optimization to
compact stored arrays.

## Full-input measurements

Node v24.15.0; Apple M5 arm64 macOS and Intel i7-10750H x64 Linux with normal
CPU affinity. Each host has one baseline and three serial final runs in fresh
processes. Other machine load was not controlled; baseline variance was not
measured. All runs produced the same answer.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 95.88 | 24.90 / 26.22 / 27.06 | 3.66x | 1509.44 | 1080.25 |
| Intel | 231.68 | 59.10 / 56.02 / 57.88 | 4.00x | 1477.91 | 1104.70 |

Median peak RSS fell by 28.4% and 25.3%, respectively. RSS includes interpreter
startup, parsing and all table construction. Every final peak was below its
host's baseline. These ratios describe these measurements; the single baseline
per host does not establish a stable distribution.

The baseline snapshot is 54b83975. The runtime change is bd4e1f8f; correctness
coverage and the Length=1 fix are bbe37b85. The diagnostic fixture correction
is 24818f83. Integration with main a6ae09c5 is recorded by merge 8d603c61;
that integration adds an unrelated Euler 752 source change and no runtime
change. Raw data and derived medians are in `results/euler739/` and
`results/euler739/summary.json`. The original solution is frozen in
`fixtures/euler739-original.ra`.

## Profile and cause

A profile at Length=8000000, Chunk=262144 preserves a similar ratio of chunk
work to table preparation as the default input. The original profile sampled
`scalarCaptureKey`, scalar capture-type work, generic scan/result assembly,
array arithmetic and GC. These costs accompanied one scalar callback for each
scan step. Earlier Length=1000000 profiling used the same chunk size and
therefore weighted Fibonacci-table preparation more heavily; both diagnostic
runs are retained and neither is pooled into primary timings.

The existing compiler recognizes a pure, two-data-parameter, single-return
function such as `Left * Right mod Prime`. It already completed modular scans
of finite native ranges into Int32 storage. Euler 739 supplies completed arrays:
`Upper` and `Lower reverse`. Those inputs missed that range-only path and
entered `scanValues`, constructing argument arrays, consulting scalar capture
metadata and retaining boxed prefix results for every step.

`scanStoredModularCallback` reuses the existing private declaration recipe and
the existing exact modular multiplication. It borrows trusted compact integer
storage through linear native views, including offsets and negative strides.
Only complete rank-one arrays of at least 1024 cells qualify. Every result is
written directly to independent Int32 storage, avoiding per-step scalar entry,
argument allocation and BigInt prefix boxing.

The first state or seed remains unreduced. Subsequent inputs and the accumulator
are normalized modulo the captured modulus. The existing `stepOf` implements
exact modular addition or multiplication for this domain; the modulus must be
an integer in 1..2^30. Its multiplication uses a floating quotient estimate and
`Math.imul` to recover the exact low-word remainder, with one correction. No
new modular arithmetic approximation is introduced.

The original declaration and function-call identity remain the proof. Memoized
functions, unsupported bodies, wide storage/seeds and invalid moduli retain the
ordinary path. The first actual callback's return contract is checked with its
original arguments. Opaque host arrays are rejected before shape/element
probing; uniform native view checks remain in place. Scalar observers, disabled
compilation, inspection, demand budgets and arbitrary host polling retain
ordinary calls. Native cancellation checkpoints occur throughout the private
output pass; source storage is never modified.

The full golden test records 48 native modular callback scans. Both the old and
new implementations have one existing speculative Number-loop replay for wide
intermediates. That diagnostic is retained explicitly rather than claiming the
whole program runs in one Number loop.

## Isolated scan and control measurements

`experiments/euler739-scan.mjs` runs the identical user function over 1048576
stored Int32 inputs on each runtime. Setup precedes timing; source execution is
timed and every prefix is independently verified with BigInt after timing.
Each entry is the median of three fresh processes, paired baseline then final.

| Callback | Mac baseline / final ms | Intel baseline / final ms |
| --- | ---: | ---: |
| `(Acc * Value) mod Mod` | 450.83 / 91.27 | 1172.94 / 209.31 |
| `(Acc + Value) mod Mod` | 578.33 / 93.77 | 1163.69 / 214.11 |
| `Acc + Value`, ordinary callback control | 349.69 / 297.37 | 725.51 / 736.16 |

The product kernel is 4.94x faster on Mac and 5.60x on Intel. Product-scan median
peak RSS fell from 294.00 to 146.06 MiB on Mac and 272.24 to 136.63 MiB on Intel.
The ordinary callback control remains on its prior scalar path; its observed
Intel median differs by +1.5%. Raw controls and all samples are retained, with
no statistical zero-overhead claim.

## Correctness and verification

Independent problem tests literally generate the Lucas start and repeatedly
discard its first item and compute partial sums. They use no ballot weights,
ratio inverses or Fibonacci doubling. Twenty-six cases cover both compilation
modes, lengths through 60, several chunk sizes (including one), partial chunks
and a smaller valid prime. Published examples f(8)=2663 and f(20)=742296999 are
checked against https://projecteuler.net/problem=739.

This oracle also found an existing Length=1 bug: the source returned zero
because the weighted-sum loop was empty. It now returns the unchanged single
Lucas term, one. This correction does not affect the full-input measurements.

- 196 focused tests passed on Mac after integration, and the same 196 tests
  passed on Intel through the package test runner.
- Tests cover every signed boundary prefix against BigInt, both operations,
  moduli 1, 17, 1000000007 and 2^30, unreduced seeds, reversed offset views, unsupported
  moduli, disabled capabilities, observers, opaque read order, cancellation,
  demand budgets, retry and independent deferred snapshots with captured modulus.
- The full default compiled golden test passed in 26.94 seconds, asserting the
  answer, 48 native scans and the existing single speculative replay. It is
  separate from the primary timing series.
- TypeScript build, semantic boundaries (65 owners) and application-form checks
  passed. No exhaustive audits or full workspace test suite were run.

Logs are stored alongside the timings. The source's numerical algorithm was
not changed to achieve the acceptance criteria.

## Reproduction

Build outputs before measuring:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler739.mjs
node benchmarks/euler739.mjs 8000000 262144
node benchmarks/euler739.mjs 20 7 reference
PROFILE=/tmp/euler739.cpuprofile DIAGNOSTICS=1 node benchmarks/euler739.mjs 8000000 262144
node benchmarks/experiments/euler739-scan.mjs
MODE=sum node benchmarks/experiments/euler739-scan.mjs
MODE=control node benchmarks/experiments/euler739-scan.mjs
REVERSE=1 node benchmarks/experiments/euler739-scan.mjs
```

`RANK_ROOT` selects another built snapshot, and `RANK_SOURCE` selects a source
fixture. Use the frozen original source and baseline runtime for the baseline;
keep profiling and diagnostics separate from primary timings.
