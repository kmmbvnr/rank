# Euler 258: exact consumers and symmetric polynomial squaring

The full program keeps N=10^18, Mod=20092010 and Answer=12747994. Polynomial binary exponentiation is retained; it computes x^N modulo x^2000-x-1 instead of iterating to N. No numeric admission thresholds changed.

## Compiler change

The original outer loop compiled into the publishing BigInt backend. The checked Number backend could not handle the text intermediate in `N binary len`; the wide `N bit B` predicate was also outside its Int32 specialization.

Audited callback-free builtins whose operands are integers and whose result is text or Boolean can now consume exact integer expressions inside a Number region. Their operands participate in the existing backwards wide-register analysis without imposing a Number representation. Other numeric uses still impose it, including loop-carried dependencies. The native binding is rechecked on every entry; shadowed operations retain ordinary execution. Text-length consumers support Unicode code-point lengths in Number regions.

The unchanged demo therefore uses a mixed loop: N remains BigInt, while addresses, coefficients and arithmetic use checked Numbers. This is not a bit-length peephole or an Euler-specific compiler case. Setup executes in source order, unused branches remain unused, ordinary failures publish preceding writes, and numeric overflow discards the private attempt before exact replay.

## Algorithm change

Polynomial squaring now computes only J>=I and doubles off-diagonal products. Sparse-row skipping remains. It needs no bit-array workaround and no extra buffers. The default symmetric accumulator is bounded by 807377671404171, below 2^53-1. Larger and negative moduli retain exact semantics and overflow fallback.

## Controlled comparison

Base: `10a2d8c3313829b232a4500ec0316070de685691`. macOS arm64, Node v24.15.0. Three fresh processes per source/runtime pair, sequential and alternating forward/reverse order. Imports excluded; parsing, preparation, evaluation and diagnostics included. No overlapping benchmark or test processes from this investigation. The same source hashes are used in each before/after runtime pair. Every full run asserts Answer=12747994.

| Source/runtime | Median seconds | Range, seconds | Median process peak RSS, MiB |
|---|---:|---:|---:|
| Original source, original compiler | 12.026 | 11.792–12.263 | 261.72 |
| Original source, improved compiler | 5.313 | 5.232–5.328 | 180.08 |
| Symmetric source, original compiler | 7.416 | 7.371–7.557 | 262.14 |
| Symmetric source, improved compiler | **2.841** | 2.817–3.122 | 180.83 |

Combined speedup is **4.23x** by the ratio of medians; the compiler alone gives **2.26x** on the unchanged program. RSS is process peak, not retained-array memory. Raw samples: `baselines/2026-10-29-euler258-comparison.json`.

Concurrent upstream tensor-buffer reuse (`9099399f`) was subsequently integrated without conflicts. The combined implementation is rebuilt and verified before delivery; the controlled table above isolates this change on the stated base.

Earlier investigation controls remain reproducible in the harness: precomputed bits (`flags`), bits plus symmetry (`symmetric`), and diagonal scalar accumulation (`diagonal`). Diagonal accumulation returned the full answer in 3.107 seconds in one exploratory run, slower than the symmetric candidate, and loses sparse-row skipping on small inputs. No change from that control is shipped.

## Verification and remaining scope

- Independent direct recurrence: **360 passing comparisons** across original, flags, symmetric and shipping sources, both engines, N=0, 1, 1999, 2000, 2001, 3999, 4000, 10000, 100000, and Mod=1, -97, 97, 20092010, 10^20.
- Full compiled golden answer is now covered by `test/full-scale-demos.test.ts`; fixture assertions are unchanged. The fixture passes scoped type and differential audits (two checks).
- New focused tests cover wide setup/predicates, computed operands, loop-carried assignments, conflicting numeric uses, CoW aliases, overflow replay, partial-state errors, unused branches, Unicode and native replacement after cached compilation. Existing Int32 bit tests now account for mixed exact retry.
- The final combined upstream version passed **411 ordinary interpreter suites / 9321 tests**.
- TypeScript build and test typecheck, 11 semantic checks (65 owners), application-form checks, JS syntax and whitespace checks pass.

The original full reference run was explicitly stopped after more than 174 seconds without an answer. No completed full-reference timing or speedup is claimed. The manual main exclusion is retained pending budget requalification after symmetric squaring; its reason now distinguishes the historical approximately 690-second observation from current unknown reference timing. Small fixtures remain in ordinary audits. No deadline changes.

Reproduce after building: `node benchmarks/euler258-laggedfibonacci.mjs` (shipping), `--variant=original`, `--variant=flags`, `--variant=symmetric`, `--variant=diagonal`, `--reference`, `--fixture`, or `--verify`. Use `--runtime=/absolute/path/packages/interpreter/out/index.js` to select a separate built runtime; `--N` and `--Mod` override inputs.
