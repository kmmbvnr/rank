# Euler 452: long products

The full M = N = 1000000000 answer remains **345558983**. The original
algorithm counts tuples by their number of non-unit factors. It builds a
large flat transition graph over floor quotients, then revisits it for every
possible tuple length. Its retained graph and the successive vector/scanned
results cost several GiB. Removing a few copies cannot eliminate that work.

For a product k with prime exponents e, the number of ordered N-tuples with
product k is multiplicative:

```
f(p^e) = binomial(N + e - 1, e)
F(M,N) = sum(f(k), k = 1..M)
```

Each prime's exponent is independently distributed among the N positions.
There are at most floor(log2 M) exponents to precompute, even when N is large.
The implementation uses exact binomial coefficients before reducing modulo
1234567891, so it needs no modular inverses or assumption that N is small.
The empty tuple contributes one exactly when M >= 1.

A quotient prime-count sieve stores pi(v) in Low[v] for v <= sqrt(M), and
High[i] for v = floor(M/i). Vector updates snapshot the previous prime's
counts before writing the new ones. Only O(sqrt M) count cells are retained.

The summatory helper groups products by their least prime. For a state
S(v,j), whose permitted primes start at zero-based index j, lone primes
contribute N * (pi(v)-j). For each p_i >= p_j and p_i^(e+1) <= v, add

```
f(p_i^e) * S(floor(v/p_i^e), i+1) + f(p_i^(e+1))
```

The second term counts pure prime powers; the first counts products with a
strictly larger next prime. All recursive v remain floor quotients of M.
Prime and exponent traversal share one loop, resetting the exponent when
moving to the next prime. The sieve helper and main setup each also have at
most one loop; no Rank loop is lexically nested. The JavaScript mathematical
prototype visits about 1.19 million states at the full bound, rather than
retaining the old transition graph for all DP layers.

## General compiler fix

An explicit terminal `return` replaces the result of every preceding function
statement. The numeric-prefix analysis previously treated a compound array
write at the end of the final loop as escaping, even when an explicit return
followed it. That unnecessarily rejected the entire private sieve region.

The analysis now discards that unused statement result while still computing
and checking the operand and stores. Array ownership, snapshot semantics,
error order, budget accounting and cancellation retain their existing guards.
Functions without an explicit return value and ordinary loops keep their
existing escape analysis. No numeric admission threshold was changed.

## Measurements

Three fresh-process samples per side in each mode, alternating before/after
order. Medians follow; all samples are retained.

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / compiled | 28882.49 | 562.24 | 4331.92 | 189.28 |
| Mac / reference | 107762.59 | 20444.08 | 5328.69 | 591.17 |
| Intel / compiled | 71612.38 | 1612.56 | 3745.64 | 178.59 |
| Intel / reference | 276154.14 | 76063.12 | 4982.16 | 540.86 |

Before every Intel sample, the second `vmstat 1 2` row showed 99-100%
idle and zero active swap-in/out. Earlier unrelated benchmarks/tests were
allowed to finish before these measurements started. Each host ran its
benchmarks serially, with focused tests scheduled afterwards.

## Compiler-only control

The final source is also run on the original runtime, isolating the return
result analysis change from the algorithm replacement. Three fresh-process
samples per side use identical final Rank source.

| Host | Old compiler, ms | New compiler, ms | Old RSS, MiB | New RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac | 861.39 | 563.88 | 474.70 | 188.48 |
| Intel | 2933.01 | 1663.73 | 406.92 | 177.46 |

The original compiler uses one Number loop for the tiny width setup; the
new compiler adds the private prime-count region. The recursive summatory
helper continues to use the existing exact scalar kernel. This change does
not relax the policy for speculative Number recursion.

Raw data: `baselines/2026-11-07-euler452.json` contains all 24 full runs,
12 compiler-only controls, source/runtime hashes and the JS reference.

Before runs use the original demo and runtime 86cf66be. Candidate runs use
the new algorithm and compiler fix. Timers include parsing and execution;
RSS is the process high-water mark. Node is 24.15.0 on both architectures.
Raw records retain source hashes, complete diagnostics and pre-run load.

## Verification

An independent oracle factors every integer through each selected small bound
and multiplies exact binomial coefficients, without a quotient sieve or
least-prime recursion. It checks 132 input pairs on three backends (default,
exact loops, and compilation disabled), including M = 0/1, N = 0/1, square
and power-of-two boundaries, and N larger than the modulus. The existing
M=N=10 and M=N=1000000 fixtures also run repeatedly on all three backends.
The full answer is checked against the original DP and a separate JavaScript
mathematical prototype.

Regression tests exercise the final compound RHS in loops and conditionals,
tuple returns, saved aliases, errors in operands that must still complete,
and budget/cancellation checks after a warm compiled call. The default sieve
uses a private Number region without overflow or native bulk publication of
its intermediate rows. Source/test TypeScript builds and semantic/exclusion
checks pass. Full exhaustive audits were not run locally.

The default demo is removed from the execution exclusions. Its old reference
execution approaches the 300-second audit limit on Intel and uses about
5 GiB RSS; the new algorithm reduces both costs substantially.

687 focused tests in 20 files pass on both Mac and Intel. The source/test
TypeScript build, semantic-boundary checks and exclusion checks also pass.

Run the full program from the repository root:

```sh
node benchmarks/euler452.mjs compiled
node benchmarks/euler452.mjs reference
```

The runner sets M and N to its numeric argument (default 1000000000).
An optional source path selects a baseline; additional CLI arguments can
override the tuple length. `RANK452_RUNTIME` selects an alternate runtime.
Retrieve the original demo from commit 86cf66be when reproducing a baseline.


The mathematical JavaScript prototype is retained in
`experiments/euler452-min25.mjs`. Its timer covers sieve and summation; the
Rank runner additionally times parsing. It also validates the two existing fixture
checkpoints and the full answer. This prototype uses the existing exact
normalized modular-multiply primitive for its bounded Number arithmetic.
