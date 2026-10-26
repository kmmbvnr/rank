# Euler 129: native concat completion and bounded remainder search

Measured on Apple M5 / Node v24.15.0, 2026-10-26, against `029bda1e`.
The default limit remains 1,000,000, the window remains 30, and the answer
remains **1000023**. Both original fixture assertions are retained.

## Diagnosis

The original program computes powers of ten modulo `9n` for all twelve eligible
candidates, doubling a completed matrix until it has 1,048,576 columns. The final
matrix has **12,582,912 cells**. Doubling repeatedly copies old cells as well as
computing new ones; the diagnostic run computes 50,331,774 derived cells.
Only after completing the table does the program ask whether each row contains
one among its first million powers. The fixture runs the full default once,
then a small statement example; duplicate full-input tests are not the problem.

Compilation already handles individual tensor stages. The missing composition
is the native concat consumer: its lazy `Next` argument previously fell back to
ordinary cell traversal. Removing the outer loop's deferred-binding rejection
would not repair that consumer and could change unused-plan/error timing.

## Compiler change, measured independently

Native concat results now publish their actual, shape-checked operands and
resolved axis. The native tensor lowerer composes scalar map recipes inside each
segment. The emitter chooses the segment before computing its cell, preserving
concat's traversal order and boolean short-circuit behavior. This supports any
resolved concat axis, including trailing axes, without adding source-expression
axis syntax to the older tensor parser.

`copy` now consumes eligible native tensor recipes through the same completion
kernel as ordinary `=`. Native readers, shapes, revisions, scalar operators and
cell contracts remain guarded. Host readers, replaced readers, unsupported
layouts/domains and unavailable dynamic code generation keep ordinary execution.
The outer doubling loop still rejects deferred bindings; it runs only twenty
iterations. This is consumer fusion, not compilation of that whole loop.

The exact original source is retained in `fixtures/euler129-batched.ra`, including
its explicit `copy`. The unchanged-source compiled median improves **5.4x**;
derived-cell accounting falls from **50,331,774 to 174**. This counter excludes
work performed inside native kernels, so it does not mean the arithmetic has
been eliminated. Table construction still writes millions of result cells.

## Is copy necessary?

No: `Tab = concat Tab Next axis 1` already completes the array at the ordinary
binding. The explicit `copy` is redundant here. Removing it preserves answers and
table values; after this change both forms use the same native completion path.
The timing difference below does not establish an extra speed benefit from
removing `copy`. The old runtime likewise changes only slightly when it is removed.
This conclusion applies to this completed binding, not to arbitrary deferred
bindings or to copying writable storage for isolation.

## Final algorithm

The final demo keeps only thirty candidate numbers and a deferred ranked boolean
mask. `first where` stops at the first suitable candidate. Its scalar helper
rejects multiples of two or five, then advances

```text
R = (10 * R + 1) mod N
```

until the remainder is zero or the repunit length exceeds `Limit`. Since
`A(n) <= n`, candidates begin just above `Limit`, as before. The search retains
`Window`, including failure if no answer lies in that window. It constructs no
large integer repunits and no matrix of powers.

Ignoring rank-layout probing of the first candidate, the standard answer needs
**2,006,520 remainder transitions** across ten eligible candidates. Rank shape
discovery can revisit its first cell; the implementation introduces no memoization
to hide those observations. No candidate beyond the first match is evaluated.
For the winning candidate the exact order is **A(1000023) = 1000020**.

## Measurements

Medians of **three serial fresh-process samples**, with alternating version
order. Timing includes parsing and complete execution. Peak RSS is sampled before
oracle validation and represents process high-water memory, not retained storage.
Diagnostics are separate untimed-comparison runs. No tests or other benchmark
jobs ran concurrently with these measurements. Earlier exploratory timings are
superseded by the archived samples.

The frozen before/after runtime pair differs in exactly three JavaScript modules:
`tensor-map.js`, `tensor-kernel.js`, and `modules/sequences.js`. All other
interpreter JavaScript files are byte-identical.

| Engine | Source/runtime | Main, s | Peak RSS, MiB |
| --- | --- | ---: | ---: |
| Compiled | Original table, before runtime | 6.364 | 818.2 |
| Compiled | Original table without copy, before runtime | 6.308 | 818.2 |
| Compiled | Same original source, native concat completion | 1.179 | 268.9 |
| Compiled | Table without copy, native concat completion | 1.208 | 268.1 |
| Compiled | Final bounded remainder search | **0.132** | **170.1** |
| Reference | Original table | 6.687 | 817.7 |
| Reference | Final bounded remainder search | **0.734** | **177.7** |

The final compiled main is **48.0x faster**, with about **79% lower peak RSS**.
The reference main improves **9.1x**. The final four-test compiled fixture takes
**0.153 s / 173.0 MiB**. Compiler-only and algorithm results are deliberately
separate: the final remainder program does not need concat.

## Verification

- Build and test TypeScript checks pass, as do semantic-boundary and
  application-form checks.
- The ordinary interpreter run passes **8,544 tests in 376 files**, excluding
  exhaustive types/differential corpora and Nurikabe. The final focused run
  passes **52 tests** covering the new concat and remainder suites, including two
  additional arbitrary-precision cases added after that ordinary run.
- All **four scoped Euler 129 type/differential audits** pass: full main and
  fixture, both execution engines. No execution lanes or deadlines changed.
- Every timed main checks its answer/output against an independent exact
  multiplicative-order oracle: compute the totient of `9n`, then remove prime
  factors using modular exponentiation. This differs from both Rank algorithms.
- Every timed table main checks the final shape and six selected columns in each
  of its twelve rows against independent modular powers, including the millionth
  power and the final column.
- Twenty-two small main checks (eleven limits, both engines) compare against exact
  orders, including zero and strict thresholds. Separate checks cover bounded
  failure and no candidates evaluated beyond the first successful mask cell.
- All four fixture outputs are validated. New fixture cases cover strict
  comparison and a hit exactly at the window boundary.
- The concat suite covers rank-three routing on axes 0, 1, 2 and -1, both explicit
  copy and ordinary completion, repeated demands, snapshots, host read order,
  heterogeneous contracts, empty segments, arbitrary-precision output, replaced
  readers, short-circuit/error order and CSP fallback, in both engines.
- The old demo's completed-table/deferred-selection regression test now reads the
  archived original fixture, preserving coverage after the algorithm rewrite.

## Reproduce

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-repunit-divisibility.mjs --samples=3
node benchmarks/euler-repunit-divisibility.mjs --samples=3 --engine=reference --versions=pruned
node benchmarks/euler-repunit-divisibility.mjs --samples=3 --cases=fixture --versions=pruned
node benchmarks/euler-repunit-divisibility.mjs --samples=1 --diagnostics=true
```

To compare the unchanged source against the previous runtime, add
`--before-runtime=/path/to/frozen/packages/interpreter/out/index.js`.
The harness then includes `before` and `before-nocopy`; `--versions=` selects
variants. `--runtime=` selects another candidate runtime. Archived raw results
include source hashes, hashes of the three changed runtime modules, oracle
orders, per-sample timings/RSS, and fixture results:

- `baselines/2026-10-26-euler129-compiled.json`
- `baselines/2026-10-26-euler129-reference.json`
- `baselines/2026-10-26-euler129-fixture.json`
- `baselines/2026-10-26-euler129-diagnostics.json`
