# Euler 355 investigation

Runtime: isolated `86600c85`, Node 24.15.0, 2026-11-03.
The shared workspace has unrelated edits and advanced during the investigation;
measurements use the unchanged isolated runtime on Mac arm64 and Intel x64.
The production demo now applies the checked repair. The compiler and
execution exclusions are unchanged.

## Findings

The next unfinished entry in issue #447 was `euler/355_coprime.ra`.
The original currently fails in both engines, including Limit=100:
`selection expects an array, queue or finite sequence`, at
`Large = Pr filter not Lo array`.
`Pr filter (not Lo) array` works; so does the clearer
`Pr filter Pr greater Root array`, used for the controls below.
This is expression grouping in the demo, not a compiler-only failure.

The existing algorithm starts with the largest power of each prime, then
maximizes the gains from sharing numbers between small and large primes using
rectangular Hungarian assignment. The full answer remains **1726545007**.

`Inf = 10 ** 30` prevents the main Hungarian loop from staying in Number mode.
Diagnostics show two speculative overflows and an unsafe scalar entry in the
fixed-grouping baseline. The hot loops already compile; the rejection of the
whole `hungarian` helper as a scalar function does not imply interpreted hot
loops. With a finite weight bound, the heavy loop uses Number, with no
Number overflow in the observed full run.

The experimental solver uses `Inf = (W max + 1) * (S + 1)`. All weights are
nonnegative gains, so this is a conservative finite assignment-cost bound.
An early return for S=0 avoids an empty maximum. This changes the program's
sentinel explicitly; the compiler must retain exact semantics for arbitrary
large integers rather than silently approximate `10 ** 30`.

The dense matrix also includes columns which cannot yield positive gains.
For a small prime P, its baseline power PP, and a candidate power Pow=P^a,
a gain requires `Q * (Pow - 1) > PP`, with `Q <= Limit // Pow`.
If even that upper endpoint cannot improve the baseline, the entire interval
can be omitted. Taking the largest feasible endpoint over these powers gives
a conservative global Top. Large primes above Top can be removed before
allocating W. Their unchanged singleton contributions remain in Base.
The S dummy columns remain available for unmatched rows.

At Limit=200000: S=86, Top=50000, R=17984 → 5133,
W=1546624 → 441438 cells (71.5% fewer).

## Measurements

Fresh serial processes within each series, including parsing and compilation,
excluding module imports. Existing machine load was not controlled. Compiled
rows are medians of three runs; reference baselines are single runs, final
reference rows medians of three. RSS is whole-process peak, not allocation
volume. The broken original has no comparable completion time; 'before'
means **only the filter expression repaired**.

| Engine / host | Before | Bounded prototype | Peak RSS before / after |
| --- | ---: | ---: | ---: |
| Compiled / Mac | 0.612 s | 0.213 s | 325.1 / 196.1 MiB |
| Compiled / Intel | 1.459 s | 0.506 s | 297.2 / 187.4 MiB |
| Reference / Mac | 9.998 s | 3.137 s | 471.0 / 468.8 MiB |
| Reference / Intel | 33.638 s | 10.258 s | 445.0 / 443.5 MiB |

Memory savings are substantial in compiled execution. Reference peak RSS is
nearly unchanged; do not describe fewer matrix cells as a comparable RSS gain.
A separate Mac split measured about 132 ms parsing and 79 ms execution,
including compilation, in a 211 ms optimized full run.

Changing only Inf gives compiled medians 269 ms Mac / 627 ms Intel. Simply
trimming large primes to Limit//2 gives 227 / 542 ms. The tighter endpoint
bound is a smaller matrix without building a full matrix first.

Rejected: constructing the matrix, transposing, finding nonzero columns with
ranked max, retaining dummy columns, filtering and flattening. It found only
4568 active real columns (4654 including dummies), but one Mac control took
330 ms compiled / 244.6 MiB and 3.073 s reference / 624.9 MiB. The extra
copies hurt compiled time and peak memory; reducing the allocation up front
is preferable. This is an exploratory single control, not a repeated series.

Some exploratory Intel safe/half reference samples overlapped a separate
owned benchmark job. Those raw samples are retained but are not used for
final reference comparisons. Final bounded Intel series ran after all owned
benchmark jobs finished; the fixed reference baseline completed before the
overlap. Background workload from other sessions remains uncontrolled.

## Verification and recommendation

- The investigation passed 130 checks. Delivery verification passes 162 checks:
  the four research variants plus the production solver in both engines at
  16 inputs, plus the actual production fixture in both engines. Inputs through 30 use an independent prime-mask subset DP oracle;
  Limit=100 checks 1356. Existing fixture includes 10=30 and 30=193.
- All measured full runs on Mac and Intel agree on 1726545007.
- Full source, arithmetic and loop semantics are retained; no execution lane
  or timeout changes, no compiler special case, no exhaustive audit started.

Implemented production repair: explicit prime filter, bounded sentinel with
empty-case guard, and candidate endpoint pruning. There is no demonstrated
compiler correctness gap here. Further compiler work would need a separate
measured target; preserving a gigantic integer sentinel through floating
point without proof would be incorrect. Most remaining compiled latency in
this cold run is parsing and compilation/startup rather than Hungarian work.

Prototype: `benchmarks/experiments/euler355-bounded.ra`.
Raw results: `benchmarks/baselines/2026-11-03-euler355-investigation.json`.

```sh
node benchmarks/euler355-investigation.mjs 200000 compiled \
  benchmarks/experiments/euler355-bounded.ra
node benchmarks/euler355-investigation.mjs 200000 reference \
  benchmarks/experiments/euler355-bounded.ra
node benchmarks/euler355-verify.mjs
```

Set RUNTIME to an alternate interpreter index.js URL to use a fixed build;
DIAG=1 records compiler diagnostics, PHASES=1 adds phase timings, PROFILE sets
a CPU-profile path and KERNELS sets the generated-kernel output path.
Delivery also adds fixture cases 1, 2 and 4, covering empty assignment and
unmatched rows. Frozen original and bounded research sources preserve the
benchmark controls after the production demo changes.

## Delivery verification

At delivery base `fabd9054`, the production source uses one combined prime mask
in place of two successive filters, with the same candidate set. Build and
whitespace checks pass. The 162 checks pass on both Mac and Intel. Full answer
1726545007 passes in both engines on both hosts. Fresh delivery controls:
Mac 0.210 s / 197.5 MiB compiled, 3.101 s / 470.3 MiB reference;
Intel 0.518 s / 187.3 MiB compiled, 9.693 s / 446.4 MiB reference. These are single verification runs, not replacement medians.
