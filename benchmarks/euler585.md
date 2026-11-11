# Euler 585 nested square roots

Base `73fcd234`. The full answer is **17714439395932**.
The [problem](https://projecteuler.net/problem=585) counts distinct values
that can be denested into signed sums of square roots.

The program keeps the original three counts. Let `r(s)` count coprime
positive pairs `u > v` with `u² + v² = s`. Let `a(s)` be `phi(s)` with
one subtracted at each of 1 and 2. The count of primitive two-root forms
with sum `s` is `a(s)/2 - r(s)`. The answer is `C1 + (C2 - C3)/2`.

The first two counts use quotient groups and a memoized summatory
totient. The program generates primitive sums in blocks and keeps their
multiplicities. For `E(n) = sum r(s) floor(n/s)`, the divisor identity
`sum phi(d) over divisors of m = m` gives
`C1 = floor((N-1)²/4) - E(N)`. Expanding the convolution for C2 gives
`(A - 2C + D)/4 - B + E(N) + E(N/2) + F`, where

- `A = sum phi(s) triangle(floor(N/s))`
- `C = triangle(N) + triangle(floor(N/2))`
- `D = N + 2 floor(N/2) + floor(N/4)`
- `B = sum r(s) triangle(floor(N/s))`
- `F = sum r(s) r(t) floor(N/(s*t))`

C3 groups primitive kernels by the squarefree part of their radicand
product. A class needs a minimum norm at most `floor(sqrt(N))`. With
minimum `m`, it only needs kernels with norm at most `N // m`. For
squarefree factors `Left < Right`, the bound
`4 Left Right³ <= N²` follows from `m >= 2 sqrt(Left Right)`. This
limits enumeration before looking up the exact class minimum.

Each class stays in one batch. Keys sort by class and norm and retain
duplicate norms. At least one norm of every contributing pair is at most
`floor(sqrt(N))`. The same threshold count handles F and C3. For a fixed
lower norm `s`, count partners below each `floor((N // s)/k)`. Group
identical thresholds and multiply by their multiplicities. Doubling
the result and subtracting the diagonal restores ordered pairs without
an array of all pairs.

The source has one explicit loop for squarefree flags. A separate
runtime change removed redundant selector materialization discovered
while profiling the array implementation. See [stored view measurements](selector-views.md).

## Measurements

Node 24.15.0 on Apple M5 and Intel i7-10750H. Results are medians of
three fresh-process samples per variant. Before and after samples
alternate when both variants complete. Intel ran alongside another
Node workload. Raw results include load and process CPU time.

| Host and workload | Before (s) | After (s) | Before RSS (MiB) | After RSS (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Mac compiled, N=5000000 | 5.886 | 4.540 | 439.7 | 712.8 |
| Intel compiled, N=5000000 | 17.511 | 15.744 | 411.1 | 609.4 |
| Mac reference, N=50000 | 2.414 | 0.434 | 312.9 | 293.6 |
| Intel reference, N=50000 | 7.898 | 1.413 | 296.0 | 272.4 |
| Mac reference, N=5000000 | >60 | 4.217 | — | 678.7 |
| Intel reference, N=5000000 | >60 | 15.269 | — | 549.2 |

The array algorithm shortens full compiled wall time and raises peak
RSS. It also raises compiled process CPU time. The reference mode
accounts for most of the gain. Grouping work by class and counting
quotient thresholds reduced memory from the early prototype, which
expanded all pairs and exceeded 2 GiB on Mac.

32 focused checks pass on each host. These compare the individual
counts against the original at small bounds and check the full result
in both modes. The two filtered Mac differential cases cover the demo
and its statement fixture. The TypeScript build and five execution
policy checks pass.

## Reproduction

```sh
node benchmarks/euler585.mjs compiled
node benchmarks/euler585.mjs reference
node benchmarks/euler585.mjs reference 50000
node benchmarks/euler585.mjs compiled 5000000 benchmarks/fixtures/euler585-original.ra
```

Each timed run checks the answer and all three counts. The driver
includes parsing and execution and records process peak RSS.

Raw samples are in [the benchmark record](baselines/2026-11-11-euler585.json).
