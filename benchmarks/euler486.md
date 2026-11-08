# Euler 486: count CRT pairs without constructing them

[Euler 486](https://projecteuler.net/problem=486) now returns the same full answer, **11408450515**, without constructing the final CRT Cartesian product. This is a program change using existing array operations and native searches; the compiler/runtime is unchanged.

## Why the old default and fixture cost almost the same

Both inputs built the same full-period residue sets, including 14598744 candidate pairs before compatibility filtering and 7299372 surviving residues across six offsets. L only affected the final counting pass. The original mathematics was sound, but materializing these arrays was unnecessary for a count. On the current baseline, this already took about two seconds on Mac rather than the roughly 25 seconds recorded in the original issue table.

The baseline CPU profile is dominated by packed arithmetic, wide comparisons, choice masks and reduction. Those operations already use native array paths. Further lowering of the same large intermediate arrays would retain most of their memory traffic. The new algorithm removes that traffic.

## Exact periodic construction

A palindrome of length at least five contains a central palindrome of length five or six. A 32-state binary automaton therefore counts avoiding strings by retaining the last five bits. Its complete state at length 15 equals its state at length 9. Deterministic transitions prove that the avoider counts repeat forever with period six: 32, 34, 36, 34, 32, 32.

For n=9+6t+u, with 0<=u<6, the cumulative palindrome-containing count is

`F(n) = 2^(10+u) * 64^t - 200t - Bias[u]`,

where Bias is 182, 216, 252, 286, 318, 350. The constants are the initial cumulative avoiding counts plus two, not precomputed answers. Lengths five through eight do not contribute solutions.

For each modulus 9, 1997 and 4877, fixing t modulo the multiplicative order of 64 gives one linear congruence modulo that modulus. Existing `powmod` operations construct its residues. A recursive Euclidean inverse replaces the manual loop, and modulus-dependent tables are prepared once. The first two sets join into 998 residues. The final set has 2438 residues.

## Count the final join with circular intervals

Let the remaining constraints be t=a modulo Ma and t=b modulo Mb. Put g=gcd(Ma,Mb), w=Mb/g, and v=inverse(Ma/g,w). A compatible pair has a=b modulo g and

`t = a + Ma * k`, where `k = ((b-a)/g * v) mod w`.

Sort keys `(b mod g)*w + ((b//g)*v mod w)`. Each compatibility class occupies one contiguous key interval. For a fixed a, subtracting `((a//g)*v) mod w` rotates its keys. A bound on t therefore becomes one circular interval in that class; four batched `upperindex` queries count its two possible pieces. Class endpoints also count all compatible pairs.

Split the limit once as `Limit = Whole*Period + Rest`, where `Period=Ma*w`. The answer is Whole times the compatible-pair count, plus the interval counts for Rest. The large L never participates in a per-cell wide subtraction. The algorithm sorts 2438 keys and queries them for 998 left residues instead of materializing 1216562 final residues per offset.

The complete n period is **639821496386412**, containing **7299372** solutions. Scalar quotient arithmetic remains arbitrary precision. The CLI also verifies L=10^40+123 with the exact result **114084507026185280700537284409048**.

The Rank source has no explicit loops, uses existing library functions, keeps helper parameters to at most three, and fits every line within 40 columns. No language or compiler change was needed: the small array stages and searches already execute efficiently. The unchanged statement fixture still returns 51.

## Measurements

Baseline: **686143652baebfebc65283eae0635296954ae55b**. Each entry is the median of three alternating fresh-process rounds on the same runtime, for both compiled and reference modes. Timed execution includes parsing; runtime import/construction is outside the timer. Both hosts had background work, including a ZFS scrub on Intel. These are loaded-host observations. Source/runtime hashes, CPU time, load and free memory are retained in the raw artifact.

| Host | Mode | Seconds, before → after | Peak MiB, before → after |
| --- | --- | ---: | ---: |
| Mac | compiled | 2.007 → 0.169 | 339.7 → 186.0 |
| Mac | reference | 1.777 → 0.158 | 342.1 → 184.6 |
| Intel | compiled | 3.132 → 0.438 | 309.4 → 170.9 |
| Intel | reference | 2.807 → 0.418 | 347.0 → 173.4 |

The default and fixture remain eligible for ordinary corpus execution; no exclusion was added or removed.

## Verification

Each host passed **104 tests in six focused files**, plus both selected differential cases for the default and its fixture. Source/test TypeScript builds passed. No exhaustive audit was run.

The independent C++ oracle explicitly joins every compatible CRT pair, then counts each resulting residue. It confirms the full answer, statement value, period and residue count. Its first twenty solutions check inclusive boundaries at n-1, n and n+1. Tests also cross a complete period and verify an arbitrary-precision limit by combining a full-period count with a separately enumerated remainder.

The independent binary automaton checks the statement's F(4), F(5), F(6) and F(11), proves the state-cycle repetition, and checks all six offset classes modulo all three factors through length 5000. Generic join-count tests compare against explicit pair enumeration with non-coprime periods, empty inputs, duplicates, wraparound endpoints, multiple periods, negative limits and integers wider than 64 bits. These checks run on compiled, reference and exact-loop backends. The original Rank fixture is unchanged.

## Reproduction

Build the interpreter output, then run from the repository root:

- `node benchmarks/euler486.mjs compiled` or `reference` executes the full default. `RANK486_EXPECTED=11408450515` checks its answer.
- `node benchmarks/euler486-compare.mjs 3` runs the alternating comparisons on the same runtime.
- `node benchmarks/euler486.mjs compiled 5000000000` checks the statement input.
- Compile `benchmarks/experiments/euler486-oracle.cpp` with `c++ -O3 -std=c++17`; its default invocation independently verifies the full input. Its optional argument selects another limit within signed 64 bits.

Raw data: [2026-11-08-euler486.json](baselines/2026-11-08-euler486.json).
