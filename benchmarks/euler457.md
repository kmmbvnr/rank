# Euler 457: a polynomial modulo a prime square

The full L = 10000000 answer remains **2647787126797397063**. The original
algorithm already used modular square roots and Hensel lifting rather than
searching through p² candidates. The issue's historical 42.8/26.0-second
figures are not the fresh baseline on the current runtime.

## Program changes

For f(n) = n² - 3n - 1, completing the square gives
4f(n) = (2n - 3)² - 13. For odd primes other than 13, solutions exist exactly
when 13 is a quadratic residue. Since 13 is 1 modulo 4, quadratic reciprocity
reduces the selection to p modulo 13 in {1, 3, 4, 9, 10, 12}. This replaces a
modular exponentiation for every prime with a small membership mask. The same
selection excludes 2 and 13: neither contributes a root modulo its square.

For p = 3 modulo 4, 13^((p+1)/4) is a square root modulo p. These primes now
use one powmod. The remaining primes use Cipolla's quadratic extension.
Its seed search removes solved prime indices after every attempt, instead of
repeating powmod for the entire original vector until the last seed is found.

Only one root r = (3+s)/2 modulo p needs Hensel lifting. The other lifted root
is (3-n) modulo p², because both are roots of the same monic quadratic and
their sum is 3. This removes the second derivative inverse and second lift.

The program remains array-oriented: there are no nested loops and at most one
loop per helper. There is no main-program loop. Intermediates have meaningful
names and lines remain within 40 columns. Full defaults and fixture assertions
are retained. Ordinary assignment boundaries and exact integer arithmetic are
unchanged.

## General compiler changes

The original loops both fell back because their vector conditions used `any`.
The Number loop backend now lowers `any` and `all` over numeric array predicates
and private Boolean stages, retaining tensor shapes and empty identities.
Boolean array `not` also composes as a pointwise stage, including filters such
as `Pending (not Ready)`. Both final program loops compile.

These paths generate no temporary predicate mask. They speculate over ready,
guarded private inputs and replay on unsupported values, overflow or errors.
An error in a later unused predicate cell must not become visible merely
because the optimization inspected it: fallback restores the ordinary
consumer's demand order. Tests cover both demanded and skipped division
errors, lazy inputs, scalar errors, wide integers, snapshots and budgets.

Unchanged external packed Boolean inputs retain their native reduction,
rather than scanning an unpacked vector on every iteration. Existing binding,
ownership, polling and builtin guards remain in force. Empty external arrays
whose element contracts cannot be proved may still decline compilation.

## Verification

- Independent direct polynomial searches at fourteen small bounds on Number,
  exact compiled and reference backends, including 0, 2, 3 and 13 boundaries.
- Existing L=1000 and L=100000 fixture answers on all three backends.
- Independent prime selection and exact polynomial checks for both lifted
  roots through L=1000, together with the square-root invariant modulo p.
- Full golden answer in tests and every benchmark process on both hosts.
- 1875 unique focused interpreter tests in 63 files passed on Mac and Intel, including
  vector stages, polling, aliases, outputs, packed Booleans, modular powers,
  wide arithmetic, previous Euler fixes and the manual/operation contracts.
- Source/test TypeScript checks and semantic/application-form checks passed on
  Mac. The broad run contained 1873 checks; two additional private empty-mask
  identities passed afterward on each host. Exhaustive corpus audits were not run.

## Measurements

| Host | Mode | Variant | Seconds | Peak RSS MiB |
| --- | --- | --- | --- | --- |
| mac | compiled | before | 3.076 | 284.6 |
| mac | compiled | compiler | 2.481 | 306.7 |
| mac | compiled | after | 0.861 | 251.6 |
| mac | reference | before | 3.648 | 334.0 |
| mac | reference | after | 1.388 | 338.7 |
| intel | compiled | before | 6.129 | 259.7 |
| intel | compiled | compiler | 5.179 | 240.5 |
| intel | compiled | after | 1.974 | 245.4 |
| intel | reference | before | 7.402 | 308.3 |
| intel | reference | after | 3.054 | 302.5 |

The final program is about 3.6× faster compiled / 2.6× reference on Mac and
3.1× / 2.4× on Intel. Mac reference RSS is essentially flat (+4.7 MiB, 1.4%);
Intel reference falls from 308.3 to 302.5 MiB. The compiler-only Mac control
uses more RSS (284.6 → 306.7 MiB), while the final program uses less (251.6 MiB).
Compiler-only Intel RSS falls from 259.7 to 240.5 MiB. These architecture and
GC differences are retained rather than summarized as universal memory savings.

The raw measurements and all ranges are in
[the baseline artifact](baselines/2026-11-07-euler457.json). Each host runs three
alternating fresh-process repetitions per variant. All use Node v24.15.0.
`before` uses the original program and runtime at fa9bff89. `compiler` uses
that same original program on the new compiler; `after` uses both changes.
The compiler-only control runs only in compiled mode, since the changed code
is not used with compilation disabled.

Foreign Node jobs are checked before and every second during each run. Intel
must be at least 98% idle with zero swap activity before each sample. No
samples are removed from the final series. Timing includes parsing, analysis
and execution, excluding process startup; RSS is the process lifetime peak.
RSS can vary with collection timing, so the raw ranges are retained alongside
medians. In particular, memory savings are not claimed for Mac reference.

Reproduce after building language and interpreter, from the repository root:

```sh
node benchmarks/euler457.mjs compiled
node benchmarks/euler457.mjs reference
node benchmarks/euler457.mjs compiled 10000000 benchmarks/fixtures/euler457-original.ra
node benchmarks/euler457-compare.mjs /path/to/built-fa9bff89 /tmp/results.jsonl mac
```

The comparison driver also accepts `intel` on Linux, enabling vmstat admission
checks. `RANK457_RUNTIME` selects a built interpreter entrypoint and
`RANK457_DIAGNOSTICS=false` disables counters. Each sample retains its source
SHA-256 and exact answer. Compiler-only and final-program memory costs should
be assessed separately; they need not move in the same direction.
