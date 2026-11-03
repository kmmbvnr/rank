# Euler 351: summatory totients and recursive call overhead

Investigation and delivery, 2026-11-03, baseline/runtime snapshot `2bf0aeac`.
Issue #447 lists `euler/351_orchards.ra` as the next unfinished task after 350.
The selected source below is now applied to the demo; its execution exclusion is removed.

## Findings

The mathematics is appropriate. Let S(x) be sum(phi(k), k=1..x). The program
uses S(x)=x(x+1)/2 - sum(S(floor(x/k)), k=2..x), grouping equal quotients and
memoizing large arguments. The orchard result is 6*(n(n+1)/2-S(n)). It does
not need an O(n) Rank sieve through the full default 10^8.

The recursive helper already enters the linked exact scalar compiler. Its
initial diagnostic rejection at `Phi X` comes from trying an unspecialized
integer-parameter proof; an explicit array/index-domain proof succeeds, and
runtime hooks count **3945713 compiled scalar calls** for the original default.
The two small totient/prefix loops use Number compilation. Treating that initial
rejection as evidence that the helper is interpreted would be incorrect.

Most calls only take the helper's first branch and return `Phi X`. Resolving
that table lookup in the consumer, and recursing only above the table, removes
millions of function entries. A larger precomputed prefix reduces the quotient
recursion further. The selected experiment uses approximately n^(2/3)/2,
clamped below by floor(sqrt(n)); at 10^8 the prefix bound is **107721** instead
of 10000. This is a measured time/memory compromise, not a universal optimal
threshold. The cutoff controls work distribution, not numerical precision.
All result arithmetic remains exact; floating arithmetic only chooses a cutoff.
The square root is evaluated first, retaining rejection of negative inputs.

The selected source also uses the existing `scan + array` for prefix totals.
Memoizing directly by X removes the unnecessary global-N/slot parameter: the
helper has four parameters instead of five. It makes only **5565 compiled
scalar calls** at the default, about 709 times fewer. All selected Rank lines
are at most 40 characters. The cache retains ordinary index reference semantics;
input arrays remain read-only in recursion, and ordinary bindings are retained.

## Measurements

Node 24.15.0 on Mac arm64 and Intel x86_64. Timings include parsing, preparation
and execution, excluding runtime imports and process startup. RSS is whole-
process peak. Benchmark processes are serial per host; external load was not
controlled. In particular, Mac timings varied substantially between series.
Every full run asserts **11762187201804552**.

Three compiled controls and three selected reference controls per host:

| Host/mode | Original s | Selected s | Original MiB | Selected MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 0.307 | 0.164 | 180.0 | 183.0 |
| Intel compiled | 1.005 | 0.471 | 165.6 | 172.4 |
| Mac reference | 43.273 | 2.133 | 449.9 | 261.7 |
| Intel reference | 208.411 | 4.835 | 428.2 | 257.0 |

**Original full reference timings have one sample per host, not medians of
three.** They establish the large gap, not a precise universal speedup. Other
Mac selected reference series ran in 1.46..2.27 s. A separate alternating
comparison against the five-parameter balanced-scan source gives selected
medians 0.164 s compiled / 1.712 s reference, versus 0.166 / 1.483 s for that
control. Their ranges overlap; simplifying the cache key is primarily a code
cleanup, not a proven reference speed improvement.

The reference peak falls by about 188 MiB on Mac and 171 MiB on Intel. Compiled
peak rises by about 3 and 7 MiB respectively, as the larger precomputation and
native scan replace a tiny table. This is a real memory tradeoff to preserve
when selecting a production version. Keeping the sqrt cutoff and just inlining
small lookups gives a lower-memory alternative: initial three-round medians
0.197 / 4.514 s on Mac and 0.650 / 16.690 s on Intel (compiled/reference).
The new cutoff also grows the prefix faster for larger inputs; additional
limits should be measured before claiming a good tradeoff far beyond default.

## Compiler/runtime experiments

An isolated emitted-JavaScript prototype reuses prepared rank-one readers by
array identity and revision within a compiled function kernel. It was motivated
by the millions of tiny base-case calls. After the algorithm change it gives
no substantial benefit: Mac selected compiled medians are 0.164 / 0.163 s
(stock/cache); a verified Intel cache series gives 0.458 / 0.447 s. This small
change does not justify shipping without broader mutation, callback, rank,
error and cancellation coverage. Its patch is preserved, but it is not chosen.
The original Intel reader-labelled trials used an unpatched clone due to a
copy interruption; those rows are not cache measurements. The later series
verified `scalarReaders` was present before running. Raw data keeps that caveat.

Array-oriented alternatives were also tested:

- Replacing the prefix loop with native scan alone is compact and competitive;
  it is included in the selected version.
- A sliced totient sieve at the selected cutoff takes one exploratory Mac
  compiled sample of 0.368 s / 314 MiB. Materializing the prime list gives
  0.370 s / 312 MiB; also materializing the local selector gives about
  0.312 s / 299 MiB. These are not selected over 0.164 s / 183 MiB.
- Splitting each quotient sum into a small-quotient vector tail is correct,
  but one Mac compiled sample takes 0.997 s / 302 MiB, and reference 0.975 s /
  290 MiB. It trades compiled speed and memory for reference speed.

There is a separate general compiler gap in the sliced variant. The Number
emitter already contains range materialization (`rangeArray`), but an isolated
failure probe reports **unbound local `Ix`** while lowering the loop's local
materialized selector and gather/scatter update. The exact plan reports an
unsupported `MaterializeExpression`. These are different failures. The loop
builder already permits replay-safe Number plans without an exact plan, so it
would be wrong to blame a mandatory exact-plan gate. Supporting local index
array producers through gather/scatter is a concrete follow-up area. No patch
fixing that gap has been implemented here; it is not the original helper's
bottleneck. The selected source keeps the existing fast scalar sieve and uses
array scan where it is already effective.

## Independent verification

A separate ordinary Uint32 totient sieve runs through all **100000000** values,
without the quotient recurrence. It finds S(n)=**3039635516365908**, and computes
the final result using BigInt. One Mac run takes 1.285 s / 434.3 MiB; this is an
oracle process, not an alternative Rank benchmark. Each phi cell fits Uint32,
and every partial prefix sum is a safe integer; BigInt handles the final result.

A direct sieve through 10^6 supplies expected results for 336 inputs: all 0..300,
square and table-boundary neighborhoods, twenty seeded random values, and
100000/100001/100003 and near-million checks ending at 10^6. Across seven variants and both
engines, **4704 comparisons per host** pass on Mac and Intel. The selected source
also passes the existing companion Rank fixture in both engines. Negative
inputs are still rejected by its first square-root operation.

The isolated reader patch remains experimental; it is not applied to production.
The original investigation did not run a full suite or exhaustive audit.

## Reproduction

```sh
RANK351_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler351-investigation.mjs demos/euler/351_orchards.ra compiled
RANK351_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler351-investigation.mjs \
    benchmarks/experiments/euler351-selected.ra reference
RANK351_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler351-verify.mjs
node benchmarks/euler351-full-oracle.mjs
```

`RANK351_VARIANTS=selected` restricts the small oracle to that source. The worker
accepts the source, mode, Limit (default 10^8) and optional `diag`.
`RANK351_KERNEL_OUTPUT` saves diagnostic kernels. Diagnostic runs count function
entries and collection access and must not be mixed with timing trials.
The zero-context reader-cache patch applies to a private matching emitted
runtime using `git apply --unidiff-zero` from its directory containing `out`.
Raw series, failure probe and the full oracle are retained in
`baselines/2026-11-03-euler351-investigation.json`.


## Delivery verification

The production demo matches `experiments/euler351-selected.ra` byte for byte.
The companion fixture now covers 0, 1 and 2 as well as its original examples.
A focused regression file compares 336 inputs with an independent direct phi
sieve in both engines (672 comparisons), checks negative-input rejection, and
checks the full default answer in both engines. Its four tests pass.

Langium generation and `tsc -b tsconfig.build.json` pass. Four scoped type and
differential checks cover the program and fixture after removing the execution
exclusion. All three exclusion-policy tests, CLI check and CLI fixture pass.
The independent full 100-million-cell sieve was rerun and confirms the answer.
No full suite or exhaustive corpus audit was run.

Fresh delivery measurements use three serial processes per mode and host,
with the built stock runtime. Medians:

| Host | Compiled s / MiB | Reference s / MiB |
| --- | ---: | ---: |
| Mac arm64 | 0.171 / 182.0 | 1.588 / 263.2 |
| Intel x86_64 | 0.477 / 173.3 | 4.998 / 255.8 |

The original/selected controlled research comparisons remain above; these
new runs confirm the shipped source rather than forming a new paired baseline.
Earlier correctness-only probes overlapped scoped tests and are excluded from
these timing rows. External host load remains uncontrolled. Raw delivery runs
and verification metadata are in the baseline JSON under `delivery`.
