# Euler 533: bounded score batches and exact candidate products

The full result remains **789453601** at N=20,000,000. The
[statement](https://projecteuler.net/problem=533) gives L(6)=241 and
L(100)=20,174,525,281; the existing last-nine-digits fixtures remain 241 and
174525281. The issue's 48.1/4.6-second reference/compiled measurements are
historical: the current baseline at 1f9a3abd already runs in about 4.1/2.1 s.

## Mathematical reduction

Let M(t) be the largest m with lambda(m) dividing t. Then L(N) is one plus
the largest M(t) for positive t<N. For every odd prime p with p-1 dividing t,
M(t) contains p^(v_p(t)+1). Its power of two is 2 for odd t, and
2^(v_2(t)+2) for even t. This characterizes M(t) without testing candidate
integers m individually.

Odd t admit only m=1 or 2: lambda(m) is even for every m>2. For N>=3, M(2)=24
already dominates them. Also M(2t)>M(t), so values below the upper half cannot
win. The new sieve stores only t=2s in that upper half: 5 million cells rather
than 20 million at the default input. N<=1 returns one before attempting the
old zero-valuation loop; N=2 returns three before constructing the sieve.

Each odd-prime contribution has an original modulus (p-1)*p^k. Broadcasted
small-prime powers build the extra schedule; large primes need only k=0.
The small-prime bound includes floor(sqrt(N))+1, covering cases such as p=5,
N=21. Replacing t by 2s maps a modulus d to d/gcd(d,2). The existing prime-2
contributions plus one initial log(2) give the required v_2(t)+2 exponent.

## Storage and bounded array work

Scores use floor(65536*log(p)) rather than the old 2^40 scale. Default scores
fit Int32: the retained score buffer uses 20 million bytes instead of the old 160 million.
Ordinary bindings still complete their values; explicit range copies are
unnecessary. Ranges can retain compact physical representations while keeping
ordinary binding/error semantics.

A prefix scan of visit counts partitions the schedule by event budget. Dense
single tasks keep direct strided updates. Other batches expand positive row
lengths into owner/offset arrays, then add all weighted keys with `.accumulate`.
Heavy tasks and their successors force boundaries; each light batch has fewer
than twice its 65,536-event budget. Thus scratch vectors stay bounded without
materializing every sieve update at once. There is one explicit Rank loop,
no nested loops, and every line fits 40 columns.

The default schedule executes 245 batches instead of roughly 1.27 million
interpreted prime iterations. Budgets 32768, 65536, 131072 and 262144 were
compared. 65536 balances compiled/reference time and peak memory. A simpler
per-modulus prototype had an exploratory diagnostic run of 0.53 s / 278 MiB,
but retains the
large interpreted iteration count; the final batched form benefits both modes.
Raw exploratory records are retained separately from final timings.

## Conservative screen, exact final selection

The old program chose one rounded-log argmax and reconstructed only its residue.
The replacement retains all close scores, reconstructs each full M(t) as a
BigInt product, and compares those integers before taking the final modulus.
At the default input there is one survivor, t=18,378,360. Its M has 600 decimal
digits. An independent scalar prime-power implementation matches the entire
integer and verifies lambda(M)=18,378,360, not merely the nine-digit answer.

The screen includes a one-score-unit allowance for elementary-log error, in
addition to floor quantization. If S is a score with k prime-factor terms,
the scaled true log lies in [S-k, S+2k] under that allowance. Every term has
integer weight at least floor(65536*log(2)), so the global peak bounds k.
Keeping scores within three times that bound cannot exclude a better product.
The allowance corresponds to a log error below 1/65536, much looser than normal
floating precision. This is a floating-log screen with an explicit error
allowance, not arbitrary-runtime interval arithmetic. The final products and
comparison are exact. Deliberately coarse Scale=2 tests retain many candidates
and verify selection against an independent exact oracle.

## General compiler repair

`Ends last` previously treated `last` as a scalar input, so the complete
function prefix declined with `number-loop:unsafe-input`. The numeric loop
compiler now handles `first` and `last` of completed named rank-one integer,
real and boolean arrays through guarded numeric storage. Integer endpoints
also work inside mixed Number/BigInt arithmetic. It checks the sequences
module/builtin identity and existing storage contracts on entry.

Empty arrays replay the ordinary native path, preserving missing-value rules
and preceding stores. Arbitrary inline expressions keep their native demand
path: they need not demand the same cells as a completed named array. Observable
budget/cancellation scopes also retain the original path. Higher-rank row
results, custom readers and unsafe arrays retain their existing fallbacks.
This is a general endpoint operation, not an Euler/scan recognizer.

## Full-scale measurements

Node v24.15.0, Mac arm64, fresh independent processes. Compiled results are
medians of three alternating before/after pairs, including parse/execution.
Reference and cross-controls are single observations. RSS is process peak.

| Workload | Before | After |
| --- | ---: | ---: |
| Compiled | 2.078 s / 851 MiB | 0.763 s / 345 MiB |
| Reference | 4.061 s / 629 MiB | 0.903 s / 442 MiB |

Compiled time is about 2.72x faster with 59% lower peak RSS. Reference time is
about 4.50x faster with 30% lower peak RSS. The new source with the old runtime
is 1.466 s / 518 MiB; the old source with the new runtime is 2.073 s / 851 MiB.
Both the algorithm and the compiler repair contribute. Other-demo controls
stay within one-pair noise: Euler 529 is 4.272 -> 4.257 s and Euler 531 is
2.206 -> 2.208 s.

Intel remains under an independent corpus load with package temperature at
100 C. Its full asserted run is 1.75 s / 340 MiB, recorded in the raw results;
it is not an unloaded before/after speed comparison. All 148 new cases pass there. No other
process was stopped.

## Verification and reproduction

An independent DP introduces every admissible prime power, combines exact
Carmichael values by lcm, and retains the largest BigInt at each exact lambda.
It uses no logarithms, multiple sieve or p-1-divides-t inverse formula.
It covers N=0/1/2, prime-power boundaries through 1000 and both statement
fixtures, across both compiled backends and reference execution. Separate
probes compare every stored score against independently factored DP products,
including mixed dense/sparse batches with a seven-event budget. Direct inverse
checks include products beyond Number's exact range.

124 Euler cases and 24 endpoint regressions pass on Mac and Intel. Endpoint
coverage includes fresh scans, integer/real/boolean values, logical strided
views, snapshots and partial errors, completed versus inline demand, empty
arrays, wide totals, budgets, warm polling scopes, changed builtin bindings
and custom readers. The focused Mac set passes 624 tests across 12 files.
Filtered differential passes the main demo and fixture (2 files, 1 embedded
test block). No full suite or exhaustive audit was run.

From the repository root:

    node benchmarks/euler533.mjs compiled
    node benchmarks/euler533.mjs reference
    node benchmarks/euler533.mjs compiled 100
    node benchmarks/euler533-candidate.mjs 18378360

From `packages/interpreter`:

    node scripts/test.mjs test/euler533.test.ts
    node scripts/test.mjs test/number-loop-array-ends.test.ts
    node scripts/test.mjs test/differential.test.ts -t euler/533_carmichael

Original source: `fixtures/euler533-original.ra`. Raw records and source hashes:
`baselines/2026-11-09-euler533.json`. Set `RANK533_RUNTIME` to a frozen
interpreter's out/index.js, and `RANK533_EXPECTED=789453601` for an asserted
full benchmark. `RANK533_DIAGNOSTICS=1` enables separate diagnostic runs.
