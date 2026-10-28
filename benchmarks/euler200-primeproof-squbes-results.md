# Euler 200: reusable boolean-axis consumers and smaller fixture bounds

Baseline `ae5b940f` on macOS arm64, Node v24.15.0. The first unfinished
entry by problem number in issue #447 is `200_primeproofsqube_test.ra`.
The earlier performance rows for 23, 30, 44 and 54 are historical results,
not unfinished work.

## Finding

The current array algorithm is reasonable: enumerate squbes under `Bound`,
find decimal windows equal to 200, and reject candidates having a prime
single-digit replacement. The default input produces 49,455 squbes and 587
candidates. `Cells = 76310` is a logical broadcast size, not evidence that all
76,310 primality tests or replacement values are eagerly computed.
The existing boolean folds short-circuit.

The dominant avoidable cost is native boolean-axis graph preparation. The
compiled default performs 50,042 tensor-map preparations and records 50,040
`tensor:stale-input` declines. Turning off only `tensorFusion` recovers the
reference execution speed; disabling scalar compilation, tensor cell
compilation, read hoisting or sequence membership compilation does not.

Stage truncation localizes the difference to `Cand = Sorted filter Has array`:
about 1.166 s compiled versus 0.488 s reference up to that statement. Sqube
construction and sorting together take about 0.2 s in either mode. These
single diagnostic controls identify the stage, not isolated timing estimates
for individual operators.

`evaluateAxisReduction` prepares a reusable contiguous boolean range. Lazy
binding-contract refinement changes a dependency revision after the first
range demand, invalidating the retained graph. The retained range keeps
returning `undefined`; the fallback then prepares a fresh graph for each row.
CPU profiling confirms the repeated `prepareTensorMap`/`bindRun` path.
Temporary mutation stack logging identifies `ArrayBindingContract.refine`
through `integer-view` validation, updating the contract version array in
`ArrayBindingContract.commit`. This is a contract metadata revision, not a
user assignment to a sqube cell. The current guards must remain conservative;
simply ignoring revisions would lose mutation correctness.

A small independent reproduction, without prime search:

```rank
use sequences
Sorted = 1 to 1000 array
Pos = (0 to 12 array) reshape 1 13
Pw = 10 ** Pos
Rows = Sorted len
Col' = Sorted reshape Rows 1
Win' = Col // Pw mod 1000
Has' = (Win equal 200) any axis 1
Result = Has copy
```

This gives 1,000 preparations and 999 stale-input declines. A temporary
one-retry prototype gives two preparations. In the full problem it gives
four preparations and two stale declines, while retaining all existing
revision checks. Prototype patch text is recorded in the raw results.
It is an experiment in a copied built runtime, not a production change.

## Controlled measurements

Serial fresh processes, five samples per variant, alternating order. Parse,
compile and execute are timed after interpreter construction. No diagnostics,
builds or other test jobs overlap these samples. All results are asserted.
Peak RSS is whole-process high-water usage, not retained array storage.

| Variant | Median time | Range | Median peak RSS |
| --- | ---: | ---: | ---: |
| Current default, compiled | 1.308 s | 1.299–1.386 s | 775.9 MiB |
| Current default, reference | 0.619 s | 0.616–0.681 s | 558.3 MiB |
| One-retry prototype, default | 0.411 s | 0.410–0.511 s | 309.6 MiB |
| Current fixture, compiled | 2.685 s | 2.657–2.700 s | 770.1 MiB |
| One-retry prototype, fixture | 0.949 s | 0.937–0.955 s | 377.8 MiB |
| Prototype and smaller fixture bounds | 0.446 s | 0.444–0.455 s | 312.4 MiB |

Thus the prototype default is 3.18 times faster; combining it with smaller
fixture bounds makes the fixture 6.02 times faster. These are initial prototype
measurements; final implementation measurements and verification follow below.

Additional three-sample controls: reference fixture 1.495 s median; smaller
fixture bounds without the runtime prototype 1.341 s median. An earlier
five-sample baseline gave 1.302 s compiled / 0.635 s reference, confirming the
same inversion in a separate cohort. The first controlled compiled sample
and first prototype sample were slower; both are retained in the raw data.

## Fixture work

The default test should retain the full bound and the answer 229161792008.
The second block currently repeats the same full-bound search for N=1 and
N=2. It can set `Bound = 200` for the first answer (200) and then
`Bound = 2000000` for the second (1992008). Enumeration is exhaustive below
the supplied bound, so finding the requested count there preserves these
first-answer assertions. All original and smaller-bound fixture assertions
pass with the current compiled and prototype runtimes; the original fixture
also passes in reference mode.

## Implemented change

Reusable native boolean-axis consumers now refresh their graph once after a
declined range. All revision guards remain active; no deferred values are
completed early and ordinary `=` boundaries are unchanged. The refresh is
bounded per consumer, including when unsupported graphs continue to decline.
The full-bound default-answer fixture is unchanged; only the N=1/N=2 bounds
are reduced. The sqube enumeration algorithm remains array-oriented.

Verification: TypeScript build; all 9,080 ordinary interpreter tests in 401
files; four scoped type/differential audits for the main demo and fixture.
The 20 boolean-axis tests include the six new cases for all/any contract
refinement, captured source write protection and later-row errors, plus the
existing empty axes, broadcasts, host reads, short circuit and saved-mask tests.
No full all-demo audit was run; the ordinary suite excludes the exhaustive
type/differential and Nurikabe audits. The four Euler 200 audits were run
explicitly. Final controlled measurements and other-demo controls are recorded
below and in `baselines/2026-10-27-euler200-optimization.json`.

Reproduce from the repository root:

```sh
node benchmarks/euler200-primeproof-squbes.mjs
node benchmarks/euler200-primeproof-squbes.mjs --reference
node benchmarks/euler200-primeproof-squbes.mjs --fixture
node benchmarks/euler200-primeproof-squbes.mjs --fixture --original-tests
node benchmarks/euler200-primeproof-squbes.mjs --diag
```

Use `--runtime=/absolute/path/to/out/index.js` to select an isolated build.
Raw data: `baselines/2026-10-27-euler200-investigation.json`.
The initial prototype measurements above remain labeled separately from the
final implementation measurements below. `--original-tests` restores the old
full-bound N=1/N=2 fixture in memory for a before/after control.

## Final implementation measurements

Five serial fresh-process samples per row, using the rebuilt interpreter. The
before runtime is the same build with only the boolean-range refresh reverted;
the original fixture restores the old bounds in memory. All default golden and
fixture assertions pass.

| Variant | Median time | Range | Median peak RSS |
| --- | ---: | ---: | ---: |
| original | 1.285 s | 1.274–1.298 s | 585.9 MiB |
| optimized | 0.417 s | 0.413–0.425 s | 383.1 MiB |
| original-fixture | 2.687 s | 2.670–2.721 s | 591.2 MiB |
| optimized-fixture | 0.449 s | 0.445–0.451 s | 303.9 MiB |
| reference-fixture | 0.651 s | 0.637–0.660 s | 487.2 MiB |

Default speedup: 3.08x. Fixture speedup: 5.99x. Final default diagnostics
record four preparations and two stale declines, versus 50,042 / 50,040 before.
Peak RSS varies with garbage collection; these are process high-water values,
not a guaranteed reduction of a particular retained buffer.

Three fresh-process samples per version for controls:

| Demo | Before median (range), ms | After median (range), ms |
| --- | ---: | ---: |
| 196-prime-triplets | 1203.3 (1149.9–1225.6) | 1154.0 (1144.8–1180.2) |
| 198-ambiguous | 181.6 (177.6–186.7) | 186.2 (183.5–186.3) |

No material control regression was observed; the small control sample does not
establish a general performance guarantee.
