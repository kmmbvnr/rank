# Euler 23: bitsets, strided writes and boolean scatter compilation

The phone run reported by the user took 9.89 s, mostly marking abundant pairs.
The original Rank program performs 48,511,225 predicate checks and 24,294,140
boolean stores. There are only 28,124 destination cells. The source is preserved
in `experiments/euler023-original.ra`.

## Delivered program

The divisor sieve now writes a strided range directly:

```rank
for D in 1 to Limit // 2
  Sums (D * 2 to Limit by D) += D
end
```

This avoids creating `K` and the `D * K` index array on every iteration.
Starting with zero sums and divisor 1 also handles `Limit = 0` correctly.

Pair marking uses exact BigInt masks and the existing array operations:

```rank
Bits = 1 shl Ab reduce bor with 0
Pairs = Bits shl Ab reduce bor with 0
```

Bit `a + b` is set precisely when two abundant numbers sum to it. These two
array reductions replace the marking loops without constructing a Cartesian
matrix. The zero reduction identity handles an empty abundant list. The final
selection still sums only `1 to Limit`; there is no hard-coded 20161 cutoff.
The BigInt mask idea appears on the last page of
[the Euler 23 discussion](https://projecteuler.net/thread=23;page=9).

## Compiler changes

* Rank-one integer/real selections written as `Values (boolean mask)` can use
  the existing Number filter lowering. The mask does not become a separate
  boolean array in that backend. Ordinary `=` snapshots are retained.
* Rank-one boolean destinations accept integer-array selectors in both the
  publishing backend and the private Number scatter backend. The publishing
  backend reuses the ordinary checked write, including selector-before-RHS
  ordering, aliases and shape errors.
* A scalar scatter RHS can escape as the assignment result. It is already
  evaluated and is returned with its original scalar type. The previous blanket
  result-discard requirement was unnecessary for `Pairs (A + B) = true`.
  An escaping array RHS retains the existing path because it can be a live
  selection; no language semantics changed.

The unchanged original marking loop now enters Number mode. A separate
`arrayDiscarded` variant keeps a final scalar statement as a control: its time
is now close to the unchanged source, so that technical wrapper is unnecessary.
Overflow replay, private copies, publication, polling and copy thresholds remain
in place. Custom mobile polling retains the observable backend.

## Full-program measurements

Three fresh Node 24.15.0 processes per case and host; medians below. Initial
before/after trials alternated, then the final compiler and final demo were
remeasured separately. Other user workloads were not controlled; small timing
differences should not be treated as wins. Imports precede the timer; Rank
parsing, compilation and execution are included. RSS is process peak, including
Node and interpreter overhead, rather than live array storage.

| Host / mode | Original before | Delivered demo | Peak RSS before → after |
| --- | ---: | ---: | ---: |
| Mac ARM64 / compiled | 785 ms | 307 ms | 573 → 177 MiB |
| Intel x64 / compiled | 1939 ms | 439 ms | 372 → 164 MiB |
| Mac / mobile signal model | 10574 ms | 232 ms | 460 → 187 MiB |
| Intel / mobile signal model | 24609 ms | 601 ms | 348 → 173 MiB |

The delivered reference execution is 211 ms on Mac and 554 ms on Intel. For
this short program its lower cold setup cost can beat compiled execution.
Every measured answer is **4179871**. These are desktop measurements of the
observable mobile signal API, not new measurements on the phone or WebView.

## Comparison with manually written JavaScript

The following measures just pair marking and the final sum, excluding the
shared divisor sieve. JavaScript uses Int32Array/Uint8Array; Rank timings still
include parsing/compiling that phase. Use these as implementation comparisons,
not proof that either runtime should have identical cold startup cost.

| Marking implementation | Mac | Intel |
| --- | ---: | ---: |
| Original Rank, before compiler changes | 541 ms | 1230 ms |
| Original Rank, after compiler changes | 166 ms | 344 ms |
| JS `filter`, `map`, indexed stores | 113 ms | 299 ms |
| Rank explicit nested loops with early break | 127 ms | 141 ms |
| JS same nested loops with early break | 37 ms | 49 ms |

The array-style JS worker is intentionally straightforward:

```js
for (const a of ab) {
    const b = ab.filter(b => b <= n - a);
    const keys = b.map(b => a + b);
    for (const key of keys) flags[key] = 1;
}
```

The nested version computes a sum and breaks once it exceeds the limit. Both
visit the same 24,294,140 valid ordered pairs. The triangular alternative from
the forum halves the writes to 12,148,815; it is a different workload.

Actual generated code is saved in `experiments/euler023-original-generated.js.txt`,
`euler023-array-generated.js.txt` and `euler023-nested-generated.js.txt`.
Diagnostics confirm one Number region for each marking variant and no overflow.
Both the array and explicit nested Rank forms compile to numeric JavaScript
loops. The array lowering currently has separate passes to filter `B`, construct
`A + B`, validate all selectors, and scatter. The nested lowering generates
nested loops directly. It still has safe-integer/bounds checks, checkpoints,
dirty bindings and transactional publication that the handwritten JS omits.

There is remaining compiler work: fuse pure selector maps with validation and
scatter, then eliminate an unobservable temporary filter binding when its scope
and error/replay contracts prove that safe. This should be a general compiler
optimization. Removing the language's assignment return value is unnecessary;
a scalar result has essentially no extra work, and unused results can be elided.
No language-simplification issue was created.

## Verification and reproduction

* Mac: 595 tests in eight focused files passed after all compiler changes;
  three additional scalar-result/type cases passed, and all 24 boolean-scatter
  plus demo tests passed again after the final sieve rewrite.
* Intel: 58 tests in boolean-scatter, Euler 23 and indexed selections passed.
* Independent direct divisor/pair oracle: every limit 0 through 80, both engines.
* Full default answer under custom mobile polling: both engines, both hosts.
* CLI source check and all four `.ra` test blocks passed; TypeScript build passed.
* Exhaustive audits and the full `npm test` were not run.

Raw samples: `baselines/2026-11-03-euler023-followup.json`.
Run each command in a fresh process, three times, after building:

```sh
node benchmarks/euler023-followup.mjs original compiled
node benchmarks/euler023-followup.mjs original mobile
node benchmarks/euler023-followup.mjs demo compiled
node benchmarks/euler023-followup.mjs demo mobile
node benchmarks/euler023-followup.mjs nested compiled
node benchmarks/euler023-followup.mjs js-array compiled
node benchmarks/euler023-followup.mjs js-break compiled
```

`RANK023_RUNTIME=/absolute/path/packages/interpreter/out/index.js` selects a
baseline runtime. `RANK023_DIAG=1` reports diagnostics and generated source;
collect those separately from timed samples.
