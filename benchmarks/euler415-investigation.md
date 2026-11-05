# Euler 415 investigation: Titanic Sets

Research base: `2ff9e3c6`. This records the initial investigation before
implementation. See [the delivery report](euler415-followup.md) for the final
compiler, demo, correctness checks and full measurements. The sources under
`experiments/` remain controls and prototypes.

## Result

The existing mathematics already reduces the grid problem to weighted
summatory totients, a prefix sieve, a quotient-state cache and quotient blocks.
It does not enumerate the `2^((N+1)^2)` sets. There is substantial execution
and array-traffic overhead beyond this reasonable mathematical reduction.

Full default `N=10^11`, `L=10^7`, Node v24.15.0:

| Variant | Mac seconds / peak MiB | Intel seconds / peak MiB |
| --- | ---: | ---: |
| Original, unprofiled | 46.388 / 1994.4 | 142.276 / 1798.3 |
| Combined control, same L | 17.754 / 1554.3 | 54.547 / 1514.9 |
| Scoped prefix tables, L=5 million | 20.822 / 1041.5 | 49.783 / 989.5 |
| Direct fused JS control, L=10 million | 3.158 / 210.0 | 9.411 / 210.8 |

All full answers are **55859742**. These are single fresh-process probes,
not alternating medians; host load and GC were not controlled. Rank parsing
is included, module imports excluded. The native JS control excludes parsing
and uses compact typed tables and fused scalar traversals. It is an
opportunity bound, not an equivalent general Rank implementation.

The combined Rank control is approximately 2.6x faster on both hosts. Its
memory peak decreases about 22% on Mac and 16% on Intel. Lowering L and scoping
prefix temporaries gives another memory/time tradeoff; the single Intel
observation is faster, while the Mac observation is slower. Do not generalize
an optimal L across processors from these probes.

## Where time goes

Initial profiled Mac run: 44.006 s / 2376.8 MiB. Its main phases were:

- Sieve: 2.496 s.
- Prefix construction: 5.668 s.
- Recursive quotient cache: 33.085 s.
- Final combination: 2.573 s.

The CPU profile includes generated arithmetic kernels, generic array reads,
owned-array construction and about 2.8 sampled seconds of GC. Original
execution reports no Number loops and 175,122 separately compiled tensor
kernels. The exact-loop diagnostic mentions `sum`; the Number attempt gets
further and fails on concat construction, followed by an array helper call
when concat is removed. Do not describe `sum` alone as the Number blocker.

**The profiled peak is not used as the baseline memory comparison:** profiling
retains extra runtime/script state. A fresh unprofiled original run is recorded
separately and used in the result table.

## Controls and compiler gaps

### Prefix storage

Adding `copy` to the three prefix bindings alone did little: one Mac probe was
42.955 s / 2262.1 MiB, with cache time still 32.673 s. This does not establish
a meaningful time improvement.

Use the existing modular scan implementation instead:

```
Cs = (F0 scan + with 0) mod Mod
C0 = Cs (1 to Lm + 1) copy
```

Similarly for F1/F2. Reduction after each addition gives the same stored
residues while keeping the scan output compact. The isolated modscan probe
was 45.590 s / 1650.9 MiB; it improves memory, not the dominant cache time.
The helper-scoped variant also stops retaining sieve and construction arrays
as top-level program bindings after table construction.

### Concat and helper composition

The cache constructs `Hx = concat Hq (array R)` and then shifts it by one.
The Number backend handles completed numeric concat-copy forms but not this
lazy concat of a named producer and inline array constructor. The control
computes the neighboring quotient vector directly instead:

```
Hi = Hq
Lo = X // (Qs + 1) max R
```

This preserves the final endpoint because `Qm = X // (R + 1)`.

The next blocker is `Ta = Hi tri Mod`: an ordinary function receiving an array
and returning an array. General exact array-returning calls exist, but Number
loop lowering rejects array-valued callees. This is not a missing arithmetic
operator. A separate minimal experiment demonstrates the gap:

- `B = A * A mod 100000000`: one Number loop.
- `B = A square 100000000`, with that same expression in `square`: one exact
  compiled loop, zero Number loops.
- Both return 42 in the probe.

`euler415-helper-probe.mjs` reproduces this independently of the Euler program.

The combined control expands four array helper calls into ordinary array
expressions. It also computes scalar triangular/square sums modulo Mod before
using them, and reduces the scalar square product before subtraction so the
checked Number path can use existing exact modular multiplication. The cache
then runs in one Number loop without arithmetic overflow in the full probes.

**Do not deliver the formula duplication as the final design.** Supporting
normal array helpers through the Number compiler, or composing their pure
stages with the consumer, would retain the compact function-based Rank source.
Lazy concat composition is another general compiler opportunity. Neither is
fixed by removing an alias or timing guard without a replacement proof.

### Powers of two

The hand-written array `p2` helper can use the existing `powmod` operation:
`2 Exponents Mod powmod`. This removes its masking/squaring loop and temporary
array stages. In the combined Mac control final combination drops from about
2.5 s to 0.56 s. No dedicated Euler builtin is needed.

### Direct JS bound

The JS control uses the same weighted-totient recurrences, performs the sieve
and prefix construction in typed arrays, and merges the three cache sums into
scalar loops without scratch vectors. Modular multiplication reuses Rank's
existing exact Number primitive. The final wide exponent uses BigInt.

Mac phase times: sieve 0.083 s, prefix 0.065 s, cache 2.897 s, combination
0.113 s. Rank's combined control still spends about 10.7 s in the cache and
4.0 s in prefix construction. More useful general work remains in fusion,
storage and helper composition; the manual control is not a proof that arbitrary
Rank values can use its fixed representations without guards.

## Correctness and scope

- 60 source/backend comparisons passed: original, combined and scoped variants,
  both reference and compiled, N=1..8 plus published N=111 and N=100000 checks,
  using short L values to exercise recursive cache branches.
- An independent geometric oracle enumerates normalized lines through grid
  points, counts collinear subsets of size >=3, and subtracts those plus the
  empty/singleton sets from all subsets. It does not use totient sums, quotient
  recurrences or the demo's coefficient formulas.
- Full Rank and JS controls agree at 55859742 on both architectures.
- At bounded N=10^7 / L=10^5, original reference/compiled probes were
  0.394/0.421 s; combined reference/compiled were 0.362/0.328 s. They agree at
  49785750. These small observations include parsing; full reference execution
  was not run and no full-reference time is inferred from them.
- No full suite, exhaustive corpus audit, commit, push or issue update was made.

Raw observations are in `baselines/2026-11-05-euler415-investigation.json`.
Before delivery, add regression tests for the general compiler gaps and run
paired timings of the actual final source, including memory on both hosts.

## Reproduce

```
node benchmarks/experiments/euler415-run.mjs compiled 100000000000 10000000 original
node benchmarks/experiments/euler415-run.mjs compiled 100000000000 10000000 combined
node benchmarks/experiments/euler415-run.mjs compiled 100000000000 5000000 scoped
node benchmarks/experiments/euler415-verify.mjs
node benchmarks/experiments/euler415-helper-probe.mjs
node benchmarks/experiments/euler415-native.mjs
```

`RANK415_PHASES=1` records phase times and RSS. `RANK415_RUNTIME` selects an
archived interpreter build. Variants `prefix-copy` and `modscan` retain isolated
experiments. The production source remains unmodified.
