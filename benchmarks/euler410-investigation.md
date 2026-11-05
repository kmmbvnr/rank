# Euler 410: segmented sieve, array powers and wide totals

Historical investigation at `dd5f656a`, 2026-11-05.
The delivered changes and final controls are in
[the follow-up report](euler410-followup.md). Production source, compiler,
fixtures and audit exclusions are unchanged. These are experiments,
not a delivered compiler repair. Issue #447 lists 410 as the next
unfinished numbered entry after 408; 409 is not an unfinished entry.

## Findings

The program already uses a segmented arithmetic sieve, not a brute-force
geometric search. It visits 100 million denominators and makes about
574 million selected-cell updates. The current implementation additionally
publishes about 1.626 billion typed cells over the whole run. This last
counter is cumulative publication traffic, not peak or retained memory.

A CPU profile of the original full compiled main spent 6.4 seconds in
`mapDenseArrays`, 2.7 seconds in `writeIntegerSelection`, and 2.2 seconds
in GC. The generic integer array power `2 ** Om` has no stored-integer
kernel. It is a useful interpreter improvement independently of whole-loop
compilation. The profile is diagnostic, not part of the median series.

The Number region cannot initially lower the nested `primes to Root`
iteration. Preparing an integer prime array exposes further issues: a
named range selector created in the conditional body (`Sl`) is rejected
as unbound; inlining that selector allows lowering to proceed. Whole-array
compound updates also reject where the equivalent explicit array binding
works. Array power is absent from `vectorOperation`.

The number-probe experiment uses prepared primes, inline selectors,
explicit array rebinding, and a small lookup table instead of array power.
At R=10^6/X=10^7 the whole outer loop runs in Number mode. At the full
input, it overflows and replays: even the first term contains 2*R*X=2e17,
and the final total is 799999783589946560. Removing precision checks is
incorrect. The table in this probe is bounded and is **not** a general
replacement for power or a production proposal. After replay, inner sieve
attempts also report `condition-write-budget` for the large external
arrays. Changing the admission threshold is not a solution to the missing
wide array/reduction path.

## Program-only control

The weights experiment retains the same sieve and summation formula.
It stores the weight 2^omega(m) directly, initially 1, and multiplies it
by 2 on encountering each distinct prime. A remaining large prime also
multiplies the weight by 2. This removes the final large power array.
No upper bound on the number of distinct factors is hard-coded.
The experimental source intentionally retains the baseline loop structure
to isolate this change; it is not a final Rank style refactor.

Full default R=100000000, X=1000000000. All runs below returned
**799999783589946560**. Node 24.15.0 on both machines.

Mac: Apple M5 arm64, median of three sequential fresh-process runs;
variant order reversed in the second round. RSS is process peak MiB.
The workstation was not isolated from unrelated activity; the reported
series uses sequential benchmark processes, not a quiet-machine guarantee.

| Variant | Seconds | Peak MiB |
| --- | ---: | ---: |
| Original, block 10 million | 22.347 | 1727.7 |
| Direct weights, block 10 million | 11.482 | 1144.6 |
| Direct weights, block 1 million | 10.449 | 399.9 |
| Hand JS control | 1.617 | 200.9 |

Intel i7-10750H x64: one sequential fresh-process run per variant;
these are single samples, not medians.

| Variant | Seconds | Peak MiB |
| --- | ---: | ---: |
| Original, block 10 million | 54.166 | 1422.9 |
| Direct weights, block 10 million | 24.354 | 912.6 |
| Direct weights, block 1 million | 26.879 | 374.5 |
| Hand JS control | 5.633 | 200.7 |

Smaller blocks reduce peak memory on both machines. Their speed benefit
is architecture-dependent: the Intel sample was slower with one-million
blocks. Do not describe one block size as universally fastest.

The hand JS control uses the same prime-power sieve and sum, Uint32
smooth factors and Uint8 weights. It computes potentially wide terms with
BigInt and flushes safe numeric subtotals to BigInt before they overflow.
It has a narrower contract: no Rank snapshots, observable intermediate
bindings, cancellation, budgets, arbitrary array semantics or error replay.
It demonstrates algorithmic headroom; it is not equivalent generated code
and does not establish an achievable compiler speedup.

## Reference execution

One sequential full run per source on the Mac (not medians):

| Variant | Seconds | Peak MiB |
| --- | ---: | ---: |
| Original, block 10 million | 110.613 | 2981.4 |
| Direct weights, block 1 million | 94.405 | 728.9 |

The source change also helps reference execution, especially memory, but
reference remains much slower than compiled execution. These single runs
are sensitive to load; an earlier exploratory original run took 81.9 s.
Do not interpret them as a precise reference speedup estimate.

## Validation and proposed next work

The original and direct-weight sources passed 132 small-input checks:
11 bounds/pairs, three block sizes, both compilation settings and both
sources. An independent trial-division oracle counts distinct prime
factors and sums with BigInt. Cases include zero, singleton, reversed
bounds, powers of two, uneven blocks and a block larger than the range.
The existing 200000/300000, block-70000 golden also matches in the
weight experiment. Full compiled results agree on both architectures.
No full test suite or exhaustive audit was run.

Suggested implementation priorities:

1. General stored-integer array power for the reference path, with the
   existing power/error/precision contract. Direct weight accumulation
   is also a useful compact source improvement.
2. Lower finite native sequence iteration and named range selectors inside
   numeric regions; support array compound updates wherever equivalent
   binding lowering already exists. Preserve ordinary `=` completion,
   aliases, selector snapshots and error timing.
3. Support bounded numeric vector stages alongside exact wide terms and
   reductions, so one wide early term need not replay the entire block.
   Preserve eager intermediate completion; do not blindly fuse across `=`.
4. Retain blocking and measure the final implementation on both hosts.
   Flatten the prime-power stages with array operations if it simplifies
   the final Rank program; do not trade memory back for cosmetic brevity.

These steps address reusable execution capabilities. Replacing the
mathematical algorithm is not the first priority supported by these data.

## Reproduction

Run from the repository root after the TypeScript build:

```sh
node benchmarks/euler410-investigation.mjs
node benchmarks/euler410-investigation.mjs \
  benchmarks/experiments/euler410-weights.ra \
  100000000 1000000000 compiled 1000000
node benchmarks/experiments/euler410-hand.mjs
node benchmarks/experiments/euler410-verify.mjs
```

The runner also accepts `reference` instead of `compiled`. Raw records,
source hashes and the machine/sample distinctions are in
[the baseline JSON](baselines/2026-11-05-euler410-investigation.json).
