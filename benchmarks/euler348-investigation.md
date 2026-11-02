# Euler 348: square/cube palindrome search

Investigated across 2026-11-02/03, baseline `85215006`, Node 24.15.0.
The default asks for the first five decimal palindromes with exactly four
representations a²+b³, with a,b greater than one. The answer is **1004195061**.

## Cause and selected change

The program generates palindromes in increasing order and scans positive
cubes for each candidate. This avoids generating and retaining every possible
sum. Its main scalar helper `reps` compiled to exact BigInt code, but called
native `isqrt` through ordinary native-call wrappers for every cube. A CPU
profile of the full compiled baseline shows substantial time in those wrappers
and in BigInt integer-square-root correction. Number-function counters alone
are insufficient: the original already ran `mirror` through that backend.

The general scalar Number backend now admits the standard integer `isqrt`.
It uses the existing `safeIntegerSquareRoot`, including its correction loops;
`Math.sqrt` is only an estimate. Argument and intermediate safety checks remain.
Negative inputs replay in the exact kernel to retain its located domain error.
Wide inputs and unsafe intermediates retain exact fallback, and native identity
and module guards still protect against replacing the builtin. Polling remains
in the enclosing loops. There is no Euler-specific compiler rule.

The production algorithm and its default arguments remain unchanged. The
companion small fixture adds zero/boundary cases, and an ordinary test retains
the full compiled checksum. The small fixture remains in corpus audits.

## Full compiled measurements

Three alternating fresh-process trials per backend per host. Parse, preparation
and execution are timed; runtime import/process startup excluded. Whole-process
peak RSS medians follow. External load was not controlled.

| Host | Baseline s | Delivered s | Baseline MiB | Delivered MiB |
| --- | ---: | ---: | ---: | ---: |
| Mac arm64 | 2.465 | 0.366 | 177.8 | 177.8 |
| Intel x86_64 | 6.066 | 1.168 | 165.7 | 164.2 |

Every full measured process asserts the golden answer. This is approximately
6.7x and 5.2x faster respectively, without material memory growth. A diagnostic
full run after the change records 179340 Number function calls and no Number
function fallback; the original recorded 89675. The loop/expression rejections
in the outer `solve` still exist (notably computed integer exponents). They do
not prevent the hot `reps` helper from using Number arithmetic.

A standalone original reference run took 52.016 s / 419.7 MiB on Mac. This is a
single diagnostic-scale control, not a median. The change is compiler-only;
reference execution overhead remains. No reference speedup is claimed.

## Other experiments

- Replacing `mirror`'s boolean flag with an integer flag removes one initial
  proof rejection but gave no whole-program win: one diagnostic full compiled
  sample took 2.635 s versus 2.367 s original. Not selected.
- An array `reps` using cube ranges, `till`, lifted roots and a boolean count
  returns the first answer correctly. At Want=1 one compiled exploratory sample
  took 0.722 s and 457.0 MiB. It creates large per-candidate arrays, so it is
  rejected as a production replacement. No full-default performance claim.

## Independent verification

`euler348-verify.mjs` exhaustively enumerates square/cube pairs, independently
of the Rank palindrome-first search, through the last solution. It checks
**21971960 pairs**, retains only palindromes, and finds exactly:

5229225, 37088073, 56200265, 108909801, 796767697.

It then performs 1550 comparisons across small representation counts, all
five full solution counts, and mirrors including zero and both parity modes
against independent oracles in both engines. This verification passes on Mac and Intel.

Compiler regression coverage checks safe square boundaries, values around
2^53, wide fallback, located negative/real/missing/text errors, native identity
replacement, unsafe intermediate replay after private writes and cancellation.
Existing integer-root, scalar kernel/domain and geometric-loop tests accompany
those cases. The complete default answer has a focused compiled regression.
No full test suite or exhaustive corpus audit is run for this delivery.

## Reproduction

```sh
node benchmarks/euler348-investigation.mjs demos/euler/348_squarecube.ra compiled
node benchmarks/euler348-verify.mjs
```

`RANK348_RUNTIME` selects a built runtime for baseline/control comparison.
The worker also accepts `reference`, Want (default 5), and optional `diag`.
`RANK348_KERNEL_OUTPUT` saves generated kernels for diagnostic runs.
Raw controlled samples are in `baselines/2026-11-03-euler348-investigation.json`.

## Delivery checks

107 focused interpreter tests pass, including five new compiler-contract cases
and the full compiled checksum. The three small CLI test blocks and the full
CLI default block pass. Six scoped type/differential cases pass for main,
full-default and small fixture; the expanded small fixture is rechecked after
adding boundary assertions. Each full differential comparison takes about
118-119 seconds under VM instrumentation. Seven audit infrastructure tests,
semantic/application boundaries, Langium generation and TypeScript build pass.
Existing full-reference budget exclusions are retained: the full default still
costs about two minutes per comparison under VM instrumentation on the Mac.
The focused ordinary test covers its complete compiled answer. Inputs, answers,
deadlines and compiler admission thresholds are unchanged.
