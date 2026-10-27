# Euler 177: integer angled quadrilaterals

Baseline: `16b2c413`, Apple M5, Node v24.15.0. The baseline was built from a
separate archive of that revision. Only `tensor-map.js`, `tensor-kernel.js`,
`scalar-builtin.js`, `modules/numbers.js` and `modules/shared.js` differ in the
interpreter JavaScript modules. The fixture and its full-size assertions are unchanged.

## Controlled compiled measurements

Three serial fresh processes per workload/version, with alternating forward and
reverse order. Timings include parsing and complete execution; diagnostics and
tests did not overlap these measurements. RSS is the process peak before
validation, not retained memory or an allocation-volume measurement.

| Workload | Before | Compiler only, original algorithm | Final |
| --- | ---: | ---: | ---: |
| Main, seconds | 3.332 | 2.814 | 1.366 |
| Fixture, seconds | 3.311 | 2.812 | 1.369 |
| Main peak RSS, MiB | 497.97 | 667.39 | 456.33 |
| Fixture peak RSS, MiB | 499.92 | 649.58 | 436.78 |

The runtime change alone reduces main time by 15.6%. The final main is 2.44x
faster and its fixture is 2.42x faster. Final peak RSS is 8.4% lower for the main
and 12.6% lower for the fixture. Runtime-only peak RSS increases by 34.0% and
29.9%, respectively: fewer interpreted cell reads do not imply less peak memory.
This intermediate-stage cost is retained explicitly rather than described as a
universal memory improvement.

An earlier investigation tried completing every intermediate with ordinary `=`.
That is not the shipped change: the demo retains its deferred numeric stages,
and the compiler consumes them at the existing completion/write boundary.

## Interpreter findings and change

The original builds two 939,929-entry key tables from sine ratios. A separate
diagnostic run spends most time building these tables; the final symmetry search
already uses one Number region. General cell traversal through gathers, broadcast
arithmetic and ranked numeric calls dominates table construction.

Checked native unary numeric functions now carry scalar recipes into the native
tensor graph. The capability is registered on the builtin object and its actual
implementation, not inferred from a public name or result annotation. Trigonometric
and hyperbolic unary functions, `log`, `exp`, `floor` and `ceil` can compose with
existing native arithmetic, gathers and reshape views. The emitter invokes their
captured checked scalar bodies in the same cell loop. This is native recipe
lowering, not whole-function or outer-loop compilation.

Ordinary bindings still complete values. Slice assignment still completes its
entire RHS privately before publishing any replacement, preserving aliases and
error atomicity. It does not materialize every intermediate stage. Each demand
gets fresh inputs and computed values; only executable code is cached. Unused
plans remain unused. Unsupported domains, foreign readers, changed builtin
implementations, inspection, observable polling and unavailable code generation
retain ordinary execution. Numeric errors discard private work and replay the
ordinary path for matching errors and source locations; cancellation propagates.

Separate diagnostics on the full main:

| Counter | Before | Compiler only | Final |
| --- | ---: | ---: | ---: |
| Ordinary computed cells | 33,963,651 | 5,765,781 | 2,882,981 |
| Numeric sorts | 2 | 2 | 1 |
| Compiled tensors | 2 | 356 | 179 |
| Number loop entries | 1 | 1 | 1 |
| Number overflows | 0 | 0 | 0 |

## Algorithm

For a fixed U, with V = 180 - U, the old right table at (r,p) is exactly the
left table at (U-p,r): both use the same ordered numerator and denominator
products before logarithm and rounding. Their sorted keys therefore have the
same multiplicities. The demo now sorts one table, pairs entries within each
equal-key group and reconstructs the right-hand angles from the mirrored index.
It removes the second key/index arrays, second argsort and the two-list merge.
It keeps the same rounding, candidate set, default input and Burnside orbit count.
The identity symmetry contributes one immediately; other symmetry checks stop
at their first mismatch.

## Verification

- Full main output remains **129325** in both engines.
- The unchanged fixture passes in both engines, including `Fixed // 8` and
  `Fixed mod 8` assertions. Final reference checks took 44.152 s for the main and
  45.086 s for the fixture; these are single validations, not repeated medians.
  The original main on the frozen baseline exceeded an enforced 60-second
  process deadline. No exact before time or reference speedup ratio is claimed.
- An independent oracle enumerates closing angle tuples and canonicalizes all
  eight rotations/reflections. It does not use rounded buckets, sorted joins or
  Burnside fixed counts. Four angular grids pass in both engines (eight tests).
- Twenty-three numeric-recipe tests cover broadcast/reshape, slice writes,
  unused and repeated plans, captured inputs, ordinary completion, error state
  and locations, native overrides, host readers, short circuit, empty shapes,
  arbitrary-precision floor results and interruption.
- Build, test TypeScript check and semantic/application-form checks pass.
- All **1,481 language tests / 65 files** pass.
- All **8,847 ordinary interpreter tests / 391 files** pass. Exhaustive types,
  the full differential corpus and Nurikabe are separate lanes and were excluded
  from this ordinary run; no exclusions, budgets or timeouts were changed.

General reference dispatch overhead remains open. This pass does not reclassify
historical manual-lane exclusions. Runtime-only RSS on the original algorithm
also remains an explicit tradeoff.

## Other-client controls

Three alternating serial fresh processes per runtime, using unchanged current
sources and existing workers with their output assertions:

| Client | Before median, s | After median, s |
| --- | ---: | ---: |
| Euler 060, bitset search | 2.589 | 2.585 |
| Euler 170, main | 0.536 | 0.539 |

Timing ranges overlap for both controls; these samples do not resolve a time
regression or establish a universal speedup. Workers were run with
`--expose-gc`: `benchmarks/euler-prime-pairs.mjs --worker=bits --runtime=...`
and `benchmarks/euler-pandigital-products.mjs --worker=main --version=final --runtime=...`.
The control records retain the runtime path and source fingerprint.

## Reproduction and raw records

After building:

```sh
node benchmarks/euler-quadrilaterals.mjs --before-runtime=/path/to/built/16b2c413/packages/interpreter/out/index.js
node benchmarks/euler-quadrilaterals.mjs --versions=final --samples=1 --diagnostics=true
node benchmarks/euler-quadrilaterals.mjs --versions=final --samples=1 --engine=reference --deadline=180000
```

The harness checks the full output and fixture results, fingerprints sources and
changed runtime modules, and records external process deadlines. The original
main is retained in `benchmarks/fixtures/euler177-original.ra` for runtime-only
comparisons. Raw records are under `benchmarks/baselines/2026-10-27-euler177-*`.
