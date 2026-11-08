# Euler 518: compiled sequence membership and packed reference masks

The full result remains **100315739184392** for `N=100000000`; the statement
fixture remains **1035** for `N=100`. The main demo is removed from differential
execution exclusions. The original source is retained as a benchmark fixture.

## Diagnosis

The existing parameterization already avoids enumerating arbitrary prime
triples. For coprime positive `Left < Right`, it enumerates

```
First+1  = Scale * Left^2
Middle+1 = Scale * Left * Right
Last+1   = Scale * Right^2.
```

It tests `Last` first, expands only surviving scales against coprime left
parameters, then filters `First` and `Middle`. Even scales cover odd primes.
An odd scale can only give `First=2`, hence `Scale=3`, `Left=1` and an even
right parameter. This mathematical enumeration is unchanged.

The historical issue entry says about 32 seconds. The current frozen baseline
is faster already: initial observations were 6.96 seconds on Mac / 18.55 on
Intel. The remaining cost is mainly execution and allocation, not a new
combinatorial algorithm to discover. At `N=1000000`, the original source
computes 353951 reference cells, enters no compiled loop and executes 1549
tensor kernels. The first loop rejection is `indices`: the Number backend can
lower positions already, but cannot type or lower their sequence-membership
predicate. Reference `in` also builds a boxed boolean array before packing it.

## General runtime and compiler changes

Runtime-created sequence membership proofs can now offer a safe Number reader.
The same captured `contains` and `iterate` descriptors guard both readers;
a matching name or a host-supplied callback grants no proof. Other certified
sequences retain exact BigInt membership through an adapter. `primesieve`
provides direct access to its existing odd-only bitmap, with exact lower/upper
bounds clamped to its finite domain before Number conversion. No second prime
index or hash set is built.

Number regions lower scalar and shape-preserving array `in` / `not in` against
these certified external sequences. Membership composes with numeric array
expressions, named boolean stages, positions, gathers and reductions. Input
arrays and intermediate integer arithmetic keep the existing safe-integer
checks and exact replay. Entry rebinds the domain reader and rechecks its proof;
a changed name or an untrusted plan falls back to ordinary evaluation. This
does not turn stored array domains or arbitrary callbacks into certified
sequences. An ordinary binding of bounded `primes`/`fibonacci` completes them
as an array; builtin source values remain available without that binding.

Reference execution also uses the proof for completed compact integer storage
and native views without pending checks. It fills the final bitmap directly,
avoiding boxed keys and the temporary JS boolean array. Numeric values are
still tested individually; the loop polls cancellation. Inspection, demand
budgets, opaque host polling, unknown headers, checked views, noncompact data
and untrusted membership retain the ordinary reader path and its error timing.

The final full diagnostic run enters one Number loop, computes zero reference
cells and reports zero Number overflows. Small setup stages still use three
tensor kernels. These counters come from a separate diagnostic observation,
not the headline timed samples.

## Source changes

Candidate positions construct even scales only after `Last` passed its
primality filter. This avoids completing separate full-sized scale and last
candidate arrays in the compiled region. Names describe the three primes,
scale, coprime parameters and selector stages. The source retains one explicit
loop, uses array operations inside it and fits 40 columns per Rank line.

Two equivalent source variants were compared in alternating pairs on both
hosts. Reconstructing scales from surviving positions saves about 50 MiB and
is slightly faster than retaining the complete candidate arrays. A simple
lazy-name candidate was rejected: it still encounters the separate loop-local
deferred-binding limitation, takes 10.26 seconds / 852 MiB on Mac and never
enters the Number loop. No check was removed to force that candidate to compile.

The compiler improvement supplies the main speedup. On Mac, the original source
with the new compiler (before the reference mask change) takes **2.00 s /
423 MiB**. The final source on the old runtime takes **7.19 s / 774 MiB**;
rewriting the demo alone does not reproduce the gain.

## Measurements

Node 24.15.0, Apple M5 and Intel i7-10750H. Old source/runtime are frozen at
`f4d43d8b`. Three alternating old/new compiled pairs per host, each a fresh
process, with diagnostics disabled. Values are medians; RSS is whole-process
peak RSS including startup, parsing and V8 collection policy.

| Host | Old compiled | New compiled | Old peak RSS | New peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 | 6.848 s | 1.936 s | 894.5 MiB | 374.7 MiB |
| Intel i7 | 18.935 s | 4.408 s | 701.4 MiB | 372.7 MiB |

Old/new ranges are 6.748–7.077 / 1.898–1.982 seconds on Mac and
18.457–19.133 / 4.378–4.451 seconds on Intel. Before the Intel pairs, load
averages were 0.22/0.30/0.22, 0.76/0.42/0.26 and 0.91/0.49/0.29. No other
benchmark or test suite of ours ran on the measured host concurrently.

Single reference observations, not medians:

| Host | Old reference | New reference | Old peak RSS | New peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Apple M5 | 6.136 s | 3.086 s | 901.6 MiB | 862.2 MiB |
| Intel i7 | 16.234 s | 8.216 s | 695.3 MiB | 401.3 MiB |

Reference execution still creates other eager array intermediates. Its Mac
peak RSS falls only slightly; do not claim that all reference allocations are
removed or generalize GC behavior across CPUs. Compiled peak RSS improves
substantially on both hosts. Raw observations, source hashes, variant comparisons
and the full diagnostic snapshot are in the baseline JSON.

## Verification

- **319 focused interpreter tests pass on both hosts**, covering the demo,
  stored/native sequence membership, vector arithmetic, positions, selectors,
  callback behavior, bounds, replay and existing scalar membership. The Intel
  test checkout initially lacked `classic/queens.ra`; after copying the same
  tracked fixture, all 16 tests in `indices.test.ts` pass there too.
- Independent enumeration of prime `First < Middle`, solving exactly for
  `Last`, agrees at **43 small limits in three execution modes**: default,
  compilation disabled and Number-loop compilation disabled. This oracle does
  not use the demo's coprime/scale parameterization.
- The statement fixture passes in all three modes. At `N=1000000`, the known
  result 17822459735 is checked along with one Number entry and zero reference
  cells.
- Membership tests cover multidimensional masks, inversion, empty vectors,
  wide integer inputs and replay, refreshed bindings, changed proof descriptors,
  untrusted plans, arbitrary exact sieve bounds, native views and budgets.
- The full main demo and its fixture pass **scoped differential execution on
  both hosts**: 2 completed, 1 test block, 2 Number loop entries. The full
  differential corpus, exhaustive audits and full repository suite were not run.
- Interpreter source/test TypeScript builds and `git diff --check` pass.

## Reproduction

```
node benchmarks/euler518.mjs compiled
node benchmarks/euler518.mjs reference
node benchmarks/euler518.mjs compiled 1000000
```

The optional final argument selects another source, such as
`benchmarks/fixtures/euler518-original.ra`. `RANK518_RUNTIME` selects a frozen
runtime; `RANK518_EXPECTED=100315739184392` checks the full result.
`RANK518_DIAGNOSTICS=1` and `RANK518_PROFILE=/tmp/euler518.cpuprofile` enable
separate diagnostics and CPU profiling; keep them off for comparable timings.
The retained `euler518-names.ra` and `euler518-lazy.ra` experiments reproduce
source alternatives without changing the checked-in demo.
