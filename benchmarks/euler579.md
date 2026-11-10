# Euler 579: odd-norm quaternion orbits and array batches

Base: `7e017363bf7d06e8b62662a1cd71a6bef14a5327`.
The default N=5000 retains **3805524** modulo 10^9. Statement checkpoints
include S(5)=5832 and S(50)=29948928129 (948928129 modulo 10^9).

## Algorithm and correctness

The original program walks almost a billion signed integer quaternions, tests
parity and primitivity, constructs nine rotation entries and loops over scales.
The existing Number loop already compiles that work; the search size is the
main bottleneck, rather than scalar interpretation of the hot loop.

An integral orthogonal frame has det(R)^2=(L^2)^3, so its side L is integral.
If L were even, reducing each column norm modulo four forces every entry even;
a primitive integral cube therefore has odd side length. Its 24 proper edge
frames admit primitive quaternion parameters with normalization divisors 1,2,4.
Right multiplication by cube rotations converts the even-norm representations
to odd norm: a two-odd-coordinate quaternion uses a quarter turn, and an all-odd
one uses a Hurwitz unit and removes the common factor. Exactly four projective
quaternions of odd norm remain per cube, related by the integral quaternion
units 1,i,j,k. This reduces the norm bound from 4N to N and avoids the other
parity classes entirely. All positive integer scales remain represented.

Order nonnegative components as A>=B>=C>=D. Orientation-preserving signed
coordinate permutations form a group of order 192. Their quaternion rotations
act by signed axis permutations on the left and right of the 3D edge matrix,
preserving box placements and the sum of primitive edge gcds. Central sign
identifies q and -q; division by the four odd-norm frames per cube gives 24
for a generic orbit.

Let H=2^z * product(m!), where z counts zero components and m are multiplicities
of equal components. Repeated or zero parts have a determinant-negative
stabilizer, so the two sign classes merge and their total weight is 48/H.
For four distinct nonzero parts, there are two separate orbits of weight 24.
They are represented by R(q) and R(q)^T. Transposition cannot generally be
omitted: its row spans and column gcds can differ. A separate mutation experiment drops that second contribution and changes
N=150; retained unit comparisons with the unrestricted old search include
N=150 and 200, where the two-orbit case occurs.

For an odd-norm primitive frame with side L and sum D of the edge gcds, scale
k contains L^3*k^3+L*D*k^2+D*k+1 lattice points. Row absolute sums give spans
x,y,z and placements (N+1-k*x)(N+1-k*y)(N+1-k*z). Prefix scans and upperindex
expand only admissible component values and scales; gcd uses the library
operation. All products and totals remain exact integers until the final mod.
No manual modular multiplication or nested loops remain.

The Rank source has no explicit loops, uses rank-0 calls for the outer batches,
and keeps every line within 40 columns. Its simultaneous array work is bounded
by one largest-component batch, rather than the full quaternion frontier.

## Compiler and execution

No compiler change is needed for this case. A separate diagnostic run of the
first array prototype records 3430 compiled tensor stages and stored integer
array kernels. The main helpers do not compile as single scalar functions:
array boolean conjunction and axis maximum currently reject that proof. The
profile instead spreads its remaining time over stored arithmetic, array reads,
binding/shape preparation and GC; compiled and reference execution of the new
source have similar speed. Expanding the whole-function proof is therefore
not required to remove this workload's bottleneck. Existing arbitrary-precision
array arithmetic preserves the large point/placement products in both engines.

## Measurements

| Host / input / mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / 5000 / compiled | 99.604 | 0.756 | 387.8 | 348.7 |
| Mac / 1000 / compiled | 4.452 | 0.334 | 380.5 | 208.1 |
| Mac / 50 / reference | 0.794 | 0.180 | 203.3 | 183.0 |
| Mac / 5000 / reference | not run | 0.715 | not measured | 366.5 |
| Intel / 5000 / compiled | 191.051 | 1.953 | 384.5 | 335.2 |
| Intel / 1000 / compiled | 8.336 | 0.937 | 381.5 | 194.5 |
| Intel / 50 / reference | 2.259 | 0.480 | 190.1 | 170.6 |
| Intel / 5000 / reference | not run | 1.971 | not measured | 322.8 |

Time includes parsing/execution and excludes interpreter import. RSS is the
process high-water mark, not allocation volume. Node v24.15.0, Apple M5 arm64
and Intel i7-10750H x64. Diagnostics/profiling are disabled in primary samples.
Intel was nearly idle before measurement (load 0.03/0.08/0.20). Tests and other
benchmarks from this session do not overlap final primary samples on a host.
The same unchanged runtime is used for old and new sources.

The old full compiled number is one control per host, not a repeated median.
Three alternating old/new pairs at N=1000 compiled and N=50 reference provide
repeated same-input comparisons. New full compiled/reference numbers each use
three fresh processes. Old full reference was not run; no full-reference speed
ratio or old full-reference RSS improvement is claimed. The historical 2.3-minute
catalogue estimate is not substituted for a current measurement.

Raw results also retain the first Mac measurement batch, which may overlap a
36 ms exclusion-policy check; it is excluded from final primary statistics.
An accidental repeat of the old full compiled source, launched after a style
assertion prevented adoption, was externally stopped with SIGINT (exit 130).
No completion time, RSS or answer is assigned to that interrupted process.
Loop and rank-0 prototypes retain their completed observations separately.

## Verification and reproduction

37 Euler checks pass on each host. A direct geometry oracle enumerates integer
orthogonal edge frames, canonicalizes all eight vertices and counts lattice
points with dot-product inequalities for boxes 0..5. It uses no quaternions,
orbit weights or lattice-point polynomial. Larger cases through 200 match the
old unrestricted quaternion search. Statement checkpoints and the full golden
run on compiled, reference and scalar-kernel-disabled routes.

Six filtered Mac corpus checks pass for the main and fixture: differential,
inferred types and name facts. TypeScript build and five exclusion-policy
checks pass. The main returns to ordinary full-size corpus execution; the
fixture and its original assertions are preserved. No full npm test or exhaustive
corpus audit was run.

```sh
node benchmarks/euler579.mjs compiled
node benchmarks/euler579.mjs reference
node benchmarks/euler579.mjs exact
node benchmarks/euler579.mjs compiled 1000 benchmarks/fixtures/euler579-original.ra
```

`RANK579_EXPECTED` checks an answer; `RANK579_RUNTIME` selects a built runtime.
`exact` disables scalar function kernels and Number loops, while other compiled
backends stay enabled. `reference` disables compilation. Separate diagnostics
use `RANK579_DIAGNOSTICS=1`, profiling `RANK579_PROFILE=path`.
Raw results: `baselines/2026-11-10-euler579.json`.
