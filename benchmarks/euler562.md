# Euler 562: exact near-diameter lattice search

Base: `afc824b024a0fd7f0b7d3c5b4d3e3ea3f50483f5`.
The full radius is 10,000,000 and the exact answer is **51208732914368**.

## Program

The former program scanned millions of possible horizontal edge components,
then searched a narrow vertical window and integer translations with nested
loops. It also used floating-point corrections to compare perimeters.

The replacement searches squared edge lengths downward from the diameter.
An empty lattice triangle has determinant one. For its longest edge u=(a,b),
write n=a²+b² and q=u·w, choosing the third vertex so 0<q<n. Its other squared
sides are (q²+1)/n and ((n-q)²+1)/n, so q²=-1 modulo n. Enumerating roots of
minus one by prime-power CRT and reducing each by Cornacchia gives primitive
edge orientations. Each result is certified by its square sum, gcd and modular
alignment. Factorization and modular exponentiation use existing libraries;
only scalar quadratic nonresidues are memoized.

The correspondence between primitive sums of two squares and roots of minus
one, including composite moduli, is described in Richard T. Bumby's
[Sums of Four Squares, section 1](https://oeis.org/A000118/a000118.pdf).

For fixed n the perimeter is

```
2 sqrt(n) + (f(q) + f(n-q)) / sqrt(n),
f(t) = sqrt(t²+1) - t.
```

The decreasing convex f makes the smallest min(q,n-q) best. Its correction is
at most 2(sqrt(2)-1)/sqrt(n), smaller than the gap to 2sqrt(n+1) for every n>=2.
Consequently, a larger n always wins; no floating-point tie breaker is needed.

Translations are checked by an array of integer x coordinates and an exact
intersection of three integer y intervals. For midpoint m of the longest
edge and D=4R²-n, its two endpoints imply |m|²+|u·m|<=D/4. Thus the x span is
bounded by b sqrt(D)/(2sqrt(n)) + aD/(4n); integer ceilings conservatively bound
it in the program. No y loop or approximate square root is used. The final
circumradius ratio is rounded by an exact squared midpoint comparison.

The first feasible full-scale loss is 2718, n=399999999997282 and
min(q,n-q)=60298508117635. The search includes the last loss permitted by Dm;
no solution within that band is an explicit error. R and Dm must be positive.
There is one nonnested loop, over distinct prime-power CRT factors. Rank lines
stay within 40 columns.

## Shared implementation

* Dyadic rank-zero calls can lazily broadcast an immutable primitive scalar
  against a known infinite sequence. Operand order, function snapshots,
  callback errors, array cells, cancellation and demand budgets are retained.
  Whole-sequence parameter completion retains its ordinary contract.
* Numeric array functions compile integer or real `min`/`max`, including
  clamps inside correlated integer-root reductions. Mixed kinds and unsafe
  integers retain fallback; no numeric threshold changes.
* Stored real min/max now agrees with the scalar operation on NaN and signed
  zero: ties and unordered comparisons retain the left operand. The previous
  typed kernel incorrectly retained the right operand.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Compiled old/new
variants ran in three alternating fresh-process pairs. New reference and the
compiler control each have three fresh-process samples; the slow old reference
has one sample per host. Times include parsing/execution and exclude interpreter
imports. Every sample checks the full exact answer. RSS is the process high-water
mark; diagnostics and profiling are disabled.

| Host/mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 3.732 | 0.752 | 191.3 | 349.8 |
| Mac reference | 53.672 | 1.083 | 460.0 | 488.2 |
| Intel compiled | 10.509 | 2.628 | 194.3 | 331.2 |
| Intel reference | 187.826 | 4.089 | 440.2 | 464.8 |

Rows with three samples show medians of time and RSS separately. Old reference
rows are single samples, not medians. Intel was also running one unrelated
nightly Euler worker: observed one-minute loads were 1.15-2.57 before/during the
measurements. It was left running. The paired compiled comparison is under
that load; these numbers are not an idle-host baseline.

The algorithm rewrite gives most of the reference improvement. On the same new
source, disabling array-function compilation gives 1.113 s / 497.4 MiB on Mac
and 4.127 s / 479.5 MiB on Intel. Thus the compiler route saves time and temporary
storage within the new program. It does not eliminate the full program's RSS
increase over the old scalar search: compiled peaks rise by about 159 MiB on
Mac and 137 MiB on Intel. This is a speed/RSS tradeoff, not a memory optimization.
Allocation experiments pointed to transient factorization and plan allocations;
no forced-GC timings or speculative arithmetic prototypes are primary results.

## Verification and reproduction

Passed: TypeScript build; 273 focused checks in 11 files on each host; two
filtered differential cases on each host; two inferred-type and two name-fact
cases on Mac; five exclusion-policy checks. The demo tests independently enumerate
all lattice triangles for radii 1-8, retain the statement and full answers on
Number/exact/reference routes, compare further small cases to the original
search, enumerate all modular roots through norm 500, and recover every such
primitive orientation. Tests cover search-band boundaries, invalid inputs,
real NaN/signed-zero semantics, lazy capture snapshots, callback errors,
cooperative cancellation and demand budgets. The fixture's 300-second exclusion
is removed and its eligibility is asserted. No exhaustive audits/full npm test.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler562.mjs compiled
node benchmarks/euler562.mjs reference
node benchmarks/euler562.mjs exact 1000
node benchmarks/euler562.mjs compiled 10000000 benchmarks/fixtures/euler562-original.ra
```

`RANK562_RUNTIME` selects another built runtime; `RANK562_EXPECTED` checks the
answer; `RANK562_DM` changes the search band. `RANK562_ARRAY_FUNCTIONS=0` runs
the same-source compiler control. Diagnostics/profiles require the separate
`RANK562_DIAGNOSTICS=1` or `RANK562_PROFILE=path` options. Raw samples and their
sample-count caveats: `baselines/2026-11-10-euler562.json`.
