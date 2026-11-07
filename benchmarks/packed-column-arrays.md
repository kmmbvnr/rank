# Packed column concat and narrow broadcast rows

Concatenating stored Int32 or Float64 single-column arrays now interleaves
their cells directly into the packed output. It avoids creating a block and
subarray view for every cell. Uniform validation keeps its original first-cell
order. Int64 data retains native bulk copies, which avoid boxing every cell.
Budgets, inspection and observable host polling retain the ordinary traversal.

The existing compact integer broadcast kernel now admits rows of width 2–3,
using the same size, layout and integer-bound proofs as wider rows. Computing
broadcast coordinates once per row avoids a temporary Float64 output. This
covers eligible arithmetic and extrema, not every integer expression.

Three alternating before/after pairs per workload run in fresh Node v24.15.0
processes, with compilation disabled. The baseline is an isolated `62998718`
build; after adds only these changes. The measurements include parsing, input
construction, the operation and summation, with independent formula checks.
Both workloads use two million rows. All raw samples are retained in
`baselines/2026-11-07-packed-column-arrays.json`, including before-run Intel
vmstat samples. These are medians, not best runs.

| Host | Operation | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| Mac / arm64 | Three-column concat | 469.05 | 110.83 | 210.44 | 200.14 |
| Intel / x64 | Three-column concat | 1277.62 | 288.40 | 197.97 | 180.12 |
| Mac / arm64 | Two-column broadcast | 164.94 | 129.27 | 210.91 | 185.58 |
| Intel / x64 | Two-column broadcast | 426.86 | 358.87 | 201.55 | 164.84 |

Concat uses columns i, 3i, i and checks the sum 5*N*(N+1)/2. Broadcast uses
column i plus offsets 1 and 3 and checks N*(N+1)+4*N. Both controls assert
zero generated loop/tensor executions, so these gains also reach reference
execution. To reproduce:

```sh
node benchmarks/packed-column-arrays.mjs concat
node benchmarks/packed-column-arrays.mjs broadcast
```

Set `RANK_BENCH_RUNTIME` to a control runtime's `out/index.js` file URL.

Validation: isolated build; 165 focused tests across nine files on Mac and
Intel (163-test selection plus two added demand-limit cases). Coverage includes
empty and singleton columns, repeated inputs, real and wide integer copies,
broadcasts across three axes, signed arithmetic, widening and scoped budgets,
observable cancellation polling, existing concat and integer-collection cases.
After the final per-cell cancellation-cadence change, the 120 affected tests
were rerun on both hosts and both workload measurements were repeated. The
Mac broadcast samples include a slower final pair; it is retained in the raw
data along with all other samples. Exhaustive audits were not run. Euler 445's source and issue row remain
unchanged; choosing its algorithm/memory tradeoff is still separate work.
