# Project Euler

Mathematical programming problems from [Project Euler](https://projecteuler.net/). Individual examples link to the original problem.

## Folders

- [Problem input files](fixtures/) — Official [Project Euler](https://projecteuler.net/) input files for problems that need external data.

## Scalar loops in problems 121-200

Most solutions are array code. These keep a scalar loop because an
array form would be far slower (estimated from operation counts at
about 0.25 us per element and operation), or because the work is
sequential (a depth-first search or a union-find). Problems 125,
126, 127, 129, 130, 142, 149, 159 and 195 were first written as loops
and then rewritten as array code.

| Problem | Why a loop | Array form |
|---|---|---|
| 141 | 2 x 10^7 candidate squares | ~75 s estimated |
| 150 | 1.7 x 10^8 sub-triangle sums | over 200 s estimated |
| 186 | union-find over 2.3M calls | sequential |
| 193 | Moebius sieve to 2^25 | ~50 s estimated |
| 196 | 5 row strip, neighbour counts | ~100 s estimated |
| 198 | Stern-Brocot walk | sequential |

These costs depend on the operation and whether a loop qualifies for safe Number
registers or uses exact BigInt operations. See issues #307, #308, #309, #311,
#312 and #316.

Euler 150 accumulates its row start once per row. Its read-only search uses
safe Number registers while public integer values remain exact BigInts.
The original and current formulations, runtime-only comparison and differential
coverage audit are recorded in [the integer-loop benchmark](../../benchmarks/number-loops-results.md).

Euler 126 uses stored mask compaction and fused arithmetic updates (#308).
Its layer-generation benchmark and full counting costs are reported separately
in [performance measurements](../../docs/design/performance-measurements.md#stored-mask-materialization-and-compound-arithmetic-308).

Euler 141, 155 and 170 use numeric builtins inside compiled integer loops (#309).
Their old/new formulations and the scalar `gcd` comparison are covered by
[the numeric loop benchmark report](../../benchmarks/numeric-loop-calls-results.md).

Euler 136 consumes the segmented prime source and starts after 2, avoiding an
extra odd-prime mask. Source generation, bounded membership and the complete
demo are timed separately in [the prime sequence benchmark](../../benchmarks/prime-sequences-results.md).

## Problems 201-300

All of 201-300 are written, one program and one test file each. Most
use arrays; where a problem needs a search or a table that arrays do
not give (a state machine over partitions, a union find, a depth first
search), the program is scalar loops over integer arrays, which the
interpreter compiles. A few depend on an answer found by a guess that is
named in the program, as 256 (the least s is looked for among multiples
of 55440) and 262 (a grid of step 2 for the contour).

Default inputs that take a minute or more keep their tests on smaller
inputs: 210, 212, 224, 245, 250, 253, 262, 266, 268, 272, 275 and 300.
Others have the default input in the test and take from 10 s to 2 min:
213, 229, 233, 236, 238, 247, 251, 254, 260, 283, 289, 291, 292, 295.
The long ones are left out of the type, name-facts and differential
audits because the reference interpreter is far slower than the
compiled loops.

Notes from this range, for the next one:

- `A gcd B` and `A isqrt` use postfix arguments. `A max B` takes one operand
  on each side; group addressed or arithmetic operands when needed.
- A Boolean array does not sum: use `count` (#392).
- Ordinary assignment completes a gathered or sorted array (`A Order`),
  so a later loop reads stored cells. Use an apostrophe to retain a plan.
- A compiled loop checks its arrays when it is entered, so a small loop
  inside a loop that is not compiled costs the size of the array each
  time (#390). `**` and `isqrt` stop a loop from compiling (#391).

## Lowest-cost search (328)

Euler 328 visits the accepted subtree sizes directly and precomputes path-cost
offsets instead of recursively evaluating each tree. Its full N=200000 run
returns 260511850222 in about 3.8 seconds on the measured Apple M5. The search
retains the original candidate window. Interpreter-only timings, profiles,
correctness checks and reproduction commands are in the
[benchmark report](../../benchmarks/euler328-results.md).

## Special partition counts (333)

Euler 333 counts partitions by parity and successive powers of three, using
fresh dense rows instead of returning a count array through recursive branches.
The default limit is one million; the prime sum is 3053105. The original
recursion, an experiment with the existing shared `counter`, the recurrence
and per-cell oracle checks are recorded in the
[benchmark report](../../benchmarks/euler333-results.md).

## Problems 401-450

Written: all of 401-450, one program and one test file each. The tests
keep to small inputs; the statement values and published checkpoints are in
the tests. How the default answers were checked: 424, 438 and 450 were
recomputed in full with an independent Python program (a solver, or a port of
the same method). 414 (base 1803), 433 (N = 10^6), 428 and 441 (small bounds,
brute force) were checked independently only on smaller inputs. Every other
default was compared with the published answer, recalled from memory and not
fetched, and its statement values and checkpoints are in the tests.

Default runs that take more than about 25 s are left out of the type,
name-facts and differential audits
(`scripts/demo-execution-exclusions.json`).

No APL, J or K solutions for 401-450 turned up in a web search (the
collections found stop near problem 100). Method sources: eulersolve.org
for the outlines, and public C++ for 433 (eulersolve.org) and 438 and 450
(roosephu/project-euler), whose default answers were checked against a
Python port of the same method.

Programs that are scalar loops rather than array code, and why:

| Problem | Why a loop |
|---|---|
| 417 | order of 10 per number from a smaller prime-power order and lcm, in increasing order |
| 423 | one row of a binomial sum per step, sequential recurrence |
| 424 | backtracking over letters and cells |
| 425 | union-find over edges in order of the larger prime |
| 426 | stack pass over the runs |
| 433 | floor sum that follows the Euclid steps for each pair |
| 437 | per prime: square root of 5 and a primitive-root test |
| 438 | depth-first search over the coefficients |
| 445 | exponents of C(N, k) updated from k to k + 1 |

The slowest defaults, compiled, on an M5 with power saving off (figures
taken in low power mode are about 3 times higher): 414 (1.9 min), 413 (95 s),
424 (92 s), 415 (74 s), 448 and 437 (68 s), 421 and 438 (57 s), 427 (56 s),
439 (48 s); the rest take under a minute. Most of those are tables of 10^7
cells with a recursion over the values N // k for N near 10^11 (415, 432,
439, 447, 448), or a sieve over 10^7-10^8 integers.

Notes from this range:

- What made the slow defaults faster, in order of effect: a scalar walk with
  memoised distances instead of pointer jumping (414, 5x); generating the
  stations in a scalar loop and deduplicating inside the sort loop (411, 11x);
  incremental per-run state in a backtracking search (424, 2.4x); an interval
  and a closed sum for the last coefficient (438, 2.4x); scalar term loops
  instead of arrays of N / k cells (427, 1.8x); `choose`, `min` and compares
  replaced by splitting a sum at the table boundary (415, 439) or by boolean
  `and` (420). `choose`, `min` and `max` on large integer arrays are 4-5x
  slower than `+` or `//` today (#417), and loop bodies above 32 statements
  fall back to the interpreter (#419).
- 414 first used pointer jumping over all (u, v) states of a base: about 100
  passes over B^2 / 2 cells, 515 s in all. The chains to the constant are
  hundreds of steps long, so a scalar walk with memoised distances (one step
  per state) takes 111 s and needs no array of next states.
- Ordinary assignments complete arrays built from slices, gathers and
  `choose`. Apostrophe bindings keep plans and recompute on each demand;
  retain reused intermediate results with ordinary assignments.
- A mask built from a range (`1 to N`) was rejected by `choose` (#401).
- `for E in 0 to X len - 1` keeps the loop out of the compiler; with a
  union-find in the body the guard rescans the array on every iteration, so
  hoist the bound into a variable (#390).
- Slice writes into a 10^7-cell array cost about as much as the array size
  per write, so loops that write once per prime should be batched by the
  step index instead (446).
- `for D in 1 to X isqrt` loops over `isqrt` of every number from 1 to X: use
  `Xr = X isqrt` first.
- Integers wider than 64 bits promote to BigInt arrays, which is fine for
  small tables and very slow for 10^7 cells. Reduce products modulo before
  they pass 9 x 10^18 (and split a factor at 2^15 for matrix products, 416).

## Problems 462-550

Written: all of 462-550, one program and one test file each. The tests
keep to small inputs, statement values and brute-force checks. Every
default answer was compared with the eulersolve.org C++ solution compiled
locally, or with its Python solution or an independent Python program where
the C++ needs Boost (524, 538, 542).

Defaults that take 10 s or more are left out of the audits
(`scripts/demo-execution-exclusions.json`) with the time and the reason; 505
(an alpha-beta search of about 2 x 10^9 nodes) is not reachable in the
interpreter.

No APL, J or K solutions for this range turned up in a web search (the
collections found stop near the early problems).

Methods that differ from the eulersolve outlines:

- 524 uses F(P) = sum of 2^s over the entries that are not left-to-right
  maxima, s the number of smaller entries before; a greedy pass with a
  memoised completion check builds the permutation instead of storing it.
- 529 squares polynomials by indexed accumulation (`.accumulate` at i + j)
  and reduces them through a matrix of x^(R + k) with split real matmul.
- 533 sieves log M(t) over every t instead of a highly-composite search.
- 541 writes the block sum as a closed form in Stirling numbers.
- 536 recomputes each branch's congruence from its chosen primes, so
  every CRT step stays below 10^18, and checks a cofactor u by tables of
  lambda(u) up to 10^7 or by 2^(m+3) = 1 mod u and trial division.
- 544 counts colourings by the number of colours used, so the sum over q
  is a sum of falling factorials, and keeps one count row per pattern.
- 550 proves that the Grundy value depends only on Omega(x).

Notes from this range:

- Postfix calls take the whole left side: `A + B sum`, `0 till L len`,
  `X - (Y) integer` and `for V in 2 to N isqrt` all misparse; bind the
  operand first. Binary `max` is now infix (`A max B`).
- Copy a slice before `matmul`; a lazy slice is read cell by cell (#431).
- Group sums, histograms and polynomial products are fastest with indexed
  accumulation (`H Ix += V .accumulate`).
- Range values, slice reads and `copy` keep loops out of the compiler
  (#432); lifted `powmod` maps element by element (#433); integer
  `reduce + axis 0` and `concat axis 1` are slow (#434); strided integer
  writes cost about 140 ns per cell (#435); real arrays miss the integer
  fast paths (#431).
- `binomialmod` builds factorial tables up to N; for N near 10^8 use a
  falling product instead.
- `choose` with boolean branches built by comparisons returns numbers
  (#436); combine masks with `and` / `or` instead.
