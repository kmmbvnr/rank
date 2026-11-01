# Euler 319 investigation

Investigated at `4116b44b`, Node v24.15.0, on Apple M5 and the Intel
`root@jack.lan` host. The next unfinished default in issue #447 was
`euler/319_bounded.ra`. The production demo remains unchanged. The final compiler repair is described below.

## Delivered repair

The final change retains the original linear sieve and in-place prefix loop.
A no-early-exit scalar range above the existing copy-probe cap may leave at
most 64 destination cells outside its work count. This reuses the existing
small-copy allowance: even the smallest such admitted pass has 262081
iterations. The 64-cell small-store threshold and 262144-cell probe cap
are unchanged. Below the cap, existing measured work feedback remains intact.
All destinations still contribute to the cost; stepped ranges still count
actual iterations. Overflow replay, private copies, and error publication
are unchanged.

The original program now uses four Number loops instead of three Number
loops plus an exact prefix loop. No extra scan result, product array, helper
wrapper or array hyperbola rewrite is delivered. This avoids the reference
memory increase observed in those experiments. Reference code and its
manual-lane exclusion remain unchanged; no reference speedup is claimed.

Final measurements use the main tree based on `65f0130a`, including the
concurrently merged #507 work. Both control runtimes have the same built
modules, with only number-loop-runtime replaced by its pre-fix implementation
for the baseline. That baseline JS was checked against the original built
4116b44b implementation, excluding the source-map footer. The frozen demo
matches the production demo byte for byte.

Five fresh processes per version, alternating sequentially on each host:

| Full unchanged demo | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Before repair | 1096.8 | 2730.1 | 344.6 | 325.4 |
| After repair | **560.1** | **1262.3** | **261.9** | **243.0** |

Speed improves 1.96x / 2.16x and peak RSS falls by about 83 / 82 MiB.
Every full sample returns `268457129`. Timing includes parse, analysis,
compilation and execution, excluding imports and interpreter construction.
Peak RSS is total process memory, not retained table size.

Validation includes 726 focused tests on each host, with eight new admission
regressions (sentinel passes in both directions, the 64/65-cell boundary,
multiple destinations, a prefix recurrence, early exit, overflow replay and
bounds-error publication). A full compiled Euler 319 golden test was added.
The bounded demo fixture passed scoped type/differential audits (two tests).
Build, semantic boundary checks and application-form checks passed. The
independent five-variant oracle was rerun on the repaired runtime on both
hosts: 705 program comparisons and 10584 quotient checks per host. Earlier
broader algorithm experiments remain documented as research results.

Delivery raw records: `baselines/2026-11-01-euler319-delivery-{mac,intel,verification}.json`.
To repeat the paired benchmark, build the runtime and set BEFORE_ROOT to a
matching built control with the pre-fix number-loop-runtime module:

```sh
BEFORE_ROOT=/path/to/control node benchmarks/experiments/euler319-delivery-series.mjs
```

## Finding

The mathematical algorithm already avoids sequence enumeration: a linear
Mobius sieve, prefix Mertens values, a descending quotient cache, and a
quotient-grouped modular sum. Its existing implementation and earlier
measurements are documented in [mertens-results.md](mertens-results.md).
The [problem statement](https://projecteuler.net/problem=319) asks for
N = 10^10 modulo 10^9; this investigation uses that full default input.

The largest compiled bottleneck is an admission heuristic, not missing
integer arithmetic lowering. The prefix loop

```rank
for I in 1 to Limit
  Mu I += Mu (I - 1)
end
```

has `Limit` iterations but writes an array of length `Limit + 1`. In
`packages/interpreter/src/jit/number-loop-runtime.ts`, the amortized full
range admission requires `count >= conditionWriteCells`. One untouched
sentinel cell causes the pass to miss that admission. The array exceeds
262144 cells, so it hits `number-loop:condition-write-budget` and executes
the exact compiled backend instead.

A separate diagnostic run reported four compiled loops, three Number
loops, and precisely that budget rejection. A phase-marked full run took:

| Phase | Mac time |
| --- | ---: |
| Parse/setup and Mobius sieve | 194 ms |
| Prefix pass | 569 ms |
| Quotient Mertens cache | 226 ms |
| Final grouped sum | 112 ms |

These instrumented phases are a control, not repeated benchmark medians.
A source-only control starting at zero and guarding `I > 0` admits Number
for the same useful work. Its diagnostics show four Number loops and no
copy-budget rejection. This isolates the admission problem without changing
any global compiler threshold.

## Repeated measurements

Three fresh processes per case, rotating order, sequential on each host.
Imports and interpreter construction are excluded; parsing, analysis,
compilation, execution and output handling are included. RSS is process
peak RSS, not retained tables. Other machine work was not suspended.
Every full compiled sample returned `268457129`.

| Full input variant | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 1090.7 | 2716.9 | 339.4 | 320.8 |
| `Mu = Mu scan + array` | 546.8 | 1235.7 | 275.7 | 255.1 |
| Zero-start guarded prefix control | 557.9 | 1247.3 | 262.2 | 245.1 |
| One function execution region | 514.1 | 1246.1 | 209.0 | 196.9 |
| Same region, Limit = 2000000 | 565.2 | 1356.6 | 194.8 | 183.6 |
| Same region, Limit = 8000000 | 507.8 | 1244.5 | 228.4 | 216.0 |

The array scan is roughly 2.0x / 2.2x faster than the original. It already
uses the existing compact integer scan implementation in both engines.
The single-region experiment allocates the tables inside a helper, allowing
one Number region with private local arrays across all stages. It reduces
peak RSS further, but adds no consistent Intel speed advantage over scan.
It also removes the top-level Mu/Cache bindings used by the public `mertens`
helper. It is a compiler experiment, not a drop-in replacement for the demo.

The larger sieve gives little speed benefit and uses more memory. The
smaller sieve trades some speed for lower peak RSS. Neither result justifies
changing the default limit on speed grounds. A separate exploratory variant
using a precomputed native prime array plus scan took 611 ms / 277 MiB on
Mac (one run); it did not improve on the simpler scan variant.

## Reference engine

At N = 1000000, Limit = 10000, three-process medians were:

| Variant | Mac ms | Intel ms |
| --- | ---: | ---: |
| Original | 266.2 | 755.5 |
| Scan | 255.8 | 738.3 |
| One execution region | 270.5 | 761.8 |

Full Mac reference controls, one run each:

| Variant | Time | Peak RSS | Answer |
| --- | ---: | ---: | --- |
| Original | 39.61 s | 478.6 MiB | 268457129 |
| Scan | 37.83 s | 532.2 MiB | 268457129 |
| Original, Limit = 1000000 | 37.35 s | 460.3 MiB | 268457129 |

These single runs do not establish small reference speed differences.
Scan does not solve the reference cost and did not reduce peak reference
RSS in these controls. Most work remains in the sieve/cache scalar loops;
changing their execution region does not accelerate them without compilation.
A full original exact-compiled control completed in 2.344 s / 310.9 MiB,
also with the expected answer. Full reference Intel was not measured.

## Verification

`experiments/euler319-verify.mjs` checks five variants (original, scan,
guarded prefix, whole region, native prime list) in reference, compiled and
exact compiled modes. Each host passed 705 program comparisons and 10584
quotient-Mertens checks. The independent oracle uses trial factorization and
an ungrouped Mobius divisor sum; it does not reuse the demo's linear sieve
or quotient-cache recurrence. Inputs include N = 1, 2, 5, 10, 20, 97, 100,
256, 1000 and sieve limits below/around/above sqrt(N), including Limit > N.
The whole-region variant checks the final result; other variants also
expose all quotient Mertens values to verification.

The existing focused `test/euler-319.test.ts` passed 22 tests. No exhaustive
audit, exclusion, timeout, production demo or compiler change was made.
The full-size golden is consistent with the earlier independent Python
cross-check recorded in `mertens-results.md`.

## Further acceleration experiments

The follow-up uses the Dirichlet hyperbola identity, with r = floor(sqrt(x)):

```
M(x) = 1 + r*M(r)
       - sum(d=1..r, mu(d)*floor(x/d))
       - sum(k=2..r, M(floor(x/k)))
```

The first sum reads adjacent differences of the prefix table through
contiguous range selectors. The second splits at `floor(x/(Limit+1))`:
large quotients gather from Cache and the remaining quotients gather from Mu.
For Root > Limit the array experiment retains the original grouped recurrence.
This preserves support for tiny sieve limits instead of assuming the default.

A separate Mobius sieve uses strided array updates for primes <= sqrt(Limit).
It tracks their squarefree product, clears multiples of prime squares, then
flips the sign for cells with one remaining large prime. This uses an extra
Limit-sized product array. The combined variant is `array-sieve-views`.

Three fresh-process follow-up medians:

| Full variant / engine | Mac ms | Intel ms | Mac peak MiB | Intel peak MiB |
| --- | ---: | ---: | ---: | ---: |
| Linear sieve + scan / compiled control | 549.6 | 1253.6 | 276.3 | 251.8 |
| Array sieve + hyperbola views / compiled | 1231.1 | 3437.3 | 533.6 | 424.2 |
| Array sieve + hyperbola views / reference | 4952.1 | 13929.7 | 1158.5 | 1159.9 |

The reference improvement is large compared with the original Mac single
control (39.61 s), but the array rewrite is slower in the compiled engine and
uses much more memory. Full original Intel reference was not measured, so no
Intel reference speedup ratio is claimed. Every completed full sample returned
the expected answer. A Mac reference control with `--max-old-space-size=512`
took 5.173 s / 809.8 MiB (one run): collection policy affects peak RSS, but does
not remove the source-level allocation cost. A 128-MiB heap was too small:
child processes exhausted the heap on both hosts; those failed controls are
retained in the raw follow-up JSON. Heap tuning is not a proposed fix.
The follow-up series script now uses 512 rather than rerunning the failed cap.

Other exploratory controls, one full Mac run each:

| Variant | Compiled | Reference | Reference peak |
| --- | ---: | ---: | ---: |
| Scalar hyperbola + array sieve | 1.039 s | 26.03 s | 849 MiB |
| Materialized-index hyperbola + array sieve | 2.057 s | 8.28 s | 1465 MiB |
| Signed-product Mobius sieve + original cache | 1.493 s | 18.02 s | 786 MiB |

The signed-product variant encodes parity and the product in one table, but
its final masks and choices outweighed the saving. Incrementally updating
small coefficients instead of calling powmod passed the oracle but took
575 ms in a compiled control, giving no evidence of a gain over simple scan.
The SPF recurrence passed small tests but the existing public factorsieve
bound is 1048575, below the full default sieve size. Its full-input domain
error was retained rather than raising that unrelated cache limit.

A diagnostic of the materialized-index vector cache published 14005 typed
arrays / 66421170 cells, compared with three publications in the original
full program. This confirms substantial intermediate storage even with
compilation. Further compiler work should inspect fusion of the actual
slice/gather arithmetic reductions, while preserving shape, bounds and
error timing. Existing gather/tensor fusion already handles some forms;
this investigation does not claim that general gather support is absent.
The array rewrite should remain experimental until the compiled slowdown
and allocation volume are addressed.

Both hosts also passed 1410 additional program comparisons and 26460
quotient-Mertens checks across all ten follow-up variants, in all three
engines. Together with the initial checks that is 2115 programs and 37044
quotient checks per host, with no mismatches.

Follow-up reproduction:

```sh
node benchmarks/experiments/euler319-followup-series.mjs
node benchmarks/experiments/euler319-verify.mjs views array-sieve-views
node benchmarks/euler319-investigation.mjs reference 10000000000 4641589 array-sieve-views
```

## Research proposals before delivery

1. Generalize amortization analysis for long range passes with a small
   sentinel prefix/suffix. Preserve overflow replay, error publication and
   the protection against short loops copying huge arrays. A global budget
   increase does not address the specific estimate demonstrated here.
2. Express the demo's prefix sum as `Mu = Mu scan + array`: it is compact,
   idiomatic and already has a native compact implementation. Its benefit
   overlaps the admission repair; the two speedups must not be added.
3. Investigate shared private execution regions for adjacent stages as a
   general compiler feature. The helper prototype demonstrates a memory
   opportunity; a production change must preserve ordinary binding and
   helper visibility rather than requiring this experimental wrapper.

## Reproduce

```sh
node benchmarks/experiments/euler319-series.mjs
node benchmarks/experiments/euler319-verify.mjs
DIAGNOSTICS=1 node benchmarks/euler319-investigation.mjs
PHASES=1 node benchmarks/euler319-investigation.mjs
node benchmarks/euler319-investigation.mjs reference 10000000000 4641589 scan
```

`RANK_ROOT` selects a built runtime in another directory; frozen source and
variant transformations stay beside the benchmark. Timing raw records:

- `baselines/2026-11-01-euler319-mac.json`
- `baselines/2026-11-01-euler319-intel.json`
- `baselines/2026-11-01-euler319-verification.json`

Follow-up raw records: `baselines/2026-11-01-euler319-followup-{mac,intel,verification}.json`.
