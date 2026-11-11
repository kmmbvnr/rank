# Euler 596: lattice points in a hyperball

The default remains R=100000000 and returns **734582049**. The program uses one
explicit block loop and array operations; both the full main and full fixture
are eligible for ordinary corpus execution.

## Algorithm

Jacobi's four-square theorem gives, with Q=R² and S(M)=sum(d*floor(M/d)):

    T(R) = 1 + 8 * (S(Q) - 4*S(floor(Q/4))).

Let s=floor(sqrt(M)), q=floor(M/k), and tri(x)=x*(x+1)/2. Pair the two parts of
the divisor hyperbola instead of enumerating quotient multiplicities:

    S(M) = sum(k*q + tri(q), k=1..s) - s*tri(s).

For k<=s, the terms with the first divisor <=s contribute k*q. Summing the
second divisor <=s contributes tri(q). The s by s overlap contributes
s*tri(s), which must be subtracted once. This identity also holds at M=0.

The old two-phase program used three wide divisions per root position (one
for q and two for quotient multiplicities). The paired form needs one. Both
remain O(R), with bounded blocks rather than a full radius-sized tensor.

Modulo the odd prime p=1000000007, tri(q) depends only on r=q mod p. Compute
u=r*(r+1) mod p; its representative can be odd. Then

    tri(q) mod p = (u + p*(u mod 2)) // 2.

This avoids a wide product or floating rounding. The native modular product
uses exact low-word multiplication. The block size 524288 bounds temporary
storage; it is a demo choice, not a compiler admission threshold. A 4000000
block prototype used 663 MiB on the Mac; the smaller block used 328 MiB with a
similar single-run time (8.77 versus 8.43 seconds).

## General runtime/compiler changes

The exact function compiler previously lowered ordinary arithmetic bindings
such as `Next = Values + 1` into a BigInt cell loop pushing into a JavaScript
array, then packed the array again. That also hid compact Int32 storage from
subsequent native operations. Simple completed arithmetic stages can now
invoke the existing array kernels directly, with materialization at the same
ordinary `=` boundary. A direct sum over stored Int32 cells uses exact blocked
Number accumulation and a BigInt total. Number-mode admission is unchanged.

These shortcuts require trusted completed Int32 storage (including regular
linear views), primitive integer scalar operands, and private execution.
Deferred stages, callbacks, nontrivial scalar expressions, real/wide storage,
opaque readers, inspection and demand budgets keep the existing generated
consumer. In particular, an unused deferred division still does not run.

Wide scalar integer division by Int32 arrays has a guarded native path for
signed 64-bit numerators. It converts the numerator once, accounts for its
exact conversion error, and accepts a floating floor only if the fractional
part is separated from both integer boundaries by a conservative error
bound. Uncertain or unsafe quotients use exact BigInt division. Results retain
integer storage; overflow is not silently rounded. Zero divisors fall back to
the ordinary error path. Cooperative cancellation polls each block.

Modular product fusion now also recognizes trusted linear stored views and
works inside exact compiled functions. Products are reduced as they
form, without two boxed residue arrays. For unproved operands the product is
evaluated before the modulus, preserving errors and effects.

## Measurements

See `baselines/2026-11-11-euler596.json` for fresh-process observations, CPU
usage, source hashes, process peak RSS, host load and provenance. Node 24.15.0
on Apple M5 arm64 and Intel i7-10750H x64. One benchmark child at a time per
host; other system load is recorded. The old runtime snapshot predates these
changes; final measurements use the integrated main language artifacts for
both versions. Earlier diagnostic runs are separate from the primary pairs.

Full compiled input, three fresh processes per version; medians:

| Host | Before | After | Peak RSS before → after |
| --- | ---: | ---: | ---: |
| Apple M5 | 44.146 s | 6.524 s | 702.4 → 372.7 MiB |
| Intel i7-10750H | 41.366 s | 10.715 s | 618.4 → 350.1 MiB |

Compiled speedups are **6.8x / 3.9x**; peak RSS falls **47% / 43%**.

Full reference (one old control versus three new fresh-process medians):

| Host | Before (one run) | After (median) | Peak RSS before → after |
| --- | ---: | ---: | ---: |
| Apple M5 | 30.492 s | 6.599 s | 791.8 → 361.8 MiB |
| Intel i7-10750H | 45.835 s | 10.662 s | 725.6 → 339.7 MiB |

These reference ratios compare a single baseline observation with a median.
The old compiled samples alternated with an initial candidate; the final
compiled/reference samples alternate with each other. The final tables do
not claim alternating before/after pairs. Load, CPU time and all raw runs are
retained. Every one of the 32 recorded full-input observations returns the
same exact answer. Earlier 71-second Mac diagnostics are not the baseline.

An extra generic-loop modular-product shortcut was rejected after an old-
source Mac control slowed down. It is absent from the delivered code; fusion
inside exact function bodies is retained. The new helper uses that function
path, not the generic compiled-loop shortcut. Initial candidate and final
measurements are separate in the raw data.

Single compiled controls at R=10000000 distinguish the algorithm and runtime:

| Host | Old source / old runtime | New source / old runtime | New source / final runtime |
| --- | ---: | ---: | ---: |
| Mac | 3.461 s | 8.617 s | 1.054 s |
| Intel | 5.486 s | 10.204 s | 1.504 s |

The source rewrite alone is slower: ordinary array binding completion needs
the compiler repair. With the old source on the final runtime, single controls
take 4.150 / 5.916 seconds, with nearly unchanged RSS. Thus this does not claim
a speedup for every existing program; the source/runtime combination is the
measured improvement. Those controls are single observations, not medians.

Measurement base: `c32b6061` (includes the effect-boundary/compiler repairs).
Saved before interpreter: `977eb9c0`. The raw data retains both candidate and
final source hashes. Documentation and test-only additions followed timing.

Delivery also integrates `682d2705` (compiler budgets and region dispatch).
After that integration, both full compiled smoke runs return 734582049 in
5.894 seconds on Mac / 10.759 seconds on Intel. These are single integration
checks, not replacement medians. All focused and filtered differential checks
below were rerun on this delivered base.

Verification on **each host**: 1102 focused tests in 26 files, including the
full answer in both modes. Two filtered main/fixture differential cases pass.
TypeScript, 13 runner/semantic checks, 65 semantic owners and application-form
checks pass. The previously observed scalar error-format and numeric-call
counter assertions also pass after integrating main. Exhaustive audits and
the full ordinary suite were not run.

## Reproduction

Build from the repository root:

    node node_modules/typescript/bin/tsc -b packages/interpreter/tsconfig.json packages/interpreter/tsconfig.test.json
    node benchmarks/euler596.mjs compiled
    node benchmarks/euler596.mjs reference

The driver accepts mode, radius and optional source file. `RANK596_RUNTIME`
selects a saved interpreter `out/index.js`. The original Rank source is retained
in `fixtures/euler596-original.ra` for algorithm comparisons. For an unchanged
runtime, supplying that source measures the source change alone.

Targeted tests (from `packages/interpreter`):

    node scripts/test.mjs test/euler596.test.ts test/function-plan-completion.test.ts

Independent lattice enumeration checks small radii; the original quotient
algorithm checks block boundaries. Both modes check the full answer. Native
arithmetic tests cover signed wide boundaries, exact quotient transitions,
random denominators, reversed views, snapshots, unsupported storage, opaque
headers/readers, budgets, cancellation, empty arrays and error/effect order.
Exhaustive audits and full npm test are not part of this verification.
