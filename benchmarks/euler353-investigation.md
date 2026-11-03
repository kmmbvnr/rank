# Euler 353: current kernels, point generation and repeated integer loads

Research and delivery, 2026-11-03; baseline `9e7c0711`. The final implementation
and measurements are recorded in the delivery section below. Earlier sections
retain experiments, including rejected approaches; their prototype figures do
not describe the shipped implementation. The earlier implementation is
`9030e118`; its historical measurements are in `euler353-results.md`.

The [statement](https://projecteuler.net/problem=353) asks for a sum of minimum
squared angular risks on integer-coordinate spheres, through radius 32767.
The existing source already uses horizontal symmetry, reflected bidirectional
Dijkstra bounds, sorted Z bands and conservative chord pruning. The hot search
and coordinate loops already run in Number kernels; the root counter also has
a Number scalar specialization. The initial scalar-function rejection at
`R moonpoints` is not evidence that the numerical search remains interpreted.

## Point generation

The existing method scans X,Y pairs on x²+y²+z²=R² twice: first to count storage,
then to fill point codes. On the last sphere, a cold isolated Mac measurement
finds 5681 unordered nonnegative triples in 0.787 s, and produces all 34083 quotient
representatives in 2.211 s including that count. The scan is O(R²).

The quaternion experiment instead enumerates sorted nonnegative quadruples with
norm n, for each odd divisor n of R. For an ordering a,e,f,g and sign s=±1, use

```
u = a²+e²-f²-g²
v = 2(af+s*eg)
w = 2(ag-s*ef)
```

Their squared norm is n². Scale by R/n, take absolute coordinates, and encode
all three choices of vertical axis with both vertical signs. Three pair
partitions and the two signs cover the orderings of a sorted quadruple up to
these sphere symmetries. Deduplicate/sort with the existing library operations.
The allocation count now scans quadruples at norm n <= R, not pairs at R²;
its enumeration bound is O(sum(n^(3/2), odd n dividing R)).

Completeness: reduce a sphere point by its common coordinate divisor. Its new
radius divides R and is odd, since a primitive point at even radius would have
all coordinates even modulo 4. Put the odd coordinate first and write
P=(r+u)/2, Q=(r-u)/2. Then PQ=(v/2)²+(w/2)². A prime 3 modulo 4 cannot divide
both P,Q without dividing all coordinates, so it has even exponent in each.
Both P,Q are Gaussian norms; Gaussian factorization splits (v+iw)/2 into factors
of norms P,Q. Their real/imaginary parts give a quaternion of norm r and the
formula above, up to signs. Considering odd divisors and scaling therefore also
covers nonprimitive points. Radius zero is handled explicitly by returning [0].

A cold last-radius Rank sample takes **0.041 s compiled**, versus 2.211 s before.
The reference generator takes 0.993 s cold; in a warmed all-radius verification,
the same last sphere takes 0.428 s reference / 0.026 s compiled. These are phase
samples, not medians or full-program timings. Entire ordered point-code arrays
match an independent coordinate scan for every one of the 15 default radii,
in both engines (30 comparisons), not merely matching point counts.

## General compiler opportunity

The generated numerical graph kernel contains loads such as:

```js
const v62 = safe(Number(cells19[key64]));
```

For mutating Number regions, storage entry has already checked integer cells and
prepared invocation-private numeric buffers (or safe Int32 buffers). Integer
stores and arithmetic continue to check overflow. Rechecking and converting every
coordinate load is redundant for those prepared buffers, and can also inhibit
JS optimization around a possibly throwing call.

An isolated code-generation proxy replaces those scalar integer loads with an
identity `integerCell` callback only in kernels with external array destinations.
It does not alter arithmetic/store guards, cancellation, builtin guards, or any
Number admission/copy thresholds. A direct-load upper-bound probe was also tried;
the measured repeated series uses the callback form, closer to a runtime/compiler
implementation with a proved storage capability.

This is **not** permission to remove all integer-load checks. The existing flat,
read-only indexed-pass backend can borrow packed BigInt cells without validating
unused elements. It still needs conversion/checking at each actual read. The
prototype conservatively leaves those kernels untouched. A production change
should represent the entry proof explicitly in code generation/runtime selection,
not intercept Function construction or rewrite generated source with a regex.

The prototype preserves the default golden in three fresh full runs per host.
The small geometry/orbit checker also passes under the proxy on Mac. Four extra
comparisons retain raw read-only packed values, an unused unsafe cell, an active
wide cell, and arithmetic overflow replay. Broader alias/view, cancellation,
error-state and non-Euler regression coverage is still required before shipping.

## Full compiled measurements

Node 24.15.0; Mac arm64 and the user-provided Intel x86_64 host. Three fresh serial
processes per combination and host. Full timings include parsing/preparation and
execution, excluding runtime imports/process startup. External load uncontrolled.
RSS is whole-process peak. All full measured controls/prototypes assert
**1.2759860331**.

| Source / compiler | Mac seconds | Mac MiB | Intel seconds | Intel MiB |
| --- | ---: | ---: | ---: | ---: |
| Current / stock | 12.772 | 203.7 | 28.935 | 196.3 |
| Quaternion generator / stock | 10.126 | 218.8 | 20.344 | 226.3 |
| Quaternion / trusted-load prototype | 8.144 | 218.7 | 16.027 | 221.0 |

The generator alone improves the whole program by 1.26x / 1.42x. The compiler
probe saves a further 20–21% of elapsed time for that source, giving 1.57x / 1.81x
combined. These measurements do not establish a universal gain for other demos.
The new generator increases peak RSS by about 15 MiB on Mac and 30 MiB on Intel;
the combined prototype is about 15 / 25 MiB above the current program. This is
an unresolved memory cost, not a completed speed-and-memory optimization.

A labelled CPU profile locates the main cost in the existing numeric graph
kernel (candidate and minimum scans), plus coordinate generation and checkpoints.
Its run overlapped a failed batching experiment, so its wall time is not used
as a control. Hoisting the current coordinates and pi² alone did not demonstrate
an improvement in an exploratory run. Most cost remains after faster generation.

## Other experiments and rejected paths

- Two-pointer circle scanning returns the same points but still does quadratic
  work. A cold compiled last-radius points trial took 2.230 s, essentially the
  same as the existing 2.211 s sample.
- A modulo-64 square-residue jump table reduces candidate square-root calls.
  The last-radius generator took 1.563 s compiled. It is weaker than quaternion
  enumeration and adds a table/preparation stage.
- A library heap removes the dense minimum scan algorithmically, but `enqueue`
  rejects loop compilation. At Last=9 it takes an exploratory 1.506 s / 413 MiB,
  against a current control around 0.18–0.20 s. Diagnostics show execution split
  into many small numeric regions and scalar expression fallback. Simply adding
  an opcode is insufficient: heap effects must be compatible with overflow
  replay and publication timing.
- A hand-written indexed heap in numeric arrays keeps the search compilable but
  did not demonstrate a full-input win (one exploratory 12.849 s / 224 MiB run).
  Its added complexity is not selected.
- Batching heap insertions outside the numerical candidate loop restores some
  compilation, but the full run exceeded roughly 100 s and had about 1.83 GiB
  resident memory when stopped. Region fragmentation/copy cost makes it unsuitable.
- A conservative X/Z spatial bucket index preserves the golden but took a cold
  12.668 s / 292 MiB trial. This particular grid is not a demonstrated improvement;
  no claim about every spatial-index design is made.
- The array-oriented search replaces the minimum scan with `min .index` and uses
  gathered vector dot products, masks, indices, acos and bulk updates. It agrees
  with small oracles, and is useful as a compiler stress case. At Last=9 it takes
  about 0.464 s compiled / 0.466 s reference, with 290–294 MiB RSS. Both full engine
  trials exceeded 75 s and were stopped. Current fusion/materialization and
  indexed-reduction handling do not make this competitive at default scale.
- A separate dense-real native extrema probe speeds up a small repeated min.index
  microbenchmark, but no default Euler win was established from it. It is not
  selected as a solution to this task.

Alternative runs mostly have one sample and some overlap other exploratory
processes; they are not paired statistical comparisons. Only the table above
uses the repeated serial series.

## Verification and remaining scope

On each host, quaternion and vector sources in both engines pass 260 exact orbit
comparisons for radii 0..64, and 52 risk comparisons against unpruned full-sphere
Dijkstra (radii through 255). Maximum absolute risk discrepancy is
1.3877787807814457e-17. The identical checker passes under the trusted-load proxy
on Mac. Independently, actual Rank quaternion outputs at all 15 default radii
match coordinate-scanned codes exactly in both engines on Mac (30 comparisons).
The standalone JS formula is separately checked at those radii as well.

The full reference default was not measured, either before or after quaternion
generation. At Last=9, one serial reference sample is 1.492 s current versus
1.129 s with new generation; this does not predict the full reference budget.
The scalar graph loop remains expensive without compilation. Do not remove its
manual exclusion or claim the full reference workload is solved from these data.

At the research stage, no full suite, exhaustive corpus audit or production
build was run. The delivery below makes validated numeric loads explicit and
tests their semantic boundaries. Quaternion generation has strong exact verification,
but its extra peak RSS should be reduced or explicitly accepted before delivery.
Array graph fusion and compiled heap effects remain separate open questions.

During research, the legacy `euler353.mjs --radii=true` harness expected the older parenthesized
`Sum += (2 ** N - 1) moon` spelling. The current demo uses the simplified chain,
so that substitution no longer inserts risk assignments. Its assertion fails;
the delivery fixes that substitution and verifies all 15 risk assignments.

## Reproduction

```sh
RANK353_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler353-investigation.mjs demos/euler/353_riskymoon.ra compiled 15
RANK353_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler353-investigation.mjs benchmarks/experiments/euler353-quaternion.ra compiled 15
RANK353_TRUSTED_LOAD=1 RANK353_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler353-investigation.mjs benchmarks/experiments/euler353-quaternion.ra compiled 15
RANK353_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler353-verify.mjs
RANK353_RUNTIME=/absolute/built/packages/interpreter/out/index.js \
  node benchmarks/euler353-full-points-verify.mjs
```

The worker also accepts phase `moonpoints`/`mooncount` and a radius after Last;
phase timings exclude helper preparation. A final nonempty argument enables
counters. `RANK353_KERNEL_OUTPUT` writes hook-visible generated loop sources.
The proxy modifies constructed code after those hooks; hook text is not a dump
of the optimized callback form. `RANK353_TRUSTED_LOAD=1` also enables the proxy
for the small checker. Use it only in an isolated benchmark process.
Raw controls, prototype samples, checks and caveats are in
`baselines/2026-11-03-euler353-investigation.json`.

## Delivered implementation

The demo now uses exact quaternion/Hopf generation over odd divisors, compact
axis emission, and linear mirror-row construction. Releasing point codes after
decoding avoids retaining a no-longer-needed binding. The geometric pruning and
scalar dense search remain unchanged in meaning. All Rank lines are at most 40
characters. The unrolled generator was faster in one trial but used about 15 MiB
more peak RSS on Mac; compact axis emission is the chosen tradeoff.

Two general compiler improvements ship with the demo:

* Integer indexed loads in array-writing Number regions consume already validated
  numeric buffers. All entry validation, checked stores, arithmetic overflow and
  exact replay remain. Read-only packed BigInt passes retain actual-read guards,
  so unused unsafe cells do not cause premature failure. Copy admission thresholds
  are unchanged.
* Builtin unary chains such as `Reach sqrt ceil` use the existing application
  classifier and stay inside the loop kernel. Runtime builtin binding guards still
  reject changed `sqrt`/`ceil` definitions. Domain errors and preceding stores agree
  with reference execution.

Validation: 477 focused interpreter tests passed on Mac; 22 focused tests passed
on Intel. The demo fixture passed scoped type and differential audits (two blocks),
and TypeScript build and three exclusion-policy tests passed. Independent coordinate
scans match exact ordered point codes for all 15 default radii in both engines;
small unreduced sphere-orbit and Dijkstra oracles also pass. The full compiled
answer is `1.2759860331`, with geometric Number-kernel coverage and no overflow.
The repaired `euler353.mjs --radii=true --last=15` harness verifies every risk.

A pre-existing adaptive-loop test also failed at baseline `9e7c0711`: it expected
exactly one overflow, but exact replay can speculatively enter a nested Number
loop and produce two. Its full state/error comparisons passed. The assertion now
requires an overflow without fixing the number of speculative entries; the semantic
comparisons against reference and non-Number execution remain intact.

The full reference graph search remains unmeasured at the default and retains
its manual exclusion. The bounded fixture and full-scale point generation are
covered in both engines. No full suite or exhaustive corpus audit was run.

### Final measurements

Three paired serial fresh-process samples per host, Node 24.15.0, identical
full input through radius 32767. Tests and other own benchmarks did not overlap
on the measured host; unrelated machine load was not controlled. Medians:

| Host / execution | Before time | After time | Before peak RSS | After peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Mac M5, compiled default | 13.100 s | 7.328 s | 204.1 MiB | 206.0 MiB |
| Intel, compiled default | 29.096 s | 17.245 s | 197.8 MiB | 200.4 MiB |
| Mac M5, reference Last=9 only | 1.236 s | 1.199 s | 427.1 MiB | 473.8 MiB |

This is about 1.79x / 1.69x faster compiled, with a small compiled RSS increase,
not a memory reduction. Reference Last=9 has essentially unchanged time and a
46.6 MiB RSS regression. It does not establish the full reference performance.
The compact generator avoids most of the unrolled prototype's extra compiled
RSS, but reducing reference allocations remains open. All 18 measured answers
match their goldens. Raw final samples are under `delivery` in the baseline JSON.
Before runs use the baseline runtime and `experiments/euler353-original.ra`;
after runs use the delivered runtime and demo, without the Function proxy.
