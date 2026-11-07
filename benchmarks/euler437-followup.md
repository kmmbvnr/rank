# Euler 437: batched primitive-root tests and packed selectors

Default N=100000000; exact answer **74204709657207**. Baseline source is
`experiments/euler437-original.ra`, from `6862ec22`; integration base is
`8bb06005`. The issue's historical 68-second compiled figure is not the
current baseline: earlier compiler work had already reduced it considerably.

## Results

Individual process runs, Node v24.15.0, Apple M5 arm64 and Intel i7-10750H
x86_64. The same full answer passed every completed control and candidate.
Times include parsing. Peak RSS is process peak, not retained heap.

| Host / mode | Original time | Final time | Original peak MiB | Final peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled | 6.753 s | 6.595 s | 2493 | 928 |
| Mac reference | 54.638 s | 7.282 s | 1765 | 629 |
| Intel compiled | 14.222 s | 14.705 s | 1264 | 720 |
| Intel reference | 154.258 s | 16.504 s | 1256 | 508 |

Reference improves about 7.5x / 9.3x. Compiled time is effectively unchanged
at this measurement precision: Mac is 2% faster and Intel 3% slower. The
large gains are reference speed and memory in both modes. Do not interpret
these individual observations as benchmark medians or architecture ratios.

Raw records and source hashes: `baselines/2026-11-06-euler437.json`.

## Algorithm and array structure

The roots g,h of x²=x+1 satisfy gh=-1. For each odd prime factor f of p-1,
(p-1)/f is even, so g^((p-1)/f)=1 iff h^((p-1)/f)=1. Only one root needs
these tests. For p=3 mod 4 exactly one root passes the factor-2 test; for
p=1 mod 4 both roots have the same quadratic character. Reject immediately
when one necessary test fails. Choose an odd square root of 5, making
(1+s)/2 an exact division instead of multiplying by a modular inverse.

Use direct square-root formulas for p=3 mod 4 and p=5 mod 8. Only p=1 mod 8
runs Tonelli–Shanks. There 2 and 5 are quadratic residues, so the nonresidue
search tries odd candidates and skips 5. The order helper returns 2^k directly
by doubling. The low-set-bit identity `Degree band (0 - Degree)` extracts the
complete power-of-two factor, without a separate scalar stripping loop.

The factor table stores only odd composites up to N/2: the odd part of p-1
never exceeds N/2. Index n//2 holds its smallest factor, or zero for a prime.
It has N//4+1 zero-initialized cells, instead of a full 0..N range and another
full post-sieve copy. N<5 now returns zero instead of incorrectly including 5.

Filter the prime array once, then process at most 65536 primes per batch.
Each square-root or order stage updates active lanes with masks, and the
primitive-root loop removes one factor from every surviving lane. Arrays
replace millions of scalar Rank calls. Each helper and the main driver has
at most one loop, with no nested Rank loops. All production lines fit 40
columns. Ordinary bindings and their snapshot semantics remain explicit.

## General runtime repair

A CPU profile of the initial batched program spent most of its time indexing
packed selectors through a generic per-cell facade in `selectorIndices`.
The array code was mathematically compact but paid JavaScript Proxy lookup
and boxing costs for every mask/index cell on every selection.

The shared selector path now reads proven owned Int32 indices directly, and
visits set bits in completed boolean bitmaps. Rank, length, negative-index
and bounds checks are preserved. Physical/logical length must agree before
using storage. Missing, mixed, lazy and untrusted inputs keep their ordinary
validation and callback behavior. There is no retained mask cache, new public
syntax, unsafe arithmetic, or special case for Euler 437.

This helps both compiled array code and ordinary AST execution. The original
scalar program was already well compiled; its large reference gap came from
scalar loops/calls and selector overhead, not just mathematical search cost.

## Alternatives

- A scalar rewrite achieved roughly 3.5 s compiled / 620 MiB on Mac, but
  reference took 65–74 s there and about 249 s on Intel. It is retained as
  `experiments/euler437-scalar.ra`, rather than imposing that interpreter
  regression or reverting to deeply nested source loops.
- Calling library `factors` removed the large table but took 219.67 s compiled
  on Intel. `experiments/euler437-library-factors.ra` preserves the candidate.
- Initial batched execution before the selector repair took about 19 s in
  either mode. The controlled records isolate the final demo with the old
  selector implementation, avoiding an algorithm/runtime conflation: 18.728 /
  19.225 s compiled/reference on Mac, versus 6.595 / 7.282 s after repair.
- Batches of 16384 and 262144 took 7.15 / 6.39 s compiled on Mac with peaks
  of 939 / 975 MiB. The retained 65536 batch balances memory and overhead.
- Eager shallow ordinary calls and recycling a single nonescaping global
  frame were explored. They did not close the scalar reference gap; neither
  change is part of the delivered runtime.

## Verification and reproduction

`euler437.test.ts` independently enumerates residues and their multiplicative
orders below 2000; it checks boundary totals in compiled, exact and reference
modes, each admissible prime's flag, and the full default compiled golden
answer. Existing fixtures keep 10000, 2000 and 1000000 checkpoints in all
three modes. New selector tests cover bitmap word boundaries, mutation and
snapshots, duplicate/negative/out-of-bounds integer indices, missing masks,
rank and length errors. The selected suite passes 264 tests / 12 files on
both hosts. An additional 48 Euler 747 / integer-root conversion integration
checks pass on each host. The ordinary package scripts run the tests; exhaustive audits
are left to CI.

The outdated full-scale exclusion is removed: the full reference workload is
now 7.3 s on Mac and 16.5 s on Intel, rather than a timeout-sensitive manual
case. The focused full compiled assertion also remains explicit.

```
node benchmarks/experiments/euler437-run.mjs compiled
node benchmarks/experiments/euler437-run.mjs reference
node benchmarks/experiments/euler437-run.mjs compiled 100000000 \
  benchmarks/experiments/euler437-original.ra
node benchmarks/experiments/euler437-verify.mjs
```

`RANK437_RUNTIME` selects another built interpreter index.js URL. The runner's
fourth optional argument overrides `Block = 65536` for the batch experiment;
its source hash describes the actual substituted program. It does not add a
language-level tuning argument. Reproduce a selector-only control by building
the integration base and running the final demo against that interpreter.
