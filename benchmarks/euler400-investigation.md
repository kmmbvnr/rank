# Euler 400 initial investigation

Base: `f1b59a0d`, Node v24.15.0, Apple M5 arm64 and Intel i7-10750H x64.
This section records the initial investigation before the production changes.
The delivered implementation and controlled measurements are in
[euler400-followup.md](euler400-followup.md). Issue #447 still lists Euler 400 as
unfinished. These are exploratory individual samples, not controlled medians;
some runs overlap other investigation work. Raw diagnostics are retained in
`baselines/2026-11-04-euler400-investigation.json`.

## Findings

The original program already compiles its explicit work-stack search. The
full input writes 16,734,773 memo entries and reads the index 33,469,547 times.
There are no COW array copies in that run. A K=3000 CPU attribution probe shows
`directLeaf`, stack push/pop, array readers, index writes and garbage collection
among its main frames. Replacing the cache is a larger opportunity than
removing copies that do not occur.

Only two preceding layers are needed by the recurrence. Define `D_n[j]` as
the count for target `j-1`; slot zero is the sentinel count one. With
`A = 1 + Gs[n-1]`, `B = 1 + Gs[n-2]`, and `Ts = 0..Stride-1`:

```
D_n = concat [1] ((D_(n-1)[Ts xor B] + D_(n-2)[Ts xor A]) mod Mod)
```

The initial layers preserve the original special cases n=0,1,2. Stride is a
power of two strictly greater than every `1 + Gs[n]`; therefore XOR indices
remain inside the stored domain. The extra final slot is harmless. This
computes about 81.9 million row cells instead of the sparse search's 16.7
million states, but removes hashing, memo retention and explicit work stacks.
The two source variants preserve K=10000, Mod=10^18 and the original Grundy
construction. Full answer: `438505383468410633`.

| Full K=10000 | Mac seconds / peak MiB | Intel seconds / peak MiB |
| --- | ---: | ---: |
| Original compiled sparse DP | 8.942 / 1183.8 | 20.041 / 1162.8 |
| Original reference sparse DP | 239.681 / 2889.3 | not measured |
| Rolling array expression, compiled | 3.994 / 414.2 | 11.224 / 312.0 |
| Rolling array expression, reference | 3.973 / 409.3 | 12.095 / 308.5 |
| Preallocated scalar 3-row Rank DP, compiled | 9.889 / 195.5 | not measured |
| Hand JS with three BigInt64Array buffers | 0.411 / 51.8 | 0.709 / 53.8 |

The hand JS is an opportunity probe, not a compiler patch or a production
runtime-equivalent benchmark: it excludes parser, module initialization,
language guards, cancellation, budgets and diagnostics. It performs the same
row recurrence and exact integer additions. Its counts and sums fit signed
64-bit storage; they do not fit safe Number integers. Address arithmetic can
use Number while counts remain exact. A blanket Number conversion is invalid.

Original reference K=1000: 2.588 s / 470.9 MiB. Full original reference also
returns the golden answer in 239.681 s / 2889.3 MiB. The rolling expression
therefore removes a major reference cost as well as the compiled cache cost.
These remain individual samples rather than a controlled speedup estimate.

## Compiler opportunity

The rolling expression currently has zero compiled tensor counters. Native
array primitives still perform bulk work, explaining the similar compiled and
reference times. Diagnostics report 70,001 typed publications and 573,485,326
published cells. These counts describe total traffic, not live memory. Actual
peak memory is much larger than three 8193-cell int64 buffers.

Useful general compiler work is a single checked pass for XOR selector maps,
gathers, addition, modulo and concat at the ordinary assignment completion
boundary, followed by safe reuse of a dead row buffer. The IR already supports
bitwise tensor nodes; this is not a proposal for a special Euler native helper.
The existing path must still prove shape, builtin identity, bounds, exact
integer arithmetic and snapshot/alias semantics. Current diagnostics include
`tensor:output-shape`; the scalar-function proof also rejects the local array
construction (`unsupported-op:till`). Removing one rejection alone does not
establish a valid fused function.

The scalar 3-row version shows why simply rewriting array code as loops is not
the desired final answer: it reduces memory but loses speed. Retain the array
expression as the preferred demo candidate; investigate fusion independently
and measure its memory rather than assuming the hand-JS allocation profile.

## Rejected experiment

Starting with a narrow target domain and padding rows when the whole-tree
Grundy values grow is incorrect: the distributions of cut results outside the
old domain can already be nonzero. At K=10000 this produced
`615785317596232493`, not the expected answer. No such adaptive-width code is
included in the candidate. Do not infer a target-support bound from whole-tree
Grundy values alone.

## Verification and reproduction

Original `fibonacci-tree.test.ts`: 2 tests pass, including the independent
small-game oracle. The experiment verifier passes 131 comparisons across 22
orders (0..10, 15,30,63,64,65,99,100,127,128,129,1000), original/array/scalar
sources and both execution modes; scalar reference K=1000 is omitted. Full
array and scalar candidates reproduce the golden full answer; Intel array
runs do so in both modes. No full test suite or exhaustive audit was run.

From the repository root after building:

```
node benchmarks/experiments/euler400-verify.mjs
node benchmarks/euler400-followup.mjs demos/euler/400_fibtree.ra 10000
node benchmarks/euler400-followup.mjs benchmarks/experiments/euler400-rolling.ra 10000
node benchmarks/euler400-followup.mjs benchmarks/experiments/euler400-rolling.ra 10000 reference
node benchmarks/euler400-followup.mjs benchmarks/experiments/euler400-scalar.ra 10000
node benchmarks/experiments/euler400-hand.mjs 10000
```

Optional `PROFILE=/tmp/euler400.cpuprofile` enables CPU attribution in the Rank
harness. Profiling runs should not be included in a controlled timing series.
