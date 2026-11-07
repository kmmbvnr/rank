# Euler 450: hypocycloid lattice points

The full answer remains **583333163984220940** at N = 1000000. The rational
unit-circle/Pythagorean derivation is retained. The change removes scalar
enumerations and expresses the remaining work through existing array kernels.
There is no shared interpreter/compiler code change in this task.

Primitive triples need u²+v² <= sqrt(N), so u only reaches the integer fourth
root of N. A small broadcast grid checks the bound, coprimality and opposite
parity, then builds all four signed orientations. This replaces the previous
nested search through u <= sqrt(N). Ranked calls handle the points. Power,
order and point helpers each have at most one loop, with no nested Rank loop
statements. Non-coprime orders are skipped before computing their coordinates.

The sum over the four trivial angles has a closed form. For H = floor(N/2),

```
Trivial(2H)   = 2H * (7H² - 3H - 4) / 3
Trivial(2H+1) = Trivial(2H) + 7H² + 3H
```

It stays in exact scalar arithmetic, avoiding the old accumulating Number
loop's overflow and replay.

The original correction sums over d and multiples R of d, weighted by mu(d)
and cos(pi*R/2). Odd R contribute zero. Writing R = 2m and pairing odd u with
2u uses mu(2u) = -mu(u). If j = m/u, their combined factor is

```
mu(u) * u * [j(j+1) - 2*floor(j/2)*(floor(j/2)+1)]
```

For even m this reduces to m*phi(m). For odd m > 1, the identity
`sum(mu(u), u divides m) = 0` gives the other coefficient:

```
P(m) = product(1-p, distinct primes p dividing m)
g(m) = m*phi(m)                 when m is even
     = -(m*phi(m) + P(m)) / 2   when m is odd and m > 1
Correction = sum(g(m) * T(N // (2m)), m = 2..floor(N/2))
T(q) = q(q+1)/2
```

The excluded R=2 case gives g(1)=0. One private prime-power sieve builds phi
and P through N/2; final arithmetic and summation use arrays. It replaces the
Mobius table through N and the O(N log N) scalar multiple loop.

An explicit lazy-stage version was tested but rejected: on Mac it took about
0.93 s / 278 MiB compiled versus about 0.33 s / 242 MiB for the chosen array
stages. A range-view alternative did not materially reduce peak RSS. The
selected program favors speed and keeps the arithmetic visible in Rank.

## Measurements

| Host / mode | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac, compiled | 1848.27 | 412.20 | 233.80 | 241.05 |
| Mac, reference | 13497.39 | 475.58 | 480.70 | 349.11 |
| Intel, compiled | 3517.48 | 878.05 | 220.12 | 229.54 |
| Intel, reference | 38473.91 | 1300.55 | 456.43 | 328.09 |

Three alternating before/after pairs per mode and host run in fresh Node
v24.15.0 processes. Both variants use the unchanged c9fa35b4 interpreter.
Timings include parsing and execution, and RSS is process peak. Source hashes
and host-load readings are retained in the raw data. Intel pre-run readings show 98–100% CPU idle and no active swap traffic.

Compiled execution is about 4.0–4.5 times faster and reference execution
about 28–30 times faster. Reference peak RSS drops about 27–28%. Compiled
peak RSS rises by about 7–10 MiB (about 3–4%); the additional coefficient vectors
trade a small memory increase for the faster arithmetic. Lazy stages and
a range-view spelling did not improve that tradeoff in the experiments.

## Verification

21 focused tests pass on each host. A separate BigInt oracle retains the old
scalar Pythagorean search, direct trivial-point sum and double Mobius sum.
It checks each of the three components and the total for 18 limits in all
three execution modes, including zero, one, parity and square boundaries.
Another 499 coefficients are compared with their direct divisor sums.
The full default answer, 632 signed triples and zero Number replay are
asserted. Both Rank fixture tests pass in all three modes, including repeated
runs with changing N and their full default. Source/test TypeScript checks
pass. Exhaustive audits were not run.

The current compiler already executes the fresh coefficient sieve as a
private Number region. Native array operations do the bulk of the remaining
work in reference mode too; the remaining scalar point work is small. The
reference/compiled gap is reduced by changing computation granularity rather
than adding a task-specific compiler optimization.

Raw measurements: [24 full runs](baselines/2026-11-07-euler450.json).
From the repository root:

```sh
git show c9fa35b4:demos/euler/450_hypocycloid.ra > /tmp/euler450-before.ra
node benchmarks/euler450.mjs compiled 1000000
node benchmarks/euler450.mjs reference 1000000
node benchmarks/euler450.mjs compiled 1000000 /tmp/euler450-before.ra
```

Use RANK450_RUNTIME with an out/index.js file URL to select a control runtime.
