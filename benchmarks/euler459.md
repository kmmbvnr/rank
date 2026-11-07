# Euler 459: Flipping Game

The full N=1000000 answer remains **3996390106631**. The existing algorithm
already reduced the board to two one-dimensional mex recurrences and a nim
product. Its roughly 1.6 billion position-length pairs dominate execution.
The issue's historical 24-second figure is not a fresh Mac baseline.

## Rank program

Each axis keeps the prefix XOR of its Grundy numbers. At position I, the
allowed lengths select earlier prefix values. The mex input is their XOR
with the preceding prefix; move nimbers use the new prefix instead.

The program now expresses those two stages as array operations within one
position loop. Sorted lengths use `upperindex` to choose the ready prefix,
without filtering the entire length array on every iteration. `Old` explicitly
copies the selected values once and supplies both scatter operations. Duplicate
histogram keys use the existing `.accumulate` contract. There are no nested Rank
loops and no new language syntax.

The arbitrary 512-bin bound is replaced by a bound from the move count. Mex
is at most that count, and XORs stay below the next power of two; twice the
number of available lengths plus two is sufficient. The final nim-product
matrix grows only to the highest observed key or final prefix, with a minimum
of two. Full defaults and the imported fixture assertions are preserved.

## General implementation changes

- Number loops now compile integer and real `.accumulate` scatters for
  `+=`, `-=` and `*=`. Selectors and RHS aliases retain their snapshots.
  Integer overflow replays with exact arithmetic; Int32 widening retains
  previous updates. Real updates reduce each key's operands first, preserving
  the existing rounding and signed-zero behavior. Ordinary compound assignment
  keeps its existing duplicate-key replacement semantics.
- Pure integer selectors can feed private scalar scatters directly, including
  bitwise selectors. Inline gather recipes and zero-origin unit ranges compose
  with their consumers, avoiding intermediate selector arrays. Named gather
  results still complete at ordinary assignment boundaries. Source buffers are
  pinned; destination aliases, callbacks, unsupported values and observable
  polling retain the ordinary path or exact replay.
- Proved Int32 vector operands use direct logical bitwise operations. Wide
  integers and shift-domain checks retain their existing paths. Native stored
  logical bitwise maps also write Int32 output directly, avoiding an Int64
  scratch result and a second narrowing pass.
- `first where` / `first index where` with a simple ready Int32 comparison can
  scan native storage without making a predicate mask or boxing every cell.
  This also helps compilation-disabled execution. The path requires standard
  comparison operators and plain owned storage. Lazy, foreign, shared, custom
  reader/operator, budgeted and inspected inputs keep ordinary demand behavior.
  Wide comparison targets are clamped outside Int32 without lossy conversion.

No compiler admission-size constants or public assignment semantics changed.
A final purity guard was narrowed after the Mac timing series: generated demo
kernels at N=1000 were byte-identical before/after, and a full compiled control
was repeated afterward. Intel final samples use that final guard throughout.

## Verification

Independent scalar mex recurrences check both move histograms and final prefix
words at sixteen small bounds on Number, exact compiled and reference backends.
Nim multiplication is checked through its defining mex, independently of the
program's field expansion. Complete board-state searches through N=4 provide
another check of the game reduction. Imported N=5/100/3000 assertions and the
full golden answer are retained; every benchmark process validates its answer.

2323 unique focused interpreter checks in 78 files passed on both Mac and Intel:
the broad run passed 2322, then one additional RHS-effect-order case passed in
a final 86-check rerun. Final clause guards were also rerun on both hosts.
Coverage includes duplicate writes, aliases, selector/RHS errors, real rounding,
signed zero, widening, exact overflow replay, budgets, gathers, tensor stages,
wide arithmetic, previous Euler fixes and operation/manual contracts.
Source/test TypeScript checks and semantic/application-form checks passed on
Mac. Exhaustive corpus audits were not run.

## Measurements

| Host | Workload | Variant | Seconds | Peak RSS MiB |
| --- | --- | --- | --- | --- |
| mac | compiled N=1m | before | 12.050 | 221.5 |
| mac | compiled N=1m | after | 9.248 | 211.8 |
| mac | reference N=10000 | before | 6.317 | 317.0 |
| mac | reference N=10000 | after | 0.946 | 496.9 |
| mac | same array source compiled N=10000 | before | 1.089 | 549.0 |
| mac | same array source compiled N=10000 | after | 0.181 | 184.7 |
| mac | reference N=1m (single) | after | 99.460 | 1544.2 |
| mac | compiled N=1m post-proof (single) | after | 9.197 | 211.6 |
| intel | compiled N=1m | before | 23.752 | 204.2 |
| intel | compiled N=1m | after | 20.390 | 200.9 |
| intel | reference N=10000 | before | 22.427 | 299.1 |
| intel | reference N=10000 | after | 3.777 | 466.6 |
| intel | same array source compiled N=10000 | before | 4.247 | 474.7 |
| intel | same array source compiled N=10000 | after | 0.462 | 171.1 |
| intel | reference N=1m (single) | after | 361.510 | 596.7 |

Full compiled elapsed time falls by 23.3% on Mac and 14.2% on Intel.
At N=10000, reference is 6.7x / 5.9x faster, with peak RSS increasing
by approximately 57% / 56%. The same-array-source compiler controls are
6.0x / 9.2x faster and use less RSS on both hosts. These smaller controls
do not predict the full-input speedup.

Manual JavaScript controls (single runs):

| Host | Loop style | Seconds | Peak RSS MiB |
| --- | --- | --- | --- |
| mac | scalar | 2.150 | 62.3 |
| mac | vector | 2.565 | 62.2 |
| intel | scalar | 5.835 | 64.0 |
| intel | vector | 6.078 | 64.3 |

[Raw measurements and ranges](baselines/2026-11-07-euler459.json) contain 39 accepted Rank samples and 4 JavaScript controls.

The baseline is the original source and runtime at b655ea93. `array-compiled`
compares the **same new array source** on the old/new runtime at N=10000,
isolating compiler support; it is not another full-input algorithm comparison.
`small-reference` compares old/new source and runtime at N=10000. The original
full reference workload was not rerun, so no full-reference speedup is claimed.

The raw artifact retains every accepted final sample and its range. Each paired
workload has three alternating fresh-process repetitions per variant, using
Node v24.15.0 on arm64 Mac and x64 Intel. Timing includes parsing, analysis and
execution, excluding process startup. RSS is process-lifetime peak and varies
with garbage collection. Foreign Node jobs are checked before and every second
during runs; Intel must be at least 98% idle with no active swap before each
sample. A contaminated preliminary run was discarded, and an interrupted
series resumed its accepted prefix rather than deleting earlier samples.
The comparison driver refuses a mismatched prefix.

Reference memory remains a limitation: this array representation accelerates
reference execution but increases its peak RSS. The native first-search and
Int32 bitwise paths reduce avoidable work, but do not eliminate transient array
allocation and collection costs. Moving histogram work into another pass was
slower compiled and did not resolve reference RSS, so that variant was rejected.
The full default remains in the manual audit lane; the small fixture and full
compiled golden test remain enabled. This is not a universal memory reduction.

The manual JavaScript controls use the same recurrence in scalar and staged
vector loops, with reused typed scratch storage. They omit Rank's dynamic
validation, snapshots, replay and parser costs, so they indicate remaining
optimization room rather than equivalent language implementations. They are
single diagnostic runs, not statistically matched speedup estimates.

Reproduce after building language and interpreter, from the repository root:

```sh
node benchmarks/euler459.mjs compiled
node benchmarks/euler459.mjs reference 10000
node benchmarks/euler459.mjs reference
node benchmarks/euler459-compare.mjs /path/to/built-b655ea93 /tmp/results.jsonl mac full-compiled
node benchmarks/euler459-native.mjs 1000000 scalar
node benchmarks/euler459-native.mjs 1000000 vector
```

The driver also accepts `intel`, enabling Linux vmstat admission checks, and
`small-reference`, `array-compiled`, `full-reference` or `post-proof` workloads.
Existing matching JSONL output resumes rather than being overwritten.
`RANK459_RUNTIME` selects a built interpreter entrypoint;
`RANK459_DIAGNOSTICS=false` disables counters. All samples retain source SHA-256.
