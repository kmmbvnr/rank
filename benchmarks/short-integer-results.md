# Retaining computed integer buffers

The stored safe-integer binary kernel previously wrote Number results to a
Float64 scratch array, narrowed them to Int32, and boxed them back into
BigInts when both operands were boxed. Short tail vectors in Euler 454 make
this conversion frequent even though the next operation can use numeric
cells directly.

The kernel now allocates from the first result's width. Narrow results keep
that buffer; a later wide safe integer expands it while preserving the
computed prefix. Unsafe values retain the existing exact BigInt fallback.
Completed multi-cell results retain numeric storage even with boxed inputs.
Empty and singleton results from boxed operands stay boxed: a numeric value
facade costs more than boxing one cell. Already typed operands retain typed
results. The generic literal packing threshold and numeric admission limits
are unchanged.

Int32 reader objects share their iterator, slice method and Proxy handler.
Typed arrays also share their public `items` getter. Explicit public access
still materializes the same tracked ordinary array. A separate attempt to
share the conversion callback increased full-workload RSS and was rejected.
No pooling, global result cache or weakened ownership rule is introduced.

## Controls

The fixture runs 20,000 iterations over 1 or 31 integers, doing addition,
multiplication, floor division and an exact sum. Both runtimes use the same
source and Node v24.15.0. The immutable base is b75ee8e1. Three alternating
before/after pairs use fresh processes; foreign Node jobs are checked before
each run and every second during it. Subsecond runs have only the initial
check. Intel also requires at least 98% idle and no swap traffic before each
run. Slow samples are retained rather than removed retrospectively.

Medians, milliseconds and process peak RSS MiB:

| Host | Cells | Before ms | After ms | Before RSS | After RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mac arm64 | 1 | 353.05 | 331.31 | 279.08 | 281.61 |
| Mac arm64 | 31 | 458.57 | 414.41 | 352.59 | 337.31 |
| Intel x64 | 1 | 1285.31 | 1141.87 | 261.57 | 258.77 |
| Intel x64 | 31 | 1723.39 | 1478.77 | 332.90 | 307.71 |

The initial always-packed singleton experiment regressed Mac time by about
7% and RSS by about 12%; it is not the delivered policy. With the singleton
exception, time improves on both hosts. Mac singleton RSS changes by under
1%; larger-vector RSS drops 4.3% on Mac and 7.6% on Intel.

Raw samples: `baselines/2026-11-07-short-integer-results.json`. The checksums
3043094936369 (one cell) and 17603315981925 (31 cells) also match a direct
integer oracle over every denominator.

After building, reproduce one sample with:

```sh
node benchmarks/euler454.mjs reference 42 \
  benchmarks/fixtures/euler454-short-arrays.ra --n=31
```

Set RANK454_RUNTIME to an immutable baseline's
`packages/interpreter/out/index.js` for the comparison. The dummy L argument
only lets the shared runner invoke this small control; N sets its width.

## Correctness and scope

Source/test TypeScript builds on Mac and 1043 checks in 42 files on each
host cover
narrow/wide results, later widening, arbitrary precision, multidimensional
singletons, budgets, cancellation, slices, aliases and public mutation.
The full Euler 454 answer remains 5435004633092. Exhaustive audits were not
run. These controls justify the runtime change, not completion of Euler 454:
its array-oriented source candidate still needs acceptable reference RSS.

The investigation also exposed a pre-existing sum error: arbitrary host
polling could replace public storage while a sum retained the old buffer.
Commit 91572cef fixes that separately with checkpoint-then-read behavior in
host-observable scopes. Ordinary and Atomics-only execution retain the fast
buffer reduction.
