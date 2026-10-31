# Euler 298 investigation

Baseline: `7749fbf9b366cb2c5f31ed033436200bedaba271`.
Selected as the next unfinished Euler task in the live issue #447 table.
The shipping change implements writable-alias snapshots in the exact compiler
and adopts exact path counts plus zero skipping in the demo. Ordinary `=` is
retained. The fixture adds Turns=22, empty and first-differing-score cases.
The investigation below records the original baseline and process-local
prototypes; final-source verification is recorded at the end.

Problem: https://projecteuler.net/minimal=298
Larry uses LRU replacement and Robin uses FIFO; both remember five of ten
possible numbers. Find E[abs(L-R)] after 50 calls, rounded to eight decimals.

## Correctness takes priority

The baseline compiled program was incorrect, independently of
performance:

| Turns | Reference | Unmodified compiled | Correct rounded value |
| --- | ---: | ---: | ---: |
| 20 | 0.79884191 | 63.01364144 | 0.79884191 |
| 50 | 1.76882294 | 140181.7237393 | 1.76882294 |

The compiled graph has 669 states and 6076 transitions; reference has 439 and
2913. The ordinary fixture differential test reproduces both wrong compiled
answers using the current TypeScript implementation, so this is not just an
out/ or phased-harness artifact:

```
npm test --workspace @arrrank/interpreter -- \
  test/differential.test.ts -t 'euler/298_selectiveamnesia_test.ra'
```

On the baseline it failed (one selected test, about 25 s), with both embedded compiled test
blocks failing and reference passing. This baseline failure has not been
hidden by adding a `copy` to the shipping demo.

### Exact-region alias bug

Inside state construction `R2 = R` must preserve ordinary value semantics.
Writing R2 must not mutate R. The exact region binder instead publishes the
same backing storage and prepares a direct writer without COW for the newly
bound alias. Region-entry COW cannot protect a binding established later
inside the region. The static exact guard rejects a destination source but
permits a writable alias target.

Relevant implementation:
- `jit/integer-loop.ts`: exact/Number alias admission and propagated writable
  names; Number rejects this writable alias, while exact permits the target.
- `jit/integer-loop-statements.ts`: `bindArray` materializes and binds the
  source, then prepares its direct writer.
- `jit/integer-loop-runtime.ts`: ownership is prepared only for destinations
  present at region entry.

Minimal reproducer (`euler298-alias-repro.mjs`):

```
A = array 1 2 3
Total = 0
for I in 0 to 2
  B = A
  for J in 0 to 2
    B J += 1
  end
  Total += B 0
end
Answer = A 0
```

Reference gives Answer=1, Total=6. Unmodified compiled gives Answer=4,
Total=9. Both research policies below recover Answer=1, Total=6:

- `euler298-alias-guard.mjs`: conservatively reject mutable aliases on exact
  regions as well. Correct, but state construction uses smaller regions.
- `euler298-alias-cow.mjs`: snapshot an alias at its exact binding when the
  plan's propagated writable set includes its target. Read-only aliases keep
  sharing. This retains the larger exact region and ordinary `=` semantics.
  The shipping implementation uses a typed runtime helper and private array
  copies, with ownership, rebinding, error-publication, alias-chain and
  read-only-sharing regression tests. The loader hook remains research only.

Explicit `R copy` or `R + 0` also avoids corruption experimentally, but masks
this general compiler bug and is not the preferred demo repair.

### Fixed-scale probability rounding

Even with alias semantics corrected, the original algorithm is not correctly
rounded for every supported Turns value. At Turns=22 both engines return
0.89655953. Independent exact counting gives

```
8965595249618747544000 / 10000000000000000000000
= 0.8965595249618747544
```

which rounds to **0.89655952**. The complete sweep also finds last-digit
mismatches at Turns=35,40,48 (correct: 1.37357182, 1.51711689, 1.72149046).
Rounding every edge update to 2^48 units can
move a value across an eight-decimal rounding boundary. The default 50-turn
answer still matches; the issue is exposed by the parameterized input.

The `exact` variant starts Dp with one path, updates by `Value * Wt`, and
divides only at the end by 10^Turns. It rounds using exact integers:

```
Scaled = (Total * 100000000 + Sl // 2) // Sl
Answer = Scaled / 100000000
```

It also skips zero source cells. This keeps the same finite-state DP, removes
intermediate probability quantization and avoids a magic precision constant.

## Algorithm and performance

The algorithm itself is suitable: canonical states exploit symmetry between
the ten number labels, reducing sequence enumeration to 439 states and 2913
weighted transitions, followed by DP over score difference. Each state has
outgoing weight exactly ten. The program scans many zero DP cells; skipping
zero updates is valid because `(0*Wt+5)//10 == 0` and the target arrays are
zero initialized.

Three serial fresh-process samples at Turns=50, Node v24.15.0/macOS arm64,
without diagnostics, give medians:

| Variant | Compiled with COW prototype | Reference |
| --- | ---: | ---: |
| Original fixed-scale DP | 0.371 s (0.356-0.384) | 7.951 s (7.907-9.054) |
| Skip zero cells, still fixed-scale | 0.339 s (0.335-0.344) | 6.922 s (6.402-7.518) |

These are current measurements, not the old issue-table 78.6/2.5 s timings.
The host load is uncontrolled. Do not compare speed against the unmodified
compiled program: it computes the wrong graph. The skip-only variant remains
numerically incorrect at Turns=22, so its speed does not settle the choice.

A diagnostic phased run of the COW-corrected original took 0.176 s for graph
construction, 0.143 s for DP and 0.009 s for the final reduction. It executes
50 Number regions for DP and 439 exact graph regions. A corresponding
reference run took roughly 0.461 + 8.294 + 0.027 s. The reference bottleneck is
scalar DP dispatch/arithmetic/writes; graph search and final reduction are
small. These are exploratory phase samples, not repeated medians.

Other exploratory single full samples (COW/guard-corrected compiled where
needed, no claims about small differences):

- Per-state active score bounds: compiled ~0.366 s, reference ~6.144 s.
  Additional bound bookkeeping did not beat the simple zero-skip variant.
- Slice updates: compiled ~8.285 s / 644 MiB RSS, reference ~5.062 s /
  692 MiB RSS. They introduce allocation/selection overhead and lose scalar
  compilation; not recommended.
- Float64 probabilities plus zero skip: compiled ~0.619 s, reference ~7.925 s.
  It gives the correct 22-turn result but loses against the scalar integer
  prototypes and does not provide an exact rounding contract.
- Exact path counts plus zero skip: first sample compiled ~0.652 s,
  reference ~9.280 s, both correct at 50 turns. This is a correctness tradeoff,
  not a claim of an improvement over the quantized program's speed.

## Independent oracle and verification

`euler298-oracle.mjs` simulates actual LRU/FIFO queues, canonicalizes labels,
builds the reachable graph, and counts paths using native BigInt integers.
It does not use Rank's queue-digit update rules or fixed-scale probability
rounding. It checks outgoing edge weight ten and total DP mass=10^Turns at
every step. Its result agrees with both existing default/20-turn goldens.
The resulting canonical graph and exact answers for Turns=0..50 are saved in
`2026-10-31-euler298-oracle.json`.

The verification harness compares entire weighted transition multisets by
canonical state code, so agreement does not depend on state numbering. It
checks all 0..50 turns compiled and selected turns in reference, recording
existing quantization mismatches separately from exact-candidate assertions.

A workspace TypeScript build was attempted to refresh out/:
`node node_modules/typescript/bin/tsc -b tsconfig.build.json`. It failed on
pre-existing test typing errors (compact-integer-scan, integer-square-root,
popcount, powmod-array and slice-assign). No production TypeScript changes
were made here. The focused source-based differential failure above is the
independent confirmation of the alias regression. No full test suite or
unfiltered exhaustive audit was run.

## Recommended implementation

1. Repair ownership for writable aliases bound inside exact regions, keeping
   ordinary `=`; retain the read-only sharing path. Add the minimal regression
   plus source-rebinding, alias-chain and partial-error cases.
2. Keep the compact finite-state DP. Prefer exact path counts and one final
   exact rounding, including a Turns=22 golden; skip zero contributions.
3. Re-run the actual two demo files through scoped differential/type/name
   audits and record final-source timings before delivery.

Reproduction commands:

```
node benchmarks/experiments/euler298-oracle.mjs
node benchmarks/experiments/euler298-alias-repro.mjs
node --import ./benchmarks/experiments/euler298-alias-cow.mjs \
  benchmarks/experiments/euler298-alias-repro.mjs
node benchmarks/experiments/euler298-samples.mjs
node benchmarks/experiments/euler298-samples.mjs exact
node benchmarks/experiments/euler298-verify.mjs
```

The completed sweep ran **181 checks**, including **6 full graph comparisons**.
The exact-count variant passed all 51 compiled inputs Turns=0..50 and all 9
selected reference inputs (0,5,7,8,9,10,20,22,50). Quantized variants retain the
recorded mismatches at 22/35/40/48 in compiled mode, and at 22 in the selected
reference sweep. Conservative exact-alias rejection also recovers the full
default answer. These are out/-based prototype checks, separate from the
unmodified source-based differential failure.

Final repeated exact-count samples (three fresh serial processes per mode):
compiled median **0.739 s** (0.693-1.509 s), reference median **8.096 s**
(6.171-8.725 s). Peak RSS medians: approximately 310 MiB compiled and 438 MiB
reference. These samples have substantial host-load variation; there is no
established reference speedup from exact arithmetic. Its benefit is correct
rounding while keeping full compiled execution below a second in the median.

Single-process controls for full Euler 292 and 296 preserved both golden
answers with and without the COW hook. Their timings varied substantially
with host load (292: 0.961/0.461 s; 296: 3.899/2.545 s); these are correctness
controls, not evidence of a performance improvement or a complete regression
sweep. Raw results are in `2026-10-31-euler298-controls.json`.

## Shipping implementation and checks

`bindArray` passes ordinary exact-region aliases to a runtime `aliasValue`
helper after materializing their already-guarded source. The plan's propagated
writable set selects targets needing a private snapshot. `privateArrayCopy`
preserves scalar storage/shape/validity. Read-only aliases keep sharing, and
Number-region admission is unchanged. The static exact guard still protects
source writers; no broad alias restriction was removed.

The interpreter source project builds successfully:
`node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json`.
This does not claim the pre-existing test-project typing errors described
above have been repaired.

Eight focused files passed 143 tests, including six new alias regression
cases. The fixture preserves default/5/20-turn checks, adds the precise
22-turn regression, and checks 0/7/8-turn boundaries. The 35/40/48 rounding
counterexamples remain in the independent all-turns sweep, avoiding several
expensive repeated full reference fixture runs.

The old baseline source is preserved as `euler298-original.ra`; `shipping`
selects the real demo in the investigation harness. Research COW hooks detect
the production alias helper and become no-ops. Final-source verification and
benchmarks do not enable hooks.

The scoped final-source audits passed: 4 interpreter tests (two differential,
two inferred-type), 2 common name-facts tests. Both actual files completed and
all four embedded fixture blocks passed. These runs overlapped the ordinary
suite, so their timings are not benchmark measurements.

The ordinary interpreter suite, with types/differential/nurikabe excluded,
finished with **10182 passed, 16 failed** across **442 passed/4 failed files**.
The failures are not concealed:
- One existing linear-write demand-budget assertion fails identically in a
  separate HEAD archive, with the baseline interpreter sources.
- Twelve image-helper failures (`cannot redefine available builtin: convolve`)
  and one manual coverage failure (`convolve`) have the same root conflict on
  HEAD. Selected image cases in both modes and manual coverage were reproduced
  against the unmodified archived interpreter and docs/demo.
- Two scalar-function cases exceeded the default 5-second timeout under the
  broad run. The file passed all **24 tests** when rerun alone with a 30-second
  cap; those cases completed in 3.246 and 4.520 seconds. No timeout config or
  unrelated image/manual/storage code was changed.

Full root npm test and unfiltered exhaustive audits were not run. This is a
focused delivery with demonstrated baseline failures in the broader suite,
not a claim that every repository check is green. The check summary is saved
in `2026-10-31-euler298-checks.json`.

Final shipping measurements (three serial fresh processes per workload/mode,
no loader hooks or diagnostics):

| Shipping workload | Compiled median | Reference median |
| --- | ---: | ---: |
| Full 50 turns | 1.076 s (0.756-1.666) | 9.871 s (8.237-11.972) |
| Extended four-block fixture | 1.461 s (1.218-3.560) | 15.555 s (13.448-17.151) |

The full answer or all four fixture blocks passed in every sample. The broad
range reflects uncontrolled host load. This is final-source validation, not a
claim of a controlled reference speedup versus the historical issue timings.
The final independent shipping sweep passed **60 checks**, including **2 graph
comparisons**, with zero rounding mismatches. Raw data are in the delivery and
delivery-verification JSON files. No execution exclusion or deadline changed.
