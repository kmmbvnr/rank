# Euler 364 investigation

Historical investigation before the production fixes. Delivered changes and
current verification are in [euler362364-delivery.md](euler362364-delivery.md).
At investigation time, 362 had already been researched and 364 was the next
previously uninvestigated entry by number.

## Result

The issue's historical 88.8 s figure is not representative of today's compiler.
The unchanged full input now takes 0.456 s on the Mac and 0.963 s on Intel.
The algorithm is already linear. There are nevertheless useful improvements
in both the formula and a general compiler path.

All full runs below return **44855254** for N=1000000, Mod=100000007.
The [official problem](https://projecteuler.net/problem=364) supplies the
independent examples T(10)=61632 and T(1000) mod 100000007=47255094.

Three fresh-process samples per row; time includes parsing, preparation and
execution, after importing and constructing the interpreter. RSS is the median
of whole-process peak RSS, including imports. Node v24.15.0 on both machines.
The clean built interpreter is commit 836d84ff; subsequent main commits at the
start of this investigation only added demos. The shared working tree's
unrelated interpreter edits were deliberately excluded.

| Variant | Mac time | Intel time | Mac peak RSS | Intel peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Original, compiled | 0.456 s | 0.963 s | 206.7 MiB | 202.8 MiB |
| Original, compiler mulmod prototype | 0.268 s | 0.531 s | 199.2 MiB | 194.9 MiB |
| Simplified formula + scans, compiled | 0.209 s | 0.464 s | 201.9 MiB | 192.2 MiB |
| Simplified formula + scans, reference | 1.658 s | 4.278 s | 205.5 MiB | 187.1 MiB |
| Array terms + scans, compiled | 0.259 s | 0.538 s | 218.3 MiB | 199.5 MiB |
| Array terms + scans, reference | 0.317 s | 0.664 s | 253.7 MiB | 237.3 MiB |

Original reference on the Mac: median 13.387 s and 458.6 MiB (three additional
unprofiled processes). The earlier profiled sample was 11.932 s / 467.9 MiB;
it is not used as the comparison baseline. Intel reference is 39.705 s / 431.2 MiB, also a three-process median.
Raw samples are in `baselines/2026-11-03-euler364-investigation.json`.

These are whole-program cold timings, not just the numeric loop. In particular,
parser/module preparation is a meaningful part of the fastest rows.

## Algorithm

The original implementation precomputes factorials, inverse factorials and
powers of two. It then sums four groups of terms. It does not enumerate
seating permutations, so an exponential search is not the cause of its cost.

For the current variables, each summand is

```
choose(K-1, P) * 2^P * K! * (P+E)! * (K-1)!
```

Expanding the binomial and cancelling P! gives

```
(K-1)!^2 * K! / (K-1-P)! * 2^P
  * (P+1) * ... * (P+E)
```

Here E is only 0, 1 or 2. This removes the binomial helper call, the inverse
factorial lookup at P, and the factorial lookup at P+E. The mathematical
precondition remains a prime modulus greater than N, as assumed by the
original Fermat-inverse construction. This is not a new arbitrary-modulus
implementation.

The groups (A=1,B=1) and (A=2,B=0) have identical L and E. They can be summed
once and doubled. The four (A,B) combinations become three S=A+B groups:

| S | L | E | multiplicity |
| --- | --- | --- | --- |
| 1 | N-1 | 0 | 1 |
| 2 | N-2 | 1 | 2 |
| 3 | N-3 | 2 | 1 |

The asymptotic cost stays O(N), with about one quarter fewer summands and
less work in each summand. The improvement is a smaller exact formula,
not a different search algorithm.

The existing modular `scan * with seed mod Mod` operation replaces all three
precomputation loops. Descending products seeded with the inverse of N!
produce the inverse factorial table, then `reverse` puts it in index order.
This uses existing language/library behavior in both engines.

## Array style and memory tradeoff

`experiments/euler364-array.ra` computes the terms of each of the three groups
as arrays. The only remaining explicit loop has three iterations. It is close
to the scalar compiled variant, and its reference execution uses efficient
native array operations rather than hundreds of thousands of AST iterations
and helper calls.

Compared with the scalar simplified variant, the array version costs about
12-16 MiB additional compiled peak RSS on the Mac and 48 MiB reference RSS.
Compared with the original, its reference memory is still much lower. This
tradeoff should be explicit when selecting the production rewrite.

The scalar variant is the fastest measured compiled program. The array variant
is the strongest candidate if the goal is a compact array-oriented demo with
fast execution in both engines. The unused original `bin` declaration is left
in several measurement snapshots to isolate the formula change; a production
rewrite should remove it.

Two deferred-stage experiments were worse on the Mac (single exploratory runs):

| Variant | Compiled | Reference | Compiled peak RSS |
| --- | ---: | ---: | ---: |
| All term stages deferred | 1.531 s | 2.068 s | 405.7 MiB |
| Stored indices, deferred later stages | 0.493 s | 0.865 s | 327.7 MiB |

Diagnostics for the fully deferred version show 19 million computed cells and
54 typed-buffer publications. The current paths repeat deferred work and
materialize stages. This does not justify silently caching primed variables:
recomputation is their explicit contract. A compiler may instead connect pure
stages to a consumer while retaining demand/error semantics and ordinary `=`
boundaries. That larger fusion change was not implemented in this research.

## General compiler gap

`compileScalarNumberKernel` in
`packages/interpreter/src/jit/scalar-function-kernel.ts` lowers an integer
`A * B mod M` by first lowering `A * B` with a safe-integer guard. Some products
of residues exceed Number's exact integer range even though the residue is
small. The function then falls back to the exact kernel, and an enclosing
Number loop may replay exactly.

The general Number-loop implementation already supports exact modular
multiplication with operand normalization and a checked modulus domain. The
scalar-function Number backend does not reuse that lowering.

The research patch in `experiments/euler364-mulmod-prototype.py` applies that
same numeric idea to a disposable built interpreter. For integer products and
0 < M <= 2^30 it normalizes the operands and uses the existing exact `multiply`
primitive. Unsupported moduli replay exactly. It does not change precision
rules or optimize across a stored ordinary assignment such as `P = A * B`.

At N=10000 the original has 73 Number-function fallbacks/skips and an enclosing
Number-loop overflow. The prototype has zero of each and directly links the
buffer-consuming helper. The full original improves by 1.70x on the Mac and
1.81x on Intel. This is a useful generic compiler fix even if the demo rewrite
eliminates this particular helper.

Before production delivery, implement it in TypeScript using a shared checked
modular multiply rather than duplicated guards, and add focused regression
coverage for the scalar-function path and its enclosing-loop replay behavior.
The Python patch is a reproducible experiment, not a production patch.

## Rejected allocation experiment

`experiments/euler364-residues-prototype.py` attempts to borrow an existing
normalized Int32 input during synchronous modular folds/products instead of
copying it into a residues buffer. Three Mac array-program samples give
0.267 s compiled / 217.9 MiB, 0.323 s reference / 248.6 MiB. The speed is
slightly worse and the memory gain is small. It is not a justified next change
on this evidence, and has not been tested on Intel.

## Verification and scope

`euler364-verify.mjs` performs 136 checks per runtime/host: four program variants,
both engines, N=1..12 against an independent seat-mask enumeration, and
N=20,30,100,200,1000 against an exact factorial/binomial formula without modular
inverses. Both the original and the compiler prototype passed on Mac and Intel.
All timed full-input runs preserve the original full answer.

`euler364-mulmod-verify.mjs` adds 987 focused arithmetic checks for the compiler
prototype on each host: signed/zero operands, safe-integer boundaries, unsafe integer
arguments, positive moduli on either side of 2^30, negative moduli, randomized
safe inputs and division by zero. These are research checks, not a claim that
the package or exhaustive audits have been run.

The investigation phase did not modify production source. The linked delivery
report records the subsequent implementation; shared unrelated edits were preserved.

## Reproduce

```
RUNTIME=file:///path/to/clean/packages/interpreter/out/index.js \
  node benchmarks/euler364-investigation.mjs original 1000000
RUNTIME=file:///path/to/clean/packages/interpreter/out/index.js \
  node benchmarks/euler364-investigation.mjs array 1000000 reference
RUNTIME=file:///path/to/clean/packages/interpreter/out/index.js \
  node benchmarks/euler364-verify.mjs
```

`DIAG=1` enables counters, `PROFILE=/tmp/profile.json` records a CPU profile,
and `KERNELS=/tmp/kernels.txt` saves generated loop code. `PHASES=1` inserts
measurement prints and should not be enabled for the normal series.

Copy a clean built interpreter `out` directory and its module resolution into
a disposable location before running either Python prototype patch. Never
patch the production `out` directory. Then set RUNTIME to that copy and run the
same benchmark/verifiers. `experiments/euler364-series.mjs` alternates baseline,
compiler prototype and demo variants for three passes in fresh processes.
