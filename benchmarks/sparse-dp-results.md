# Sparse integer DP: Euler 400 (#398)

The existing Euler 400 program already uses primitive integer index keys and
a compiled explicit work stack. On `639ee9cb`, its full input completes with
the correct answer, but exceeds the 30-second command budget in one of three
runs. No demo algorithm or index equality change is required by this fix.

## Interpreter change

Compile proven integer `band`, `bor` and `bxor` calls directly to exact BigInt
operators in scalar function bodies. Keep the existing module and builtin
identity guards. Other calls keep their existing execution path.

Besides removing native call wrappers, this allows a body whose only native
calls were those bit operations to use the existing borrowed array readers.
Those readers remain conditional on private polling and the absence of user
calls. Bounds errors, reader invalidation, arbitrary-precision integers and
the interpreted fallback remain in place. Stack storage and Euler 400's
recurrence are unchanged.

Exploratory CPU profiles at K=3000 guided the change: the baseline attributed
about 13% of samples to `scalarSelection` and 5% to `atArray`; neither appeared
among the leading frames after the change. Profiles include startup and are
attribution probes, not timing comparisons. The initial profile overlapped
with focused tests; the full-input timings below did not.

## Measurements

Apple M5, Node v24.15.0, diagnostics enabled in both versions. Each sample is
a fresh process; full-input samples ran sequentially without builds or tests.
Execution includes parsing; cold wall time also includes imports and startup.
Three baseline samples and three candidate confirmation samples:

| K=10000 | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| Execution | 29.367 s (29.278–32.807) | 20.744 s (20.459–21.082) |
| Cold wall | 29.828 s (29.607–33.188) | 21.183 s (21.118–21.680) |
| Peak RSS | 1181.8 MiB | 1182.8 MiB |

Median execution improves 1.42x (29.4% less time). Every candidate confirmation
run completes within the harness's 30-second timeout. This is evidence for the
named machine, not a universal CI timing guarantee or a memory improvement.
All runs return `438505383468410633` modulo 10^18, with 16,734,773 cached
states and 33,469,547 index reads. The state count is unchanged.

The first candidate probe also verified K=100 and K=1000, returning
`580893155023212545` and `867114317183878825`. Full raw timing/CPU/memory summaries
are in `baselines/2026-10-23-sparse-dp.json`; the initial candidate measurement
is recorded separately from the confirmation series.

Reproduce after building:

```sh
node benchmarks/sparse-dp.mjs --sizes=100,1000,10000 --timeout=30000
node benchmarks/sparse-dp.mjs --sizes=10000,10000,10000 --timeout=30000
```

## Verification

`npm run build` passes, including the web/mobile builds and Capacitor sync.
The first worktree attempt could not locate the existing nested Capacitor
dependency; linking the worktree to that installed dependency resolved it.

The six focused files pass 63 tests: `typed-bits`, `fibonacci-tree`,
`scalar-function-kernel`, `compiled-array-arguments`, `index-storage` and
`interrupt`. New regressions compare compiled and interpreted bit operations
on signed integers beyond 64 bits, recheck replaced builtin bindings, and
preserve missing-module errors and lazy branches. Existing Fibonacci tree
tests include an independent small-game oracle and exact checkpoint counts.
No full test suite or corpus audit was run.

After rebasing onto main `645ad67c`, the full build and the same 63 focused
tests passed again. A separate K=10000 verification returned the same answer
in 15.236 s execution / 15.582 s cold wall, with 1180.8 MiB peak RSS and the
same state count. This integration check is excluded from the timing comparison
above because its parent includes other changes.
