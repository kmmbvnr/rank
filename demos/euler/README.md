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

- `A B gcd`, `A isqrt` and `A B max` are postfix calls and take everything
  to their left, so use named intermediates.
- A Boolean array does not sum: use `count` (#392).
- A gathered or sorted array (`A Order`) is lazy; `copy` it before reading
  it in a loop, or the loop does not compile.
- A compiled loop checks its arrays when it is entered, so a small loop
  inside a loop that is not compiled costs the size of the array each
  time (#390). `**` and `isqrt` stop a loop from compiling (#391).

## Problems 401-450

Written: all of 401-450. One program and one test file each. The default
answers were checked against the published ones, and the tests keep to small
inputs, so the default runs that take more than about 25 s are left out of the
type, name-facts and differential audits (`scripts/demo-execution-exclusions.json`).

The slowest defaults, compiled (417, 418, 420, 433, 437 take 35-160 s;
424 takes 11 min and 438 3.5 min): 414 (28 min, one pass per base and a
pointer-jumping depth), 427 (6 min), 446 (6 min), 413 and 415 (5 min), 411
(4 min, patience sorting over 5 x 10^7 integers), 439 (4 min), 448 and 421
(3 min), 407, 429 and 432 (2 min). Most of those are tables of 10^7 cells with
a recursion over the values N // k for N near 10^11 (415, 432, 439, 447, 448),
or a sieve over 10^7-10^8 integers.

Method sources: 433, 438 and 450 follow public C++ solutions
(eulersolve.org for 433; roosephu/project-euler for 438 and 450).
Their default answers were checked against a Python port of the same
method.

Notes from this range:

- A statement that builds several derived arrays from slices, gathers and
  `choose` stays lazy, and each later read evaluates the whole expression for
  every element. `copy` after each statement gave 2-5 times (#402).
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
