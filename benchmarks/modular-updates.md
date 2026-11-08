# Modular compound updates (#561)

`Total += Value mod M` now means `Total = (Total + Value) mod M`.
Parenthesized `Total += (Value mod M)` retains RHS-only reduction.
This applies to top-level trailing `mod` after expression grouping, preserving
normal arithmetic precedence and postfix operations.

Indexed numeric-array writes accept the same syntax. With `.accumulate`,
every duplicate update is combined with the accumulated cell and reduced.
Without it, duplicate updates read the original cell and the last wins.
Selectors, RHS and scalar modulus are evaluated before replacement stores.
Integer addition, subtraction and multiplication reduce operands early;
other operations and real numbers retain operation-then-remainder semantics.

The interpreter validates replacements before mutation and keeps exact BigInt
fallbacks, including negative or wide moduli. Number-loop scatter reuses exact
modular multiplication for positive integer moduli through 2^31. Unsupported
shapes, types or modulus expressions retain ordinary execution. Array-region
and scalar-function kernels decline forms they cannot lower safely. Scalar
updates normalize to an ordinary expression, reusing existing optimizations.

The old fixed-width-overflow description in the issue was inaccurate: ordinary
integer accumulation already widens exactly. The missing feature was bounded
modular accumulation, avoiding growing products and retaining compiled scatter.

## Measurements

Node v24.15.0, Mac arm64 and Intel x64, median of three fresh processes.
`benchmarks/modular-updates.mjs` applies 262,144 updates to 4,096 destinations
for eight passes, multiplying values near 10^9 modulo 1,000,000,007.
An independent BigInt oracle checks every destination. Timing covers the loop;
RSS is whole-process peak, including setup and verification.

| Host | Mode | Interpreter ms | Compiled ms | Interpreter RSS MiB | Compiled RSS MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| Mac | accumulate | 252.77 | 28.31 | 270.70 | 182.55 |
| Mac | ordinary | 407.73 | 40.97 | 287.56 | 186.75 |
| Intel | accumulate | 719.66 | 78.23 | 258.98 | 175.45 |
| Intel | ordinary | 743.93 | 112.19 | 268.80 | 178.16 |

These compare compiled and interpreted execution of the new operation, not
before/after Euler 797. The full Euler 797 workload was not benchmarked here.
Run with `COMPILED=0` for the interpreter and `ACCUMULATE=0` for ordinary writes.

The existing arithmetic-RHS accumulation control retains explicit RHS-only
parentheses. Mac median: 98.65 ms at base e097e5e2 and 98.12 ms after this change.
The ordinary-write control was noisy: five interleaved runs gave medians
257.76 vs 269.82 ms, with overlapping ranges 225–409 vs 226–412 ms.
This control does not establish a small speedup or slowdown.

## Verification

- Focused interpreter tests on both architectures: the nine-file suite passed
  489 tests, followed by 30/30 modular tests after adding real-number coverage.
- Language accumulation tests: 22/22; modulus replacement-type regression: 1/1.
- TypeScript project build, semantic-boundary checks and application-form checks.
- 45 migrated Rank files (56 expressions) have identical semantic ASTs to the
  base parser after removing redundant parentheses. Existing demos retain their
  original algorithms and results by construction.
- The number-loop overflow fixture used an obsolete 2^30 limit. It now uses a
  modulus above 2^31, preserving the intended exact-replay coverage.
- Broader language checks exposed three existing failures, all reproduced on
  clean e097e5e2: `function-effects` local integer factor iteration;
  `value-diagnostics` circuit signals; and CSES graph-path matrix result types.
  These are not introduced by modular updates and remain outside this change.
- Exhaustive type, differential and demo audits were not run.
