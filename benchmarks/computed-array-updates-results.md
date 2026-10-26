# Computed array updates

Baseline: `ce2942de` (isolated export and build). Candidate adds guarded numeric RHS/write fusion. Existing demos are unchanged.

Apple M5, Node v24.15.0. Each case uses one interpreter, three warmups and seven measured executions. Timings include execution, input allocation and oracle checks, and exclude process startup, imports and the initial RREF function declaration. Instrumentation runs separately. The baseline process ran before the candidate; no test suites or CPU profiling ran during measured executions. Raw samples and source hashes are retained.

```sh
node benchmarks/computed-array-updates.mjs --root=/path/to/baseline --samples=7 --instrument=true
node benchmarks/computed-array-updates.mjs --samples=7 --instrument=true
```

| Case | Workload | Before, ms | After, ms | Speedup |
| --- | --- | ---: | ---: | ---: |
| Divisor sieve | Table below 1000000, including final checksum | 91.77 | 40.36 | 2.27x |
| Totient sieve | Table below 200000, including final checksum | 192.68 | 177.53 | 1.09x |
| Real row updates | 255 updates of 1024 cells | 153.31 | 4.39 | 34.89x |
| RREF | Unchanged Deep-ML 48 function, 64 by 64 matrix | 181.10 | 15.74 | 11.51x |
| Euler 21 | Complete array demo, limit 1000000 | 506.51 | 448.33 | 1.13x |

The change benefits independent integer and real workloads. It does not provide a uniform speedup: the totient run still spends time interpreting thousands of short updates, and complete Euler 21 still includes the expensive final array comparisons and masks. The totient samples have a second, slower timing cluster, so its modest improvement should not be generalized into a large speed claim.

The large real improvement includes preserving Float64 storage through indexed updates. Instrumentation reports one typed-buffer unpack in each baseline real workload and none in the candidate. Fusion also avoids the temporary RHS and its subsequent snapshot. This table does not isolate those two contributions and does not measure peak memory.

## Applicability and semantics

Language analysis identifies pure numeric expression candidates and proves that the statement's return value is discarded by a later statement, including through enclosing loops and branches. A function declaration stops the proof. Final assignment and loop results remain on the ordinary evaluator.

The runtime accepts ready Int32/Float64 operands, compatible shapes and unique linear destination addresses. A source that shares the destination buffer must read the same logical cell or a disjoint byte span. Shifted overlaps, repeated addresses, arbitrary readers, callbacks and unclassified syntax keep the snapshot path. Division accepts a known nonzero scalar denominator.

The emitted kernel computes and writes each cell directly. Integer intermediates and results are guarded against int32 overflow. On widening, the completed prefix stays committed and the remaining cells use exact arithmetic without replaying that prefix. Nonfinite real results use the same tail and refresh scalar-kind evidence. Ownership, binding checks, cancellation checkpoints, debugger/host polling behavior and dynamic-code failures retain their existing paths.

Sieve instrumentation confirms 967 fused updates covering 5984470 cells. The totient fixture uses 445 fused updates; short slices keep their ordinary path. Real row updates fuse all 255 passes. RREF fuses 4096 row normalization/elimination updates over 262144 cells.

This does not eliminate the sieve's `K` arrays or compile the entire outer loop. No syntax or arithmetic-semantics changes were introduced.

## Verification

- TypeScript build and all 1481 language tests passed, including 16 new syntax/result-use checks.
- Ordinary interpreter suite: 8494 tests passed in 374 files, including 22 new fusion/storage/alias/result/cancellation checks. The separately scheduled type, differential and Nurikabe audits were excluded from this run.
- Semantic-boundary and application-form checks passed.
- Divisor checksums use an independent divisor/multiple counting formula; phi checksums use a JS totient sieve. Real rows use an independent scalar oracle. RREF verifies every returned element against the identity matrix to tolerance 1e-10. Complete Euler 21 checks the known answer 25275024.

Raw results: [baseline](baselines/2026-10-26-computed-array-before.jsonl), [candidate](baselines/2026-10-26-computed-array-after.jsonl). The benchmark contains the exact fixtures and deterministic inputs.
