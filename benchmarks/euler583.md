# Euler 583: bounded flap pairs and compiled comparison masks

Based on `35e3203d`; integrated the independent capability-matrix commit
`04eb7467` before delivery (no runtime changes in that commit).
Default perimeter limit remains 10000000; exact answer **1174137929000**.
The [statement](https://projecteuler.net/problem=583) checkpoint at 10000 is
**884680**. The original program is archived in `fixtures/euler583-original.ra`.

## Geometry and search

Let a be the halfwidth, t the flap height, s its sloping side and h the
rectangle height. An envelope needs all three hypotenuses integral:

    a^2+t^2=s^2,
    a^2+(h+t)^2=q^2,
    4a^2+h^2=d^2,
    h>t,
    2(a+h+s)<=P.

Integer halfwidth and flap height lose no envelopes. The integer diagonals
and rectangle height imply t=(q^2-s^2-h^2)/(2h) is rational. Then (2t)^2 is
an integer, hence 2t is integral; reducing the flap equation modulo four
forces both the width and 2t to be even.

The replacement generates Pythagorean flaps (a,t) once. Both orientations
of every coprime, opposite-parity Euclid pair and every allowed scale are
included. For a valid first flap, a+s<Limit=P//2. For the upper flap,
q<h+s by the triangle inequality, so a+q<Limit too. These inequalities also
imply that each flap's two legs sum below Limit. Thus limiting scaled leg
sums to Limit and retaining a+hypotenuse<=Limit cannot omit an envelope.

Keys a*Base+t use Base=Limit+1, replacing the fixed 23-bit packing assumption.
For each first flap, the second height u=h+t must satisfy

    2t+1 <= u <= Limit-a-s+t.

Two insertion queries find that exact interval within the sorted flap keys.
Ragged expansion enumerates its candidates. The difference of the two keys
is h directly: their halfwidth contribution cancels, avoiding a remainder
per pair. An integer square-root check on 4a^2+h^2 identifies the rectangle;
the selected perimeters are summed. Ordered heights prevent duplicates.

One explicit loop produces generator chunks for successive Euclid m values.
`concat unpack` joins them once, and search batches default to 4096 first
flaps. Smaller Batch values, including zero/negative clamping to one, retain
the answer. Large primitive/scale tables are local to one generated chunk.

## Compiler changes

Compound arithmetic comparisons now enter the existing implicit tensor frontend
at ordinary bindings and returns, including unary `not`. Logical and/or remain
outside this added frontend to preserve their short-circuit boundary. The
existing exact kernel writes comparisons directly into a boolean bitmap;
wide integers retain exact arithmetic. Existing real and unsupported layouts
keep their established paths. No language syntax or Number threshold changes.

A checked Number comparison-copy prototype was rejected. Ten million-cell
copies on Mac took 44.909 ms versus 38.517 ms for the previous exact kernel
(three samples; 100-repeat confirmation: 390.8 versus 328.8 ms). The new
program with implicit comparisons but without that speculative backend still
returned the full answer in 14.180 s / 825.9 MiB. The prototype is not shipped;
its measurements are kept separately from final results. Intel likewise
regressed: 86.534 → 125.504 ms for ten copies (three-sample medians).

The source-level geometry predicate remains an ordinary array function, so
reference execution performs native array operations rather than millions of
interpreted scalar callbacks. A larger numeric ranked-map experiment was
measured but is not included in this change.

Integration with diagnostic commits exposed a kernel identity regression:
each preparation acquired a new wrapper despite the cached underlying
kernel. A weak wrapper cache restores the existing identity contract and
preserves live traced/untraced execution. The old identity assertion caused
Vitest to exhaust its heap while formatting the mismatching AST-bearing
objects; no heap-limit increase is needed after the repair.

A pre-existing wide-layout test also assumed factory-time rejection. Native
Int64 word reads now permit a prepared runner to reject unsafe cells only at
demand. The assertion checks that rejection, zero numeric-copy allocation and
the exact final sum. The same factory/execution behavior was reproduced on
the frozen pre-change runtime.

## Measurements

| Host | Compiled before → after | Peak RSS before → after |
| --- | --- | --- |
| Mac M5 | 32.326 → 14.219 s (2.27x) | 1058.9 → 827.3 MiB |
| Intel i7-10750H | 71.300 → 36.777 s (1.94x) | 878.0 → 680.8 MiB |


Three alternating fresh-process old/new compiled pairs per host use the same
working runtime and check the full golden in every completed run. Full new
reference runs and bounded old/new reference pairs are recorded separately.
The original full reference timed out at 60 s on each host; remaining old full
reference repetitions were skipped. Final new full reference (one run each):
Mac: 21.646 s / 821.6 MiB; Intel: 54.519 s / 666.9 MiB. No exact full-reference speedup factor is
claimed.

Node v24.15.0 on Apple M5 arm64 and Intel i7-10750H x64. Timing includes
parsing/execution and excludes interpreter import; RSS is process high-water.
Diagnostics/profiling are off. No tests or other benchmarks launched by this
session overlap primary measurements on the same host.

| Host | Reference, P=100000 before → after | Peak RSS before → after |
| --- | --- | --- |
| Mac M5 | 6.697 → 0.304 s | 405.0 → 269.4 MiB |
| Intel i7-10750H | 21.075 → 0.857 s | 389.4 → 248.2 MiB |

These bounded reference samples came from the earlier measurement round;
reference execution does not use the rejected or final compiled backend.


| Host | Same-source compiler control: old runtime | Final runtime (3-run median) | Hot explicit comparison, old → final |
| --- | --- | --- | --- |
| Mac M5 | 16.258 s (one sample) | 14.219 s | 344.517 → 345.644 ms |
| Intel i7-10750H | 42.236 s (one sample) | 36.777 s | 756.743 → 799.510 ms |


The kernel control parses and constructs stored inputs before timing, warms
twice, and measures 100 copies of a million cells while checking every output bit.
It compares the frozen baseline runtime and final runtime on unchanged
source. Both use the same generated exact kernel body; the final control is
about 0.3% slower on Mac and about 5.6% slower on Intel. This microbenchmark does not
establish a general kernel speedup. The same-source full-program control is
one old-runtime sample versus the final three-run median; treat it as an
illustrative compiler contribution, not a separately repeated paired result.

## Experiments not selected

An initial all-at-once flap-pair program took 25.935 seconds / 1362.9 MiB on
Mac, versus 31.973 seconds / 1056.4 MiB for the original control. Its memory
increase was unacceptable. Decoding packed keys with remainders per pair
accounted for much of its generated-kernel work. Replacing those remainders
with key differences and generating local chunks removes that cost and the
large live primitive tables. A scalar rank-0 predicate still imposed many
call boundaries; an experimental bulk ranked map improved that alternative
but was not retained. The final predicate uses ordinary array operations and
the smaller compound-comparison compiler improvement.

Exploratory samples used evolving compiler stages and are kept separately
from paired primary measurements. Their timings are not repeated medians.

## Verification and reproduction

1079 distinct focused checks pass on each host, including the 312-case
compiler capability matrix. Six filtered Mac corpus checks (main and fixture
in differential, inferred types and name facts), the TypeScript build and five
exclusion-policy checks also pass.
Nine capability-matrix snapshots were updated for the newly admitted
comparison path; traced, untraced and reference results still match.

An independent oracle tries integer a,t,h directly and checks the three
squared diagonals; it uses no Euclid parameters, packed keys, insertion queries
or ragged expansion. It independently reproduces 884680 and checks empty,
small, first-envelope and inclusive perimeter boundaries through 10000.
Tests cover batch clamping, original-program comparisons through P=1000000,
and the full golden in compiled/reference and tensor/scalar-kernel-disabled
modes. The original fixture is unchanged and the full main returns to ordinary
corpus execution. Full npm test and exhaustive audits were not run.

```sh
node benchmarks/euler583.mjs compiled
node benchmarks/euler583.mjs reference
node benchmarks/euler583.mjs plain-arrays
node benchmarks/euler583.mjs compiled 10000000 benchmarks/fixtures/euler583-original.ra
node benchmarks/euler583-boolean-copy.mjs 1000000 100
```

`RANK583_EXPECTED` checks the answer; `RANK583_RUNTIME` selects another built
runtime. Separate diagnostic/profile runs use `RANK583_DIAGNOSTICS=1` or
`RANK583_PROFILE=path`. Raw samples: `baselines/2026-11-10-euler583.json`.
