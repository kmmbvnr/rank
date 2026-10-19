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
