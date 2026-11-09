# Euler 559: reciprocal series and shared transform ordering

Base: `dd401154646974c76ee20dcf059773eb30732c27`.
The [problem](https://projecteuler.net/problem=559) counts permuted matrices
with prescribed simultaneous column ascents. Full answer: **684724920**
modulo 1000000123. The statement fixture remains unchanged.

## Program

The inclusion-exclusion formula is retained. With u(j)=(j!)^-N modulo Mod,
F_k(z)=sum_j (-1)^j u(j*k) z^j has constant coefficient 1. Its reciprocal
supplies the answer for a whole number of k-column blocks. A final dot product
handles the remainder. The old implementation computes each reciprocal by
quadratic recurrence, visiting about two billion product cells at N=50000.

Long reciprocals now double their known prefix with modular convolution.
If G is correct modulo z^h, write the high part of F*G-1 as z^h E. The next
prefix is G-z^h*(G*E), truncated to the requested length. The already correct
low coefficients need no correction. Recursion has logarithmic depth.

Short reciprocals are grouped by the common quotient floor(N/k). Every group
has the same number of recurrence rows, so one loop advances all its columns
with array operations. The demo has one explicit loop and no nested loops.
Empty quotient groups are skipped. The local cutoff is 64, at the existing
schoolbook convolution boundary of 4096 products; exploratory cutoffs 16, 32,
64 and 128 favored 64/128 over the smaller batches. This is a demo choice,
not a compiler admission threshold. Modular factorial scan replaces the
scalar factorial-building loop. All Rank lines fit within 40 columns.

## Shared backend

The native modular convolution backend now pairs forward decimation in
frequency with backward decimation in time. Both operands and their pointwise
product use bit-reversed frequency order. Separate bit-reversal passes are
therefore unnecessary. Unit twiddles also need no multiplication. The final
output is still in natural coefficient order, with the same exact scaling.

This changes shared TypeScript runtime code, not the JavaScript emitter or
language syntax. It helps both compiled and reference execution. Workspace
counts, sizes, root-cache policy, modular multiplication, schoolbook dispatch,
CRT reconstruction and cooperative stage checkpoints are unchanged.

## Measurements

Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64. Every full sample checks
the exact answer. Old source/runtime values are **one full control per mode**;
new values are medians of three fresh processes. New-source/old-runtime and
final runs alternate in pairs. Diagnostics/profiling are disabled for timings.
Time includes parsing/execution and excludes importing the interpreter; RSS is
the process high-water mark. No other benchmark was run by this session on the
same host at the same time. Intel load snapshots included our own Node process.

| Host/mode | Old seconds | New seconds | Old peak RSS MiB | New peak RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 78.866 | 2.335 | 603.2 | 489.8 |
| Mac reference | 26.742 | 2.220 | 1054.9 | 512.7 |
| Intel compiled | 167.736 | 5.999 | 591.3 | 444.1 |
| Intel reference | 100.122 | 5.607 | 681.6 | 471.0 |

Most improvement comes from the algorithm. With the new source and old backend,
three-process medians are 2.559/2.444 seconds (Mac compiled/reference), and
6.382/5.949 seconds (Intel). The backend contributes another 6-9% on the full
program. Same-source process RSS is slightly higher after the backend change:
473.1/504.0 to 489.8/512.7 MiB on Mac and 442.0/457.7 to 444.1/471.0 MiB on
Intel. The transform adds no buffers; this does not establish a same-source
RSS reduction. Compared with the original program, all four measured peaks
are lower. Baseline controls are single samples, so speedup ratios are approximate.

A separate native convolution driver isolates direct-prime and CRT transforms
at lengths 5000 and 50000, with three alternating fresh-process pairs. It checks
output checksums against the old implementation. Mac medians improve from
3.888 to 3.094 ms (5000, direct prime), 37.496 to 31.171 ms (50000, direct),
and 119.303 to 96.712 ms (50000, CRT). Intel medians improve from
6.560 to 5.292 ms, 59.132 to 50.680 ms and 187.831 to 154.460 ms, respectively.

The original compiled program is slower than its reference control at full
scale. A bounded diagnostic run reaches compiled numeric loops, whereas
reference execution uses bulk array operations. The rewrite removes that
quadratic workload; it does not claim to fix every compiler route for the old
source. The shared change here is specifically the convolution backend.

## Verification

TypeScript build; 231 focused Euler 559, convolution, Euler 537 and compiled-array
operation checks on each host; two filtered differential checks on each host
for the full demo and fixture; two filtered type and two name-fact checks on Mac. The independent small-input oracle enumerates
inclusion-exclusion subsets of column boundaries, without reciprocal series.
Tests vary the batch cutoff, exercise odd/even reciprocal lengths, compare the
old recurrence through 500, and check the full result with compilation enabled,
disabled and Number-loop compilation disabled. Sparse asymmetric endpoint tests
cover natural output ordering across transform boundaries, both direct and CRT.
Existing tests cover signed/extreme residues, squares, composite moduli, warm
roots, demand budgets and unchanged input buffers. See the issue result comment
for the final host-specific check counts. No exhaustive audit/full npm test.
The full demo is restored to ordinary corpus execution.

```sh
node benchmarks/euler559.mjs compiled
node benchmarks/euler559.mjs reference
node benchmarks/euler559.mjs compiled 50000 benchmarks/fixtures/euler559-original.ra
node benchmarks/euler559-convolution.mjs 50000 1000000123
```

`RANK559_RUNTIME` selects a built interpreter, `RANK559_EXPECTED` checks the
answer, and `RANK559_DIAGNOSTICS=1` / `RANK559_PROFILE=path` enable separate
instrumented runs. `RANK559_CONVOLUTION` selects the native convolution module.
Raw full/control and native samples are in `baselines/2026-11-10-euler559.json`.
