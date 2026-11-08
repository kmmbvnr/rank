# Euler 522: stream falling products and batch inverses

The file keeps its existing `522_hiddenchains` module name, but the title is
corrected to the official **Hilbert's Blackout**. The full answer remains
**96772715** at N=12344321 modulo 135707531. The official values F(3)=6,
F(8)=16276736 and F(100) mod 135707531=84326147 are retained.

## Diagnosis and program

The existing formula is unchanged. For 2<=m<=n-2, each term is

```
n! / (m! (n-m)) * (m-1)^m.
```

The old program formed factorial and inverse-factorial arrays of length N,
then constructed several complete arrays of coefficients, powers and terms.
The compiled loops already run quickly. The reference evaluator still pays
for roughly 2*N scalar factorial iterations, and the complete arrays increase
peak memory.

Set d=n-m. The coefficient is a descending product n!/m!, divided by d.
Stream d in blocks of 65536. A modular product scan computes the descending
weights, carrying only the final product between blocks. Each block's divisors
are inverted together: one modular exponentiation inverts their product,
a backward product scan supplies inverse prefixes, and multiplying shifted
forward/backward prefixes gives every 1/d. The modulus is prime (also checked
by exhaustive trial division through its square root) and the intended
0<=N<Mod domain makes all block divisors units. This retains the original
Fermat-inverse assumption.

There is one explicit block loop, existing array scans/reverse/take/drop and
powmod, and no full factorial table. All Rank lines fit within 40 columns.
The program additionally returns zero for N=0,1,2. Block boundaries do not
change the sum: tests use blocks of seven to exercise carries and short final
blocks with small independent oracles. Exploratory 16K/64K blocks were nearly
equivalent; 256K/1M blocks used more memory without a speed improvement on Mac.
This is a local working-set choice, not a change to global compiler thresholds.

## General compiler fixes

Number regions now compile modular product scans as well as sums. They use
the existing exact low-word modular multiplier through modulus 2^31, including
composite moduli, negative inputs/seeds, seeded axes and empty dimensions.
Unbounded integer products and larger/invalid moduli retain their existing
exact/error paths. No floating-point product is assumed exact when it can
exceed the safe integer range.

Completed integer/real/boolean arrays can also use `reverse` inside a Number
region. Leading-axis cell blocks are copied into fresh private storage; trailing
axes keep their order. Ordinary `=` boundaries and retained aliases remain
snapshots. Bare sequence ranges, named/table/order metadata, shadowed functions
and observable demand budgets keep their existing evaluation behavior. The
initial guard for multidimensional integer input needed the vector-region flag
before lowering the input; tests cover that admission as well as the values.

## Verification

An independent graph oracle enumerates every legal outgoing wiring and every
Hamiltonian cycle through N=6, minimizes the number of changed edges, and sums
the minima. A separate exact BigInt factorial-division formula checks 28 inputs
through N=1000. It uses no modular inverses, prefix scans or block carries.
The Rank demo is checked against it in reference, exact-loop and Number modes,
including block boundaries, zero/one/two inputs and official statement values.
The existing fixture remains in all three modes.

New compiler tests cover modular products at small, composite and 31-bit
moduli, varying multidimensional lanes, zeros, negative and wide cells/seeds,
errors, retained values and budgets; reverse tests cover shape/order, integer,
real, boolean and empty arrays, signed zero/NaN, wide storage, source errors,
shadowed bindings, metadata and warmed functions under budgets.

The selected 19-file regression run on each host has **549 passes and one
preexisting Number-counter failure out of 550**. Three later nonuniform-lane
product checks pass separately on both hosts (72/72 in that product file).
The unchanged failure is `number-loop-slice: fuses a discarded slice transform
with mod`, already reproduced on clean baselines during Euler 519/521; its
value/error comparisons pass. Source/test TypeScript builds and whitespace
checks pass. No exhaustive corpus/type/name audit or full package suite ran.

## Full-scale measurements

Node v24.15.0. Compiled figures are medians of three alternating original/final
fresh-process pairs, with diagnostics off. Baseline runtime is frozen commit
`2e9223c7`; the original source is retained. Own CPU workloads did not overlap
within these comparisons. The early Mac reference observation that overlapped
a short test startup was discarded and repeated cleanly. Reference and
source-only controls below have one sample each.

| Host / mode | Before | After | Peak RSS before / after |
| --- | ---: | ---: | ---: |
| Mac / compiled | 2.086 s | 2.294 s | 753 / 181 MiB |
| Intel / compiled | 4.741 s | 4.556 s | 597 / 171 MiB |
| Mac / reference | 17.244 s | 2.138 s | 1024 / 256 MiB |
| Intel / reference | 48.088 s | 4.324 s | 681 / 265 MiB |

**The Mac compiled run is approximately 10% slower.** This is a measured
tradeoff: compiled peak RSS falls by about 76% on Mac and 71% on Intel, while
reference execution improves by about 8.1x and 11.1x respectively. The Intel
compiled run improves by about 4%; this is a small gain, not a large speed claim.
Do not describe this rewrite as an across-the-board compiled speedup.

New source with the frozen compiler takes 2.189 s / 258 MiB on Mac and
4.409 s / 241 MiB on Intel. The shared compiler additions mainly remove the
extra publication/allocation costs: the final private region peaks near
181/171 MiB, but is a little slower than those single-run source-only controls.
The main wall-time win comes from replacing reference scalar factorial loops
with existing native array scans and bounded batches.

Every full run returns 96772715. Source hashes, CPU times, individual pairs,
controls and exploratory block sizes are retained in
`baselines/2026-11-09-euler522.json`.

The full main and original fixture pass scoped differential execution on both
hosts: two completed programs, one passing embedded test, two Number-loop
entries. The historical full-main exclusion is removed. Matching errors are
not counted as successful fixture checks.

## Reproduction

```
node benchmarks/euler522.mjs compiled
node benchmarks/euler522.mjs reference
node benchmarks/euler522.mjs compiled 100
```

An optional final argument chooses a source file; the original is
`fixtures/euler522-original.ra`. `RANK522_RUNTIME` selects a frozen interpreter
`out/index.js`; `RANK522_EXPECTED=96772715` checks the full answer.
`RANK522_DIAGNOSTICS=1` or `RANK522_PROFILE=/tmp/euler522.cpuprofile` enables
separate diagnostic/profile runs; leave both off for timing comparisons.
