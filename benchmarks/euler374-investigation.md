# Euler 374: partition products

Research on 2026-11-03. Issue #447 marks 370, 372 and 373 complete;
374 was the next unfinished numbered task. The delivery below implements the
constant-storage recurrence and general large-modulus dispatch. Historical
research controls are retained for comparison.

The [official problem](https://projecteuler.net/problem=374) asks for the sum
of maximum distinct-part partition products, weighted by their part counts,
through 10^14, modulo 982451653. The existing solver's full answer is
**334420941**; every full-input alternative preserves it.

## Where the current cost comes from

The existing algorithm already groups consecutive inputs by partition size.
It has O(sqrt(Limit)) iterations rather than enumerating partitions or 10^14
integers. At the default it has 14142134 groups and allocates 14142138 inverse
residues. Thus the algorithm is reasonable, but the inverse table and several
passes through it are avoidable.

There is also a correct speculative overflow in the inverse-building loop:

```rank
V = (Mod // I) * (Inv (Mod mod I))
Inv I = (Mod - V mod Mod) mod Mod
```

Already at I=5, V is 128694833070173770, beyond exact Number integers. This
ordinary binding materializes the wide value. The current compiler correctly
discards its private Number attempt and replays the region exactly. It must
not silently round V or erase an observable ordinary binding.

`experiments/euler374-inline.ra` instead binds the reduced residue:

```rank
V = Mod // I * Inv (Mod mod I) mod Mod
Inv I = (Mod - V) mod Mod
```

The existing general modular-product lowering then handles the inverse pass
without overflow. Changing V to a lazy binding is not a valid substitute:
that plan reads Inv, and the language correctly rejects subsequent mutation
of Inv while the plan holds it read-only.

## Eliminate the inverse table

`experiments/euler374-recurrence.ra` keeps the same partition grouping, but
updates a weighted harmonic numerator instead of storing inverse residues.
Write F_n=n! and W_n=n!*(1/2+...+1/n). Then

```
F_n = n * F_(n-1)
W_n = n * W_(n-1) + F_(n-1)
```

All steps are reduced modulo the prime. A complete group with m parts has sum

```
m * W_(m+2) + m*(m+3)/2 * F_(m+1).
```

For the last, incomplete group, save one earlier (W,F) pair and subtract its
scaled prefix. One modular exponentiation gives the inverse of that saved
factorial. This replaces the full inverse array with constant auxiliary
storage, removes the inner Upto loop and repeated inverse reads, and leaves
one scalar recurrence loop. It also handles Limit=0 as an empty sum; the
original returns 1 there.

The factorial inversion assumes the largest factorial argument is below Mod,
as is true at the requested default. This is not a general solution beyond
that domain; the old inverse-table solver has the same modulus boundary.

## General compiler experiment

`experiments/euler374-modular-control.mjs` is an import hook over an isolated
built compiler, not a production source edit. It preserves operand evaluation
order and the existing overflow, zero and signed-remainder fallback paths.

The current A*B mod M lowering first branches on whether A*B is a safe integer.
For bounded positive moduli, an experimental direct call to the existing
quotient/Math.imul modular multiplier avoids that per-product dispatch.
No Number admission threshold, copy limit or precision contract is relaxed.

Applying it to every modulus is unsuitable: full Euler 365 regresses from
422 to 697 ms on Mac. A narrower policy uses it only when

```
94906266 < M <= 2^30.
```

94906266 is not a timing-tuned loop threshold: it is the largest integer
modulus for which every pair of nonnegative residues has a safe Number
product. Its predecessor squared fits MAX_SAFE_INTEGER; its square does not.
The prototype keeps the original policy below this boundary. It improves
374 while retaining 365's small-modulus path. The delivery below implements
it in ordinary lowering and checks replay, errors, cancellation, vector
consumers and observable operand reads.

## Research measurements

Node 24.15.0 on Apple M5 and Intel i7-10750H. Final compiled results are medians
of three fresh processes, serial on each host with variant order alternated.
Each full-input run checks 334420941. Canonical compiler sources match
9ce86cf4; an isolated snapshot excludes concurrent foreign worktree changes.
Time includes parsing/preparation/execution, excludes imports; RSS is whole
process peak. Reference figures are single full-input controls, not medians.

| Variant | Mac s | Mac RSS MiB | Intel s | Intel RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Original, compiled | 2.331 | 286.9 | 5.330 | 269.2 |
| Reduced V binding, compiled | 1.562 | 300.8 | 3.365 | 294.4 |
| Constant-storage recurrence, compiled | 1.028 | 176.1 | 1.457 | 163.4 |
| Recurrence + large-modulus prototype | 0.653 | 176.1 | 1.368 | 164.3 |
| Handwritten JS recurrence | 0.476 | 53.8 | 0.768 | 56.0 |
| Original, reference | 63.748 | 469.4 | not run | — |
| Recurrence, reference | 15.361 | 175.5 | 41.512 | 161.5 |

The standalone JS control omits Rank parsing, dynamic integer contracts,
publication, replay and cancellation. Its square-root calculation is only a
control for these inputs. It is not a semantically interchangeable runtime.
On Mac the measured Rank recurrence kernel with the prototype is about
0.56 s after setup, versus 0.48 s for the complete handwritten computation.
The remaining interpreter/reference gap is real, but does not imply failed
compilation: the recurrence is one Number region with no overflow.

General-dispatch controls on Mac, three-process medians in ms:

| Workload | Current | Always bounded multiplier | Large-modulus only |
| --- | ---: | ---: | ---: |
| 10M recurrence, modulus 1009 | 230.2 | 190.1 | 228.7 |
| 10M recurrence, modulus 982451653 | 249.1 | 221.9 | 221.1 |
| Euler 350, full | 196.0 | 179.1 | 179.3 |
| Euler 364, full | 222.6 | 220.5 | 220.9 |
| Euler 365, full | 422.0 | 696.6 | 421.0 |

Intel Euler 365 medians are 1366/1388 ms (current/large-only), with overlapping
ranges. The large-only policy helps 374 by about 36% on Mac but only 6% on
Intel. A Mac-only conclusion would overstate its general benefit.

## Verification and reproduction

`experiments/euler374-verify.mjs` builds an independent exact distinct-part
knapsack oracle. Original, reduced-binding and recurrence variants pass all
limits 1..240 in both engines: 1440 comparisons. Another 168 comparisons cover
group boundaries at m=31/100/1000/4096, and two cover the recurrence's zero
input. The same checks pass with the compiler prototype on Mac and Intel.
The existing signed modular verifier adds 729 BigInt comparisons, covering
negative operands, zero and moduli around 2^30. This is focused research
validation, not a complete interpreter suite or corpus audit.

```
CONTROL=baseline node benchmarks/euler374-investigation.mjs original compiled
CONTROL=baseline node benchmarks/euler374-investigation.mjs production compiled
node benchmarks/euler374-investigation.mjs production compiled
node benchmarks/euler374-investigation.mjs production reference
node benchmarks/experiments/euler374-verify.mjs
node benchmarks/experiments/euler374-native.mjs
OUTPUT=/tmp/euler374-delivery.json node benchmarks/euler374-delivery.mjs
```

Set RUNTIME to an absolute built interpreter index.js to select an isolated
runtime snapshot; DIAG=1 records counters and PROFILE=/tmp/profile.json
records a CPU profile. The raw results, including all neighbour samples, are
in `baselines/2026-11-03-euler374-investigation.json`.

## Delivered changes and verification

The production Rank program uses the constant-storage recurrence, including
an empty sum at Limit=0. It remains within 40 columns and has one CPU loop.
The production compiler selects the existing exact modular multiplier for
large positive residue domains; ordinary bindings and fallback behavior are
preserved. The threshold comment records its mathematical meaning and the
Mac/Intel measurements. The research import hook is not used in production.

Final fresh-process, alternating-order three-sample medians:

| Host | Original + old policy s | New program + old policy s | Delivered s | Original / delivered RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac M5 | 2.348 | 1.024 | 0.664 | 288.0 / 176.5 |
| Intel i7-10750H | 5.383 | 1.428 | 1.367 | 268.8 / 163.5 |

The delivered source's full Mac reference control is 16.294 s / 174.3 MiB,
versus the original 63.748 s / 469.4 MiB single control. Both produce
334420941. Neighbour full-input medians (baseline/delivered, milliseconds):

| Host | Euler 350 | Euler 364 | Euler 365 |
| --- | ---: | ---: | ---: |
| Mac | 198.7 / 180.0 | 223.1 / 222.0 | 425.5 / 428.3 |
| Intel | 454.2 / 441.7 | 515.0 / 515.3 | 1422.5 / 1421.7 |

No material neighbour regression or memory increase was observed. The small
365 variation overlaps its sample ranges. Raw final samples are in
`baselines/2026-11-03-euler374-delivery-{mac,intel}.json`. The baseline import
hook disables only the new compiler dispatch in the same delivered runtime;
it is not a comparison against an unrelated old checkout.

Verification on an isolated intended source tree, excluding unrelated edits:

- TypeScript build passes, as does the shared working-tree build.
- 465 focused tests in 11 interpreter files pass on Mac; the 16 modular-product
  and Euler 374 tests also pass on Intel.
- The modular grid includes 94906265/94906266/94906267 and 2^30 boundaries,
  signed operands, zero, wide ordinary bindings, changing runtime moduli,
  opaque operand read order, vector replay, cancellation and demand budgets.
- The committed Euler test independently maximizes exact distinct-part
  products for all limits 0..240 in both engines, and checks the full compiled
  golden, one Number region, zero overflow and zero array publication.
- Main and fixture each pass scoped differential, inferred-type and name-fact
  audits. No exhaustive suite or full corpus audit was run.
- The manual verifier includes the delivered source on Intel: 1920 small
  oracle comparisons, 224 larger boundary comparisons and two zero checks.
- Semantic boundaries pass for 65 owners.

The full main has been removed from the shared execution exclusions and is
back in corpus execution; its small fixture remains. The historical >120 s
reference note is obsolete for these controls.
