# Euler 266: pseudo square root

Initially investigated on 2026-10-30 at `11973d1f`, as the next unfinished
numbered problem after Euler 264. The final implementation and verification
are recorded under Delivery below; the earlier experiment results are retained
for comparison.

The meet-in-the-middle algorithm is appropriate. The expensive part is its
implementation of predecessor queries: it sorts a combined table of divisor
values and query quotients, then reconstructs positions using tags, a prefix
sum, masks and gathers. A native `upperindex` query expresses the same operation
more directly. There is also a smaller, general runtime opportunity in numeric
comparison during fallback sorting.

## Initial full default measurements

Limit 190 means 42 primes, two arrays of 2,097,152 subset products, a 242-bit
total product and a 121-bit square-root bound. The largest product in A needs
96 bits and in B 147 bits. Number or Int64 storage cannot safely replace BigInt.

Node v24.15.0, macOS arm64. Each cell is the median of three fresh, serial Node
processes. Parse and execution are timed; module imports are excluded. A frozen
runtime built from committed `839a25d0` is used throughout; the demo source is
from `11973d1f`. No own tests/builds overlap the timed series. External host load
is uncontrolled. Raw samples and separate exploratory phase timings are in
[the baseline JSON](baselines/2026-10-30-euler266-investigation.json).

| Demo variant | Reference | Compiled | Compiled peak RSS |
| --- | ---: | ---: | ---: |
| Original combined sort | 7.706 s | 6.070 s | 1128 MiB |
| Native binary searches | 4.054 s | 4.082 s | 807 MiB |
| Sorted two-pointer walk | 8.904 s | 3.094 s | 589 MiB |

The historical minutes-long execution-budget exclusion is not reproduced on
this machine. Current reference overhead is modest for the existing program:
most work is already in native array operations, not interpreted scalar loops.
The experimental two-pointer loop compiles to one exact integer region; it is
faster compiled but slower reference. It also makes the demo longer.

The binary-search version is the preferred demo change: retain the divisor
generation and `Sa = A sort`, add `use algo`, and replace everything from `NA`
through `Best` with:

```rank
Where = (Sa upperindex (Root // B)) - 1
Ok = Where at least 0
Pick' = Sa (Where filter Ok array)
Mate' = B filter Ok array
Best = (Pick * Mate) max
```

`upperindex` counts elements <= the query, so subtracting one gives the last
eligible divisor. The same mask keeps each selected divisor paired with its
original B value. This removes the combined-key sort, tags, prefix sum and
inverse permutation. It improves reference by 1.90x and compiled by 1.49x;
compiled peak RSS falls by about 28%. It adds no search loop to the demo.

## Initial general runtime prototype

BigInt values outside Int64 range fall back from numeric sorting to generic
`sortValue` / `stableOrder`. `sortableKind` already validates the scalar kind,
but each numeric comparison still calls `compareOrderedValues`, which allocates
a `WeakMap` for recursive record cycle detection and rechecks scalar kinds.
That work is unnecessary for these already validated numeric arrays.

A temporary runtime copy uses direct relational comparisons for numeric keys in
these two sort paths. BigInt precision, stable tie indices, direction and
interrupt polling are retained. The exact generated-JS experiment is in
[the patch](experiments/euler266-numeric-sort.patch); production TS is untouched.

| Demo variant with numeric comparator prototype | Reference | Compiled |
| --- | ---: | ---: |
| Original | 6.919 s | 5.426 s |
| Native binary searches | 3.792 s | 3.747 s |
| Two-pointer walk | not measured | 2.427 s |

For the original this reduces measured time by about 10-11%. Combined with the
compact binary-search rewrite, reference improves 2.03x and compiled 1.62x
against the original baseline. Sorting changes alone do not reduce retained
arrays; RSS samples do not establish a memory benefit for that runtime change.

This is a promising general runtime change, not an identified missing compiler
construct. The delivery checks below cover wide positive/negative integers, mixed
integer/real keys, ties and stable permutations, descending order, errors,
interrupts and nonnumeric fallback behavior. The explicit-plan demo test
originally listed the old scratch bindings; the delivery updates its stored/deferred assertions for the new source.

## Correctness and reproduction

Every one of the 33 timed full runs asserts Answer `1096883702440585` and all
return exact Best `2323218950659046189161096883702440585`. An independent
exhaustive subset oracle checks exact Best for limits 3, 5, 10, 20, 30, 40 and
50, across all three demo variants and both engines: 42 checks on the base
runtime and 42 on the comparator prototype. This includes all three fixture
inputs (20, 30, 40). No independent exhaustive full-size oracle or broad test
suite was run. At that investigation stage no production code, golden answers, fixtures,
audit exclusions or timeouts had changed.

```sh
node benchmarks/euler266-investigation.mjs compiled 190 original
node benchmarks/euler266-investigation.mjs reference 190 search
node benchmarks/euler266-investigation.mjs compiled 190 walk
node benchmarks/euler266-verify.mjs
```

The harness defaults to workspace `out/`. Set `RUNTIME` to an absolute
interpreter `out/index.js` to reproduce with a separately built runtime. To
try the sort prototype, copy interpreter `out/` to a temporary directory, make
its package dependencies available, apply the patch there with `patch -p1`,
and set `RUNTIME` to that copy. The patch targets generated JS for this
experiment; a production fix belongs in TypeScript and needs focused tests.

## Delivery

Implemented on top of `3c5fb2fd`:

- `sequence-order.ts` selects one comparator after scalar kind validation.
  Numeric fallback sorting uses exact relational comparisons, avoiding repeated
  kind checks and record-cycle `WeakMap` allocations. Generic nonnumeric
  comparison, stable ties, sort direction and cooperative polling remain.
- Euler 266 uses native `upperindex` for predecessor queries. The extra combined
  sort and tag/prefix/permutation pipeline are removed. `Pick` and `Mate` stay
  explicitly deferred; `Where` and `Ok` are stored. The default is unchanged.
- Fixture comments no longer claim a minute-long default. Assertions are
  unchanged. Explicit-plan expectations describe the new source.

Final measurements use fresh copies built from the current committed source,
so they include the newer unrelated bitwise runtime changes. Base and final
runtime JS differ only in `modules/sequence-order.js`. Three fresh serial
processes per cell, rotated order, no overlapping own builds/tests; external
host load is uncontrolled. These samples supersede the initial series for
shipping claims. Fingerprints and all 18 raw samples are in `delivery` in the
baseline JSON.

| Source / runtime | Reference | Compiled | Reference / compiled peak RSS |
| --- | ---: | ---: | ---: |
| Original / before | 7.688 s | 6.183 s | 1194 / 1140 MiB |
| Original / final comparator | 6.983 s | 5.420 s | 1183 / 1124 MiB |
| Shipping demo / final comparator | 3.783 s | 3.765 s | 813 / 816 MiB |

Overall speedup is 2.03x reference and 1.64x compiled. The comparator alone
reduces original-source time by about 9.2% / 12.3%. Peak RSS falls about
31.9% / 28.4% for the combined change; no separate comparator memory benefit
is claimed. Later individual samples were slower, so use the raw ranges when
assessing small differences.

Verification:

- Workspace language/interpreter build and clean frozen-source builds passed.
- Semantic boundary checks passed: 11 checks and 65 owners.
- Eight focused suites: 311 checks passed. Coverage includes signed arbitrary
  precision keys and adjacent values at 2^150, stable ties, ascending/descending
  sort and argsort, source preservation, mixed numeric comparator inputs,
  existing NaN/signed-zero behavior, records/text/errors, cancellation and
  explicit stored/deferred bindings.
- Scoped type and differential suites: two selected fixture checks passed,
  covering all three fixture inputs in both engines. The main remains excluded
  by the existing execution-budget list; this is not a full-main corpus audit.
- The independent exhaustive oracle passed 56 checks on the final runtime:
  seven small limits, both engines, and original/search/walk/actual shipping
  source. Actual shipping source is read from the demo, not reconstructed.
- All 18 full timed runs assert exact Best
  `2323218950659046189161096883702440585` and Answer `1096883702440585`.
- Broad exhaustive audits and full `npm test` were not run. Inputs, golden
  assertions, audit lanes, exclusions and timeouts are unchanged.
