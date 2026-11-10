# Euler 581: bounded Pell searches instead of smooth-number sorts

Base: `7ee2914c52a247e11e6e84b3d0713fa475db971c`.
Default B remains 10000000000000; exact answer **2227616372734**.
The [problem](https://projecteuler.net/problem=581) asks for the indices of
47-smooth triangular numbers. The existing parameter still bounds indices by
2B; this change preserves that search domain and its default.

## Counting argument

Because dividing by two removes no prime above 47, n(n+1)/2 is 47-smooth
exactly when both n and n+1 are. Write their product as D*z^2, where D is its
unique squarefree part. All primes of D must be among the fifteen through 47.
Folding those primes builds all 32768 subset products; D=1 cannot give a
positive consecutive pair and is discarded. Setting X=2n+1 and Y=2z gives

    X^2 - D*Y^2 = 1,
    n = (X-1)//2,
    X <= 4B+1.

Conversely, a positive solution with odd X gives an integer n. Squarefree D
forces Y to be even, so n(n+1)=D*(Y/2)^2. It therefore suffices to check that
Y is 47-smooth. Different D cannot duplicate n, because its squarefree part
is unique. D may exceed X: the valid pruning bound is D<=Maximum^2-1.

For each nonsquare D, continued fractions of sqrt(D) find the fundamental
positive solution. Numerators increase, so passing Maximum permits an early
exit without finding the complete period. Powers of the fundamental unit
produce every positive solution, again stopping at Maximum. These standard
Pell facts are proved in [Ben Lynn's continued-fraction notes](https://crypto.stanford.edu/pbc/notes/contfrac/pell.html).
The program uses one explicit loop to advance first through convergents and
then through powers; the squarefree parts are mapped with rank 0.

If P is the product of the fifteen primes and K is the bit length of Maximum,
every Y<Maximum has each prime exponent below K. Thus gcd(Y,P^K)=Y is an
exact smoothness test. It avoids factoring thousands of candidates and uses
arbitrary-precision integers throughout. Negative B and B=0 return zero.

## Compiler and alternatives

No compiler change is needed for this case. A hook-based test requires every
admitted subtotal call at B=1000 and at the full default to execute a compiled
scalar function, including its
loop, gcd and captured wide constant. The small subset-product fold delegates
its fifteen concat operations to existing array kernels. Diagnostics may
report rejected alternative candidates; that does not mean the hot function
is interpreted. Number overflow retains the existing exact replay/backoff.

A simpler first experiment sorted the generated smooth numbers once and
checked adjacent differences. It retained the expensive generation and took
5.850 seconds / 4660.8 MiB in one Mac compiled run. Moving generation into a
prime fold with one explicit loop took 7.884 seconds / 4860.0 MiB. Both return
the same full answer, but the Pell search removes the large collection itself.
Exploratory source and raw samples are retained in the baseline JSON.

## Measurements

| Host / mode | Old seconds | New seconds | Old RSS MiB | New RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac / compiled | 6.734 | 0.225 | 5117.4 | 183.8 |
| Mac / reference | 6.624 | 1.281 | 5151.5 | 299.9 |
| Intel / compiled | 16.363 | 0.594 | 1597.0 | 175.8 |
| Intel / reference | 16.473 | 3.627 | 1449.3 | 283.9 |

Three alternating fresh-process old/new pairs per host and mode, all checking
the full golden. Both program versions use the same runtime. Node v24.15.0 on
Apple M5 arm64 and Intel i7-10750H x64. Timing includes Rank parsing/execution
and excludes interpreter import; RSS is process high-water. Diagnostics and
profiling are off. No tests or other benchmarks launched by this session
overlap measurements on the same host. Intel initial load was 0.64/0.49/0.40.
The historical 25-second / 6-GB issue estimate is not the current baseline.

Handwritten JavaScript three-run medians: Mac: 0.038 seconds / 57.4 MiB; Intel: 0.119 seconds / 63.2 MiB.

The handwritten JavaScript control uses the same exact Pell arithmetic and
checks the same answer. Its timer covers computation, with no Rank parsing
or interpreter setup. It is a useful comparison, not a measurement of only
generated-loop overhead. Diagnostic runs and exploratory controls are separate
from the primary pairs.

## Verification

302 focused tests pass on each host, including this case and neighboring
scalar/capture and Euler 580 regressions. An independent small oracle divides
consecutive integers by the fifteen primes directly; it uses no Pell equation,
continued fractions, generated smooth set or gcd power. Tests cover negative
and zero bounds, small transition boundaries through B=20000, old-program
comparisons through B=10^9, and the full golden in compiled/reference and
scalar-kernel-disabled modes. The exact compilation assertion also verifies
that the subtotal has no function-compilation rejection.

Six filtered Mac checks pass for the full main and its unchanged fixture:
differential, inferred types and name facts. TypeScript build and five
exclusion-policy checks pass. The full main returns to ordinary corpus
execution. Full npm test and exhaustive audits were not run.

```sh
node benchmarks/euler581.mjs compiled
node benchmarks/euler581.mjs reference
node benchmarks/euler581.mjs exact
node benchmarks/euler581.mjs compiled 10000000000000 benchmarks/fixtures/euler581-original.ra
node benchmarks/euler581-pell-js.mjs
```

`RANK581_EXPECTED` checks the answer; `RANK581_RUNTIME` selects a built runtime.
`RANK581_DIAGNOSTICS=1` and `RANK581_PROFILE=path` enable separate diagnostics.
Raw samples: `baselines/2026-11-10-euler581.json`.
