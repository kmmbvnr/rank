# Euler 166: numeric counters, compiled consumers and complementary sums

Measured on Apple M5 / Node v24.15.0, 2026-10-26, based on `1264d10b`.
Three serial fresh-process samples per timed variant, alternating variant order.
Parsing and full execution are included; diagnostics run separately. Peak RSS
is the process high-water mark before validation, not retained memory.

Other work on Euler 165 was present in the shared worktree. The paired runtimes
hold those changes constant: the before runtime differs from the final runtime
only in nine JavaScript modules belonging to this change (`collections`,
`eval/application-structures`, `eval/application`, `fast-paths`, `materialize`,
`operators` counter membership, `preview-values`, `tensor-kernel`, `tensor-map`).
The numeric-only intermediate uses the earlier counter-key implementation before
consumer compilation. Runtime hashes are retained with every raw result.

## Changes

The algorithm already joins two pairs of equal-sum rows by six packed column and
diagonal sums. For Base=10, the original executes 37 sums and visits 4,816,030
pairs on each side. Replacing this with an eight-digit brute-force search would
increase the candidate count.

1. Runtime-owned counters use Number keys for safe integers and exact BigInt
   keys outside that range. Integer real/BigInt lookup equality is preserved;
   insertion still enforces the existing element-type contract. Composite keys
   retain their structural codec. Foreign maps retain string keys. Preview and
   aggregate completion preserve the key representation they need.
2. A native integer tensor visitor lowers actual checked map/view recipes into
   the existing tensor kernel. `new counter Keys` feeds computed keys directly
   into a private counter. `Counter Keys sum` feeds frequencies into an exact
   scalar accumulator, without a gathered frequency array. Ordinary completion
   boundaries and deferred observations remain intact; no plan result is cached.
   Foreign readers, overridden methods, count accessors and untrusted entries
   retain ordinary dispatch. The count proof is skipped when the counter is
   larger than the query, avoiding an expensive preparation for a small lookup.
3. The demo computes sums only through `Mid = 2 * (Base - 1)`. Complementing
   every digit maps sum S bijectively to `4 * (Base - 1) - S`. Contributions below
   Mid are doubled; Mid is counted once. This retains 19 sums and 2,632,465 pairs
   per side, a 45.3% reduction. Deferred `Up`, `Dn` and `Need` remain deferred.

The ordinary postfix dispatcher also had a duplicate observation: its special
Fenwick `sum` probe gathered selector arguments, then ordinary reduction gathered
them again. It now passes the already gathered value to that reducer. This is
covered with side-effecting keys and reducer rebinding in both engines.

## Measurements

| Engine / workload | Original, s | Numeric keys, s | Compiled consumers, s | With symmetry, s |
| --- | ---: | ---: | ---: | ---: |
| Compiled / main | 5.765 | 4.268 | 1.780 | 1.026 |
| Compiled / fixture | 5.798 | 4.271 | 1.832 | 1.123 |
| Reference / main | 5.747 | — | — | 1.873 |
| Reference / fixture | 5.865 | — | — | 1.939 |

Median peak RSS, MiB:

| Engine / workload | Original | Numeric keys | Compiled consumers | With symmetry |
| --- | ---: | ---: | ---: | ---: |
| Compiled / main | 660.8 | 622.5 | 530.1 | 464.5 |
| Compiled / fixture | 558.4 | 622.5 | 530.8 | 463.7 |
| Reference / main | 664.4 | — | — | 444.8 |
| Reference / fixture | 637.2 | — | — | 479.1 |

The final compiled main is **5.6x faster**, with **29.7% lower peak RSS**;
the fixture is **5.2x faster**. The reference main is **3.1x faster**.
Runtime changes on the original algorithm give **3.2x** for the main;
symmetry then reduces that time by **42.4%**. These stages are cumulative,
not independent speedups to multiply.

Separate diagnostic runs confirm 37 compiled builds and 37 sums on the
original algorithm, and 19 builds plus 19 sums with symmetry. The final
compiled consumers process 5,264,930 keys. Ordinary derived-cell calls fall
from 38,618,244 to 90,004.

Raw measurements: [compiled](baselines/2026-10-26-euler166-compiled.json),
[reference](baselines/2026-10-26-euler166-reference.json), and
[diagnostics](baselines/2026-10-26-euler166-diagnostics.json).

The generic `cellsComputed` diagnostic describes ordinary derived-cell calls,
not all arithmetic performed by compiled kernels. Its reduction must not be
interpreted as removing the required pair arithmetic.

## Verification

- TypeScript project build, semantic boundaries and application-form checks pass.
- The broad ordinary interpreter run passes 8,754 tests; exhaustive types,
  differential and Nurikabe suites are checked separately or excluded from this
  ordinary run. Subsequent focused checks pass 267 tests and cover the final preparation guards.
- Independent small-input tests enumerate three actual rows and derive the
  fourth from column sums for Base=2, 3, 4, 5, in both engines. The oracle uses no
  packed keys, pair join, counter or complementary-sum symmetry.
- Full default output is 7,130,034. Both unchanged fixture assertions pass in
  both engines: decimal default 7,130,034 and binary 34.
- Tests cover large exact keys/counts, integer-real lookup equality, membership,
  deletion, aliases, gathered snapshots, preview copies, fresh plan demands,
  unused/erroring plans, first-error state, host readers and count accessors,
  proxy entries, reducer replacement/rebinding, storage overrides, demand
  budgets, inspection and small queries into larger counters.
- Eight scoped type/differential checks also include Euler 062, a text-key counter
  client. Execution lanes, exclusions and deadlines are unchanged.

An initial broad run exposed a negative byte-index diagnostic mismatch in
concurrent scalar-selection work. The public fast path now leaves negative
indices to ordinary selection. The focused native-loop suite and final broad
run pass.

## Reproduction

After building:

```sh
node benchmarks/euler-criss-cross.mjs --samples=3
node benchmarks/euler-criss-cross.mjs --samples=3 --engine=reference --versions=final
node benchmarks/euler-criss-cross.mjs --samples=1 --diagnostics=true --cases=main
```

For paired measurements, supply `--before-runtime=/path/to/before/index.js` and
optionally `--numeric-runtime=/path/to/numeric/index.js`. The before/numeric/compiler
variants use `benchmarks/fixtures/euler166-original.ra`; final uses the current
demo. The unchanged fixture loads the matching main variant. The driver checks
all outputs and assertions and enforces a process-level deadline.
