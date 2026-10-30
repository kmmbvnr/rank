# Euler 269 investigation, 2026-10-30

Issue #447 still lists `euler/269_integerroot_test.ra` as unfinished. It is the
next unfinished Euler problem by number after 268 (earlier numeric comparison
rows are already completed work). The initial investigation below changed neither the production demo nor the
compiler. The delivery section records the subsequently authorized demo change.

Runtime: main `4a8bca55`, Node v24.15.0, macOS arm64. TypeScript language and
interpreter build passed before measurement. Raw results, source/runtime hashes,
and 50 independent oracle comparisons are in
`baselines/2026-10-30-euler269-investigation.json`.

## Full default K=16

All variants assert the unchanged full answer **1311109198529286**. Fresh serial
processes, three rounds with rotated case order; medians below. Imports are
outside elapsed timing; parsing and execution are included. Diagnostics enabled.
Peak process RSS includes startup. No own builds/tests overlap these series.
Other host workloads were not controlled; do not compare directly with the old
15.6/17.0-second issue table or pool the separate series.

Final comparison:

| Variant | Reference s | Compiled s | Reference peak RSS MiB | Compiled peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 1.686 | 1.932 | 577 | 596 |
| Early root-product pruning + broadcasting + stored intermediates | 0.447 | 0.479 | 308 | 305 |
| Above + terminal quotient constraint | 0.420 | 0.451 | 292 | 311 |

Best prototype: **4.01x reference / 4.28x compiled**, median peak RSS down
**49% / 48%**. RSS is peak resident memory, not retained heap or a guarantee.

A preceding separate series isolates the larger steps:

| Variant | Reference s | Compiled s |
| --- | ---: | ---: |
| Original | 1.687 | 1.878 |
| Early root-product pruning | 0.959 | 1.058 |
| Pruning + stored intermediates, retaining digit loop | not measured | 0.753 |
| Pruning + broadcasting, retaining deferred intermediates | 0.504 | 0.623 |
| Pruning + broadcasting + stored intermediates | not measured | 0.474 |

## Why this works

The existing inclusion-exclusion DP is reasonable; enumerating 10^16 input
numbers is unnecessary. It generates the quotient coefficients of P=GQ from
the low end, packs the previous d coefficients into a key, and merges identical
states with sorting and a prefix sum. That algorithm remains in every prototype.

1. For nonzero last digit p0, the constant term of G is the product of the
   selected positive root magnitudes. It divides p0. Consequently a product
   above 9 cannot contribute. Only 21 of 511 root subsets survive. Check
   `(Rs reduce *) greater 9` before constructing G. This avoids not just the
   impossible states but also the unnecessary polynomial construction.
2. The original digit loop performs up to ten tiny array pipelines, filters and
   concatenations per DP step. Broadcast a digit column against the state row,
   flatten the candidate keys/counts/mask in the same digit-major order, and
   filter once. This removes an inner loop while keeping the array-oriented DP.
3. For these pure, bounded intermediate values, explicit stored `=` avoids plan
   construction/capture and repeated reader/setup work. This is an intentional
   demo choice, not permission to force arbitrary deferred bindings in the
   compiler. Individual eager-stage probes do not support attributing the
   entire benefit to one particular name.
4. Degree P < K and degree G = d imply degree Q < K-d. Enforce q_i=0 from
   i=K-d and run only K digit steps, instead of appending d zero digits and
   discovering the constraint later. This is valid also when d>=K: a nonzero
   polynomial with fewer digits cannot be divisible by such G.

A smaller packing base and eager polynomial-construction temporaries were also
probed, but not selected for the recommendation. Preserve existing Base/Off in
this change; changing coefficient bounds merits its own proof and tests.

## Interpreter and compiler findings

Original compiled diagnostics: no compiled ordinary/scalar-function loops;
371 numeric sorts, 16,850 compiled tensors and 4,087 tensor-map preparations.
The loop rejects deferred bindings; dynamic filtering/concatenation and merging
also require more than merely removing that guard. Correct error timing and
ordinary `=` boundaries must remain intact.

A single original CPU profile, including import/startup, sampled 2.180 s:
GC about 354 ms, tensor bindRun 69 ms, createOwned 65 ms, plan capture 46 ms,
execution advance 44 ms, derivedArray 43 ms, readArrayItem 38 ms, tensor invoke
32 ms. These are approximate self times, not isolated causal measurements.
The terminal prototype profile sampled 0.625 s including startup, GC about
37 ms. Both are `/tmp/rank269-{original,terminal}.cpuprofile` during this run.

The problem exposes general overhead in small tensor pipelines, array wrappers,
plan capture and allocation. However, current reference execution is already
slightly faster than compiled execution here, and the best prototype narrows
the absolute gap to about 31 ms. There is no demonstrated single compiler
correctness bug or safe one-line JIT fix. Recommend the compact demo rewrite
first; further generic runtime changes require isolated measurements and
regression checks beyond this investigation.

## Verification and reproduction

Independent exhaustive Horner evaluation of the decimal digit polynomial at
all candidate roots -9..0 for every positive n through 10^K, K=1..5: 50 checks
passed across both modes and five variants. This includes the original fixture
K=3 and K=5 goldens. Full default answer asserted on every timed run. Full
corpus/audits were not run; no production code or exclusion changed.

```sh
node benchmarks/euler269-investigation.mjs compiled original
node benchmarks/euler269-investigation.mjs reference broadcast-terminal
node benchmarks/euler269-verify.mjs
```

`RUNTIME=/absolute/path/to/out/index.js` selects an isolated runtime.
`VARIANTS=original,broadcast-terminal` narrows verification variants. Experimental
sources are generated from `experiments/euler269-original.ra`. The harness also
retains smaller probes (`pruned`, `early`, `eager`, `early-eager`, `early-up`,
`compact`, `broadcast`, `broadcast-eager`, and `broadcast-one-NAME`).


## Delivery on current main

The shipping demo applies root-product pruning before polynomial construction,
digit/state broadcasting, explicit stored intermediates and the terminal
quotient constraint. It also removes the now-unreachable appended-zero digit
branch. Existing Base/Off and all original fixture assertions are unchanged.
K=1 and K=2 fixture assertions cover divisor degrees greater than the available
polynomial degree. No compiler or audit-budget changes were needed.

A concurrent general Int32 optimization reached main as `c53c26b5`. Rebuilt
language/interpreter and repeated the original-versus-actual-shipping comparison
on that same runtime. Three fresh serial processes per case, rotated order;
separate from the historical prototype series above:

| Variant | Reference s | Compiled s | Reference peak RSS MiB | Compiled peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 1.758 | 1.923 | 567 | 564 |
| Actual shipping demo | 0.422 | 0.459 | 295 | 309 |

Median speedup **4.17x reference / 4.19x compiled**; peak RSS reduced about
48% / 45%. Every full run asserts Answer=1311109198529286. Timing excludes import
and includes parse/execution; diagnostics enabled. Other host workloads remain
uncontrolled. `delivery` in the JSON records raw samples and runtime hashes.

Validation: TypeScript build passed; targeted inferred-type and differential
checks for the main and fixture passed (4 checks, 3 fixture blocks including
the full default and new short inputs). Independent exhaustive K=1..5 oracle
verification passes for six variants in both modes (60 comparisons), including
actual shipping source. Full exhaustive audits were not run.

```sh
node benchmarks/euler269-investigation.mjs compiled shipping
node benchmarks/euler269-investigation.mjs reference shipping
VARIANTS=original,shipping node benchmarks/euler269-verify.mjs
npm test --workspace @arrrank/interpreter -- test/types.test.ts test/differential.test.ts -t euler/269_integerroot
```
