# Euler 552: fuse independent modular vector updates

Base: `ed979324bfb84699a4b02a7341f151a3265a32b6`.
Full result at L=300000: **326227335**.

The CRT/Garner algorithm still updates residues and prime products over the
remaining primes, about 3e8 cells. The previous whole-loop compiler already
accepted this program, but traversed its arrays separately for adjacent updates:

```rank
A = (A + M * T) mod Q
M = M * P mod Q
```

These outputs both depend on the old M and neither depends on the other's new
binding. The Number loop now computes both in one private traversal, sharing
leaf reads and retaining its existing reusable buffer pool. It does not retain
another full table or introduce an ordinary helper-function boundary.

## General compiler change

Adjacent independent pointwise vector bindings may share a traversal. Supported
integer, real and Boolean expressions retain their existing scalar lowering,
checked arithmetic, broadcasting and output types. Dependencies, plain aliases,
indexing, calls, deferred names and structural operations stop a group. Outputs
with different lengths retain separate traversals. Unsafe arithmetic discards
the speculative loop and replays its original source order with exact values.
Cancellation and demand budgets decline the new path before private execution.
Ordinary `=` completion and alias contracts are preserved.

The Rank demo retains one explicit loop. `drop` replaces the temporary index
array used when trimming completed prefixes; names are clearer and every line
fits 40 columns. The search algorithm and the trim threshold are unchanged.

## Measurements

Node v24.15.0; Apple M5 arm64 and Intel i7-10750H x64. Three alternating
fresh-process pairs per mode and input; parsing/execution included, importing
the interpreter excluded. Each sample verifies the full answer or the actual
unchanged Rank fixture's assertions. RSS is process high-water memory.

| Host/mode | Old seconds | New seconds | Old peak MiB | New peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64, compiled | 4.295 | 3.515 | 183.4 | 180.5 |
| Mac arm64, reference | 22.819 | 22.675 | 635.1 | 627.6 |
| Intel x64, compiled | 10.887 | 9.591 | 180.0 | 182.7 |
| Intel x64, reference | 35.939 | 36.081 | 382.9 | 340.1 |

Intel compiled RSS ranges overlap: old 178.8-182.8 MiB, new 174.4-182.9 MiB.
Reference ranges overlap too: Mac old 617-639/new 609-641 MiB; Intel old
345-386/new 340-346 MiB. These medians do not prove a general reference memory
saving, and no compiled memory increase is distinguishable from this variation.
The unchanged fixture's compiled medians are 0.153 -> 0.146 s on Mac and
0.396 -> 0.370 s on Intel; reference 0.199 -> 0.192 and 0.557 -> 0.556 s.


Most speed improvement comes from the shared compiler traversal. Crossover
controls run the new source on the old runtime and the old source on the new
runtime; these are single samples, separate from the primary paired medians.
Mac controls: new source/old runtime 4.297 s, old source/new runtime 3.542 s.
Intel controls: 11.728 s and 10.131 s, respectively; these later single samples
were slower than the primary pairs, so use the paired table for speed claims.
Reference execution retains its existing arithmetic path; this change does not
remove the algorithm's quadratic residue work or accelerate it substantially.

Rejected prototype: a pure tuple-returning array helper took 2.78 s on Mac,
but raised peak memory to 681 MiB. Its compiler changes are not included.
Keeping the enclosing loop and its buffer pool avoids that regression.

## Verification

TypeScript build; 607 unique focused checks on each host, including the full
answer on Number, exact and reference backends. A separate literal BigInt CRT
construction verifies small bounds, including empty/no-stage cases. The L=10000
fixture crosses the prefix-trimming boundary. New compiler checks cover mixed
output kinds, different/empty geometries, saved aliases, dependency boundaries,
overflow/error order and observable budget fallback. Two filtered Mac
differential checks pass for the full demo and its fixture. The full demo is
restored to corpus execution. Exhaustive audits/full npm test were not run.

Paired compiled controls on unchanged neighbouring demos (three pairs each):

| Demo | Mac old/new seconds | Intel old/new seconds |
| --- | ---: | ---: |
| 549 | 2.182 / 2.159 | 5.863 / 5.863 |
| 550 | 0.214 / 0.214 | 0.558 / 0.549 |
| 551 | 0.232 / 0.234 | 0.601 / 0.615 |

These short-run differences are small; the raw samples retain their spread.
An early Mac 551 control was 0.235 -> 0.241 s. Avoiding needless purity walks
and command-suffix copies for scalar bindings reduced the final control to
0.232 -> 0.234 s. No numerical result changed.

```sh
node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
node benchmarks/euler552.mjs compiled
node benchmarks/euler552.mjs exact
node benchmarks/euler552.mjs reference
node benchmarks/euler552.mjs compiled fixture demos/euler/552_chineseleftovers2_test.ra
node benchmarks/euler552.mjs compiled 300000 benchmarks/fixtures/euler552-original.ra
```

`RANK552_RUNTIME` selects another built runtime. `RANK552_EXPECTED` checks a
golden answer; `RANK552_MODULE` selects the demo loaded by the actual fixture.
Diagnostics and profiles are separate opt-in runs. Raw measurements are in
`baselines/2026-11-09-euler552.json`.
