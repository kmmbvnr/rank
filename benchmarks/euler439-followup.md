# Euler 439: modular tables and ordinary array products

Default N=100000000000, L=10000000; answer **968697378**.
Baseline: `7e989212`, with source retained in
`experiments/euler439-original.ra`.

The existing Dirichlet-convolution and hyperbola algorithm is retained.
The dominant avoidable work was materializing exact products before `mod`
and building full prefix sums before reducing them. Construction scratch
arrays also remained in the top-level environment.

The Rank program now builds Mobius and divisor-sum tables inside functions.
Each function has at most one loop; the prime-power sieve uses one state
machine instead of nested loops. Modular scans produce the indexed prefix
tables directly, without a seed, shifted gather or full wide prefix sums.
The square-divisor updates no longer copy their right-hand side. Both
triangular-number stages reduce their product in the same expression.
N=0 now returns 0; previously its zero table bound caused division by zero.
Every production line fits 40 columns.

## General runtime and compiler changes

Ordinary expression evaluation, including `compilation: false`, recognizes
`A * B mod M` for stable, complete, unnamed Int32 arrays of equal shape and
a positive integer modulus up to 2^30. The modulus must be a literal or an
already-bound integer name. It uses the existing exact split multiplier;
there is no floating approximation or Euler-specific operation.

The shared modular-product kernel reads stable Int32 cells directly into
one output buffer, avoiding two residue copies. Compiled expressions use
this same kernel. Observable polling, inspection and demand budgets retain
the existing checkpoint path. Other shapes/types/metadata and computed
moduli retain ordinary execution. Guards run on current values.

Tests exposed an existing scalar-expression compiler error: a computed
modulus could execute before multiplication failed, or mutate its inputs
before the product was captured. Such expressions now finish multiplication
first. Literal and named modulus fusion is retained.

A previous Euler 438 test also needed an explicit undefined-result guard
for the test TypeScript build; runtime behavior was unchanged.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x86_64. Individual fresh
processes, no heap/GC flags. Times include parsing. Mac entries are medians
of three samples; Intel entries are single controls, not medians. RSS is
process peak, and Mac RSS columns are medians of those peaks.

| Host / mode | Original s | Final s | Original peak MiB | Final peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 14.370 | 11.366 | 2408 | 2110 |
| Mac reference | 29.053 | 26.038 | 2269 | 2360 |
| Intel compiled | 38.865 | 31.593 | 1655 | 1194 |
| Intel reference | 71.715 | 65.599 | 1900 | 2046 |

Compiled time falls by 19–21%, and reference time by 9–10%. Compiled peak
RSS falls by 12% on Mac and 28% on Intel. **Reference peak RSS increases**
by about 91 MiB / 146 MiB; this is not an overall reference-memory saving.
The full default remains in the manual lane because it still needs roughly
2 GiB per reference process. The small fixture remains in the audits.

A smaller L was worse in exploratory Mac compiled runs: L=2000000 took
22.099 s / 2328 MiB, and L=5000000 took 14.054 s / 2101 MiB. Larger quotient
recurrences erased the table savings. Adding a final Mobius copy also lost:
26.728 s / 2535 MiB reference. The default L and compact result are retained.

Raw results and intermediate candidates are in
`baselines/2026-11-07-euler439.json` and `experiments/euler439-*.ra`.

## Verification

- TypeScript source and test builds; semantic and application-form checks.
- 566 targeted tests across 18 files on both Mac and Intel.
- Four Rank fixture tests in three modes on both hosts: compiled, exact-loop
  backend, and reference. Original statement values and short-table tests
  remain; empty/singleton cases were added.
- Independent divisor enumeration for 13 bounds from 0 to 100, two table
  sizes and three execution modes, within the targeted tests.
- Full default answer in both engines on both hosts.
- 64 baseline comparisons of values/errors; 63 unchanged and one intended
  correction of compiled error order to match the reference engine.

The exhaustive type/differential/Nurikabe audits and full suite were not run.

Reproduce from the repository root after building:

```sh
npx tsc -b tsconfig.build.json
node benchmarks/experiments/euler439-run.mjs compiled
node benchmarks/experiments/euler439-run.mjs reference
node benchmarks/experiments/euler439-verify.mjs
```

Use `RANK439_L` to change the table bound, and `RANK439_RUNTIME` with a
file URL to compare the same source against a separately built runtime.
