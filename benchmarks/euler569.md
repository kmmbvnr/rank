# Euler 569: private helper loops and exact product comparisons

Base: `57413f44b0d2fe99b6f13deb2ee894eae2685412`.
The full N=2,500,000 result is **21025060**. The original program is retained
in `fixtures/euler569-original.ra`.

## Program

The visibility algorithm keeps its prefix upper-hull links and strict slope
record tests. The primality setup now uses the existing compact `primesieve`
instead of a Rank odd-only integer sieve. This removes the large integer flag
array and its nested marking loop.

The Rank functions `predecessors` and `visible` each have one loop,
with no nested loops.
The hull walk advances a peak only when its stack stops popping. The visibility
walk switches between the hull existence query and the nearest visible peak
search. Peak coordinates and the current reference slope are ordinary scalar
bindings, updated only when their peak or reference changes. This reduces
indexed reads from eight to two per candidate comparison. Every Rank line
fits 40 columns. Zero or one peak returns zero.

Products are written directly, replacing manual 25-bit limb decomposition.
Their comparisons remain exact. A trial that skipped additional hull interiors
passed correctness checks but did not improve measurements and was removed.
A separate per-peak ranked-helper variant was slower and is not selected.

## Shared compiler changes

Both Number loop lowering and scalar helper lowering can compare integer
products without requiring each full product to fit safe Number precision.
The factors still have to be checked safe integers. IEEE multiplication rounds
monotonically: distinct rounded products establish the exact ordering. Safe
product values are exact too. Only equal rounded products outside the safe
integer range use BigInt for the final comparison. This
handles exact equality, adjacent huge products, signed values and zero without
an epsilon or a whole-loop replay. An unsafe factor retains normal exact replay.
Only products directly consumed by a comparison are contracted; ordinary
stored bindings retain their exact values and boundaries.

Backend preference now accounts for private array writes throughout a helper
call graph. Previously a scalar caller without its own indexed writes could
select an exact scalar call graph, bypassing an allocating callee's existing
private Number loop backend. The same preference already applied to direct
writes; it now uses the existing transitive effect proof. Functions that directly track containers, recursive functions
and explicit native-completion cases retain their previous entry rules. No syntax,
Number thresholds or array ownership contracts changed.

## Measurements

Node v24.15.0 on Apple M5 arm64 and Intel i7-10750H x64. Fresh serial child
processes on each host; no overlapping benchmarks from this investigation on
the same host. Each sample checks the answer. Time includes parsing/execution,
excluding importing the interpreter; RSS is the process high-water mark.
Diagnostics and profiling are disabled in the primary samples. Host load is
recorded; it does not prove an idle machine.

The original full compiled program and original compiled/reference N=100,000
have one sample per host/mode. New full compiled and compiled/reference
N=100,000 have three samples each, as do new-source/old-runtime compiled
N=100,000 controls. New exact N=100,000 has one sample per host. Reported
repeated values are medians; single controls are labeled explicitly.

| Host / N=100,000 mode | Old s (one sample) | New median s | Old RSS MiB | New median RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| mac / compiled | 0.772 | 0.333 | 216.6 | 197.6 |
| mac / reference | 78.725 | 38.987 | 203.4 | 192.1 |
| intel / compiled | 1.913 | 0.791 | 227.9 | 190.9 |
| intel / reference | 199.500 | 99.332 | 196.5 | 183.7 |

| Host / full compiled N=2,500,000 | Old s (one sample) | New median s | Old RSS MiB | New median RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| mac | 47.906 | 11.019 | 827.4 | 471.1 |
| intel | 112.384 | 25.078 | 739.8 | 442.7 |

Running the new program on the old runtime, compiled N=100,000:

| Host | Old runtime median s | New runtime median s | Old runtime RSS MiB | New runtime RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| mac | 0.737 | 0.333 | 192.2 | 197.6 |
| intel | 1.704 | 0.791 | 181.2 | 190.9 |

The shared compiler changes roughly halve compiled fixture time on the new
program. These controls use about 5 MiB more RSS on Mac and 10 MiB more on
Intel; all original/new workload pairs in the first two tables use less RSS.
Reference improvements come from the program rewrite. The full new program
was not timed on the old runtime, so the fixture control is not extrapolated.

Single N=100,000 samples with Number loops disabled:

- mac: 1.652 s / 192.0 MiB, same exact result.
- intel: 4.112 s / 183.6 MiB, same exact result.

A control with equal small products runs ten million comparisons. Three
alternating fresh-process pairs per host include parsing and execution:

| Host | Old ms | New ms | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| mac | 103.567 | 105.294 | 142.0 | 142.2 |
| intel | 252.403 | 249.311 | 133.4 | 133.1 |

Safe products retain Number comparison; only wide rounded ties need BigInt.
Compiled samples and samples with Number loops disabled were repeated after
the final change to code generation. Nine unchanged-path samples per host
(reference and old-runtime controls) are reused from the same base series.

One-minute load before/after the primary samples:

- mac: 2.60–4.15.
- intel: 0.08–1.17.

Full reference N=2,500,000 is not included in the ordinary corpus lane.
Reference improvement is measured at the existing N=100,000 fixture, while
full compiled results are checked separately. Do not extrapolate fixture
speedups into a measured full reference time.

## Verification

Passed on both hosts: 239 focused tests in 17 files, covering the new product
comparisons, transitive backend preference, Euler 569, scalar kernels,
private function prefixes, return seeds, stored-array helpers, captured lengths,
modular products, wide bitwise operations, binding cells, pointwise fusion,
tensor shapes and buffer retention. The Euler tests compare three
backends against an independent all-pairs visibility scan at 0, 1, 2, 3, 8, 9, 20,
100 and 500 peaks. The oracle generates primes by trial division and uses exact
BigInt cross products; it does not use a hull. N=100,000 retains 650364.

The comparison tests cover all six relations, positive/negative/zero factors,
rounded product ties whose exact values differ by one, deterministic generated
safe factors, ordinary scalar helpers, and replay when a factor becomes unsafe.
The transitive allocation test checks the Number loop path and reference result.
An ordinary wide-product binding retains its exact value and publishes preceding
array stores once.

TypeScript build passed; filtered fixture differential checks passed on both
hosts (69 s Mac, 242 s Intel), with fixture type/name-fact checks on Mac and
five exclusion-policy checks. Exhaustive audits/full npm test were not run.
Raw samples: `baselines/2026-11-10-euler569.json`.

## Reproduction

```sh
node benchmarks/euler569.mjs compiled
node benchmarks/euler569.mjs reference 100000
node benchmarks/euler569.mjs exact 100000
node benchmarks/euler569-comparison.mjs
node benchmarks/euler569.mjs compiled 2500000 benchmarks/fixtures/euler569-original.ra
```

`RANK569_RUNTIME` selects a built runtime, `RANK569_EXPECTED` checks the result,
`RANK569_DIAGNOSTICS=1` enables counters, and `RANK569_PROFILE=path` writes a
separate CPU profile. Diagnostic/profile samples are not primary timings.
